#!/usr/bin/env node
/**
 * forge — config-as-code orchestration CLI.
 *
 * Zero dependencies (node:util parseArgs + built-ins). Runs TypeScript directly
 * on Node 24+. Subcommands: init, run, eval, agent, skill, learn, ci, config, status.
 */

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { Engine, type WorkflowDef, type StepResult } from "./core/engine.ts";
import { Store, type RunRecord, STATE_DIR } from "./core/store.ts";
import { makeProvider, MockProvider, type LLMProvider } from "./core/llm.ts";
import { formatUsd, formatTokens } from "./core/tokens.ts";
import { log } from "./core/logger.ts";
import { loadConfig, type Plugin } from "./config/loader.ts";
import { runEval, parseDataset, type Runner } from "./eval/harness.ts";
import { extract } from "./learning/extractor.ts";
import { LearningLoop } from "./learning/proposal.ts";
import { parseJsonl } from "./learning/logformat.ts";
import { Hooks } from "./core/hooks.ts";
import { PolicyEngine, guardWithPolicy } from "./core/policy.ts";
import { MemoryStore } from "./core/memory.ts";
import { CheckpointStore } from "./core/checkpoint.ts";
import { loadHookConfigs, registerHookConfigs } from "./core/hookconfig.ts";
import { analyzeDag, toAscii, toMermaid } from "./orchestration/graph.ts";
import { compare } from "./eval/compare.ts";
import { clusterBySimilarity } from "./learning/cluster.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BUNDLED_CONFIGS = join(REPO_ROOT, "configs");
/** Default CI/eval-gate config file name. */
const CONFIG_FILE = "forge.config.json";

function die(msg: string): never {
  process.stderr.write(`forge: ${msg}\n`);
  process.exit(1);
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) die(`file not found: ${path}`);
  try {
    // Strip a UTF-8 BOM: Windows tools (PowerShell's Out-File, older editors)
    // write one, and JSON.parse rejects it.
    const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as T;
  } catch (e) {
    die(`could not parse ${path}: ${(e as Error).message}`);
  }
}

function pickProvider(kind: string): LLMProvider {
  if (kind === "anthropic") return makeProvider("anthropic");
  return new MockProvider();
}

const USAGE = `forge — config-as-code orchestration for Claude Code

Usage: forge <command> [options]      (from a clone: node src/cli.ts <command> [options])

Commands:
  init [dir]                     Scaffold a forge project with the bundled config library
  run <workflow.json>            Run a declarative workflow (retries, parallelism, budgets)
  eval <dataset.json>            Score an agent over a dataset → pass@1 / pass@k + regressions
  compare <dataset.json>         A/B two agents with a bootstrap significance test
  agent <name> <task...>         Run one agent on a task
  skill list|approve <id>|reject <id>   Manage learned skill proposals
  learn <log.jsonl>              Extract reusable patterns from a session log
  graph <workflow.json>          Show the DAG: levels, critical path, mermaid/ASCII
  policy list|check              Inspect guardrails; check an action against them
  memory add|list|search|rm      Persistent cross-session memory
  checkpoint list|show           Inspect saved run checkpoints
  hooks list                     List config-driven hooks
  ci                             Run tests + evals as a gate (exit non-zero on failure)
  config list                    List loaded plugins (agents, skills, commands, rules)
  status                         Show runs, evals, and skills persisted in .forge/

Common flags:
  --provider mock|anthropic      LLM provider (default: mock)
  --config <dir>                 Config directory (default: ./configs)
  --help                         Show this help
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  switch (command) {
    case "init":
      return cmdInit(rest);
    case "run":
      return cmdRun(rest);
    case "eval":
      return cmdEval(rest);
    case "agent":
      return cmdAgent(rest);
    case "skill":
      return cmdSkill(rest);
    case "learn":
      return cmdLearn(rest);
    case "graph":
      return cmdGraph(rest);
    case "policy":
      return cmdPolicy(rest);
    case "memory":
      return cmdMemory(rest);
    case "checkpoint":
      return cmdCheckpoint(rest);
    case "hooks":
      return cmdHooks(rest);
    case "compare":
      return cmdCompare(rest);
    case "config":
      return cmdConfig(rest);
    case "ci":
      return cmdCi(rest);
    case "status":
      return cmdStatus(rest);
    default:
      die(`unknown command "${command}"\n\n${USAGE}`);
  }
}

function cmdInit(args: string[]): void {
  const positional = args.filter((a) => !a.startsWith("--"));
  const dir = resolve(positional[0] ?? ".");
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, "configs");
  if (existsSync(cfg)) {
    log.info(`configs already exist at ${cfg} — leaving them alone`);
  } else if (existsSync(BUNDLED_CONFIGS)) {
    cpSync(BUNDLED_CONFIGS, cfg, { recursive: true });
    log.info(`copied bundled config library → ${cfg}`);
  } else {
    log.warn(`no bundled configs found at ${BUNDLED_CONFIGS}`);
  }
  mkdirSync(join(dir, STATE_DIR), { recursive: true });

  // Seed a workflow so `run` works immediately.
  const wfDir = join(dir, "workflows");
  mkdirSync(wfDir, { recursive: true });
  const exampleWf = join(wfDir, "example-feature.json");
  if (!existsSync(exampleWf)) {
    writeFileSync(exampleWf, JSON.stringify(exampleWorkflow(), null, 2), "utf8");
    log.info(`wrote ${exampleWf}`);
  }

  // Seed an eval dataset + gate config so `eval` and `ci` work immediately.
  const evalsDir = join(dir, "evals");
  mkdirSync(evalsDir, { recursive: true });
  const dataset = join(evalsDir, "feature.dataset.json");
  if (!existsSync(dataset)) {
    const src = join(REPO_ROOT, "evals", "feature.dataset.json");
    if (existsSync(src)) {
      cpSync(src, dataset);
      log.info(`wrote ${dataset}`);
    }
  }
  const ciConfig = join(dir, CONFIG_FILE);
  if (!existsSync(ciConfig)) {
    writeFileSync(
      ciConfig,
      JSON.stringify(
        {
          provider: "mock",
          evals: [{ dataset: "evals/feature.dataset.json", trials: 3, graders: ["contains"], floor: 1.0 }],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    log.info(`wrote ${ciConfig}`);
  }

  // Seed a session log so `learn` works immediately.
  const exDir = join(dir, "examples");
  mkdirSync(exDir, { recursive: true });
  const logFile = join(exDir, "session-log.jsonl");
  if (!existsSync(logFile)) {
    const src = join(REPO_ROOT, "examples", "session-log.jsonl");
    if (existsSync(src)) {
      cpSync(src, logFile);
      log.info(`wrote ${logFile}`);
    }
  }

  // Show the right invocation for how this copy is being run.
  const isInstalled = REPO_ROOT.includes("node_modules");
  const run = isInstalled ? "forge" : "node src/cli.ts";
  const wfRel = join("workflows", "example-feature.json");
  process.stdout.write(`\nforge project ready at ${dir}\n\nTry:\n`);
  process.stdout.write(`  ${run} run ${wfRel}\n`);
  process.stdout.write(`  ${run} eval evals/feature.dataset.json --trials 3\n`);
  process.stdout.write(`  ${run} ci\n`);
  process.stdout.write(`  ${run} learn examples/session-log.jsonl\n\n`);
  process.stdout.write(`Next: point it at a real model with --provider anthropic (or openai, or ollama).\n`);
}

function exampleWorkflow(): WorkflowDef {
  return {
    name: "example-feature",
    description: "Plan → implement → review a small feature (runs on the mock provider by default).",
    concurrency: 2,
    budget: { maxTokens: 8000 },
    steps: [
      { id: "plan", agent: "planner", prompt: "Summarize a plan for: add a /health endpoint", timeoutMs: 15000 },
      { id: "implement", agent: "implementer", needs: ["plan"], prompt: "Implement: add a /health endpoint", retries: 1 },
      { id: "review", agent: "python-reviewer", needs: ["implement"], prompt: "Review this change for bugs.", retries: 1 },
    ],
  };
}

function cmdRun(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      provider: { type: "string", default: "mock" },
      input: { type: "string", multiple: true },
      config: { type: "string", default: "configs" },
      resume: { type: "boolean", default: false },
      checkpoint: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) die("run requires a workflow file: forge run workflows/example-feature.json");

  const wf = readJson<WorkflowDef>(file);
  const provider = pickProvider(values.provider ?? "mock");

  const inputs: Record<string, unknown> = {};
  for (const kv of values.input ?? []) {
    const i = kv.indexOf("=");
    if (i > 0) inputs[kv.slice(0, i)] = kv.slice(i + 1);
  }

  // Load agent system prompts from the config library so steps that name an
  // agent actually run with its instructions (not just the raw prompt).
  const agents: Record<string, string> = {};
  const cfgDir = resolve(values.config ?? "configs");
  if (existsSync(cfgDir)) {
    for (const p of loadConfig(cfgDir)) if (p.kind === "agent") agents[p.name] = p.body;
  }

  // Hooks: the policy guard runs first (priority -100), then config-driven
  // hook commands, then any programmatic hooks.
  const hooks = new Hooks();
  guardWithPolicy(hooks, new PolicyEngine());
  registerHookConfigs(hooks, loadHookConfigs(join(cfgDir, "hooks")));

  // Resume support: seed already-completed steps from the latest checkpoint.
  const cpStore = new CheckpointStore(join(process.cwd(), STATE_DIR, "checkpoints"));
  let resumeFrom: Record<string, StepResult> | undefined;
  if (values.resume) {
    const cp = cpStore.latestFor(wf.name);
    if (cp) {
      resumeFrom = cp.completed;
      process.stdout.write(`↻ resuming '${wf.name}' from checkpoint ${cp.id} (${Object.keys(cp.completed).length} steps already done)\n`);
    } else {
      process.stdout.write(`↻ no checkpoint found for '${wf.name}' — starting fresh\n`);
    }
  }

  const engine = new Engine({
    provider,
    inputs,
    agents,
    hooks,
    resumeFrom,
    onEvent: (e) => {
      if (values.json) return;
      if (e.type === "step:start") process.stdout.write(`  ▸ ${e.stepId}\n`);
      else if (e.type === "step:retry") process.stdout.write(`  ↻ ${e.stepId} (retry ${e.attempt})\n`);
      else if (e.type === "step:skip") process.stdout.write(`  ⊘ ${e.stepId} — ${e.message}\n`);
      else if (e.type === "step:end" && e.status === "success") process.stdout.write(`  ✔ ${e.stepId} (${e.ms}ms)\n`);
      else if (e.type === "step:end" && (e.status === "failed" || e.status === "timeout")) process.stdout.write(`  ✖ ${e.stepId} (${e.status})\n`);
    },
  });

  const started = Date.now();
  return engine.run(wf).then((res) => {
    // Persist.
    const store = new Store(process.cwd());
    const rec: RunRecord = {
      id: `run:${Date.now()}`,
      workflow: res.workflow,
      status: res.status,
      startedAt: new Date(started).toISOString(),
      durationMs: res.durationMs,
      inputTokens: res.totalInputTokens,
      outputTokens: res.totalOutputTokens,
      costUsd: res.totalCostUsd,
      steps: res.steps.map((s) => ({ id: s.id, status: s.status, attempts: s.attempts, durationMs: s.durationMs })),
    };
    store.addRun(rec);

    // Optional checkpoint so an interrupted run can be resumed later.
    if (values.checkpoint) {
      const cp = cpStore.save(wf.name, inputs, res.steps);
      process.stdout.write(`\n💾 checkpoint ${cp.id} (${Object.keys(cp.completed).length} steps saved)\n`);
    }

    if (values.json) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
      return;
    }
    process.stdout.write(`\n${res.status.toUpperCase()}  ${res.workflow}  (${res.durationMs}ms)\n`);
    for (const s of res.steps) {
      const mark = s.status === "success" ? "✔" : s.status === "skipped" ? "⊘" : "✖";
      process.stdout.write(`  ${mark} ${s.id.padEnd(14)} ${s.status}${s.attempts > 1 ? ` ×${s.attempts}` : ""}${s.error ? ` — ${s.error.slice(0, 60)}` : ""}\n`);
    }
    process.stdout.write(`tokens ${formatTokens(res.totalInputTokens + res.totalOutputTokens)} · cost ${formatUsd(res.totalCostUsd)}\n`);
  });
}

function cmdEval(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      provider: { type: "string", default: "mock" },
      trials: { type: "string", default: "3" },
      graders: { type: "string" },
      agent: { type: "string" },
      config: { type: "string", default: "configs" },
      name: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) die("eval requires a dataset file: forge eval evals/feature.dataset.json");

  const dataset = parseDataset(readFileSync(file, "utf8"));
  const provider = pickProvider(values.provider ?? "mock");
  const trials = Math.max(1, parseInt(values.trials ?? "3", 10) || 3);
  const graders = values.graders ? values.graders.split(",").map((s) => s.trim()) : ["contains"];

  // Build a runner: if --agent, use the agent's body as the system prompt.
  let system: string | undefined;
  let agentName = values.agent ?? "default";
  if (values.agent) {
    const plugins = loadConfig(resolve(values.config ?? "configs"));
    const agent = plugins.find((p) => p.kind === "agent" && p.name === values.agent);
    if (!agent) die(`agent not found in configs: ${values.agent}`);
    system = agent.body;
    agentName = agent.name;
  }
  const runner: Runner = async (input) => {
    const res = await provider.complete({
      system,
      messages: [{ role: "user", content: input }],
      maxTokens: 512,
    });
    return { text: res.text, costUsd: res.costUsd };
  };

  const store = new Store(process.cwd());
  return runEval({
    dataset,
    run: runner,
    trials,
    graders,
    provider,
    store,
    agent: agentName,
    datasetName: values.name ?? file,
  }).then((res) => {
    if (values.json) {
      process.stdout.write(JSON.stringify(res, null, 2) + "\n");
      return;
    }
    process.stdout.write(`\nEval: ${res.agent} on ${res.dataset} (${trials} trials/case)\n`);
    process.stdout.write(`  pass@1 = ${res.passAt1.toFixed(2)}   pass@${trials} = ${res.passAtK.toFixed(2)}\n`);
    for (const c of res.cases) {
      const passed = c.trials.filter((t) => t.passed).length;
      process.stdout.write(`  ${passed > 0 ? "✔" : "✖"} ${c.id.padEnd(16)} ${passed}/${c.trials.length} passed\n`);
    }
    if (res.regressions.length) {
      for (const r of res.regressions) {
        const flag = r.regressed ? "REGRESSION" : "ok";
        process.stdout.write(`  ${flag}: ${r.metric} ${r.baseline.toFixed(2)} → ${r.current.toFixed(2)} (${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)})\n`);
      }
    }
  });
}

function cmdAgent(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      provider: { type: "string", default: "mock" },
      config: { type: "string", default: "configs" },
    },
    allowPositionals: true,
  });
  const name = positionals[0];
  const task = positionals.slice(1).join(" ");
  if (!name || !task) die("agent requires a name and a task: forge agent python-reviewer 'review this'");

  const plugins = loadConfig(resolve(values.config ?? "configs"));
  const agent = plugins.find((p) => p.kind === "agent" && p.name === name);
  if (!agent) die(`agent not found in configs: ${name}`);

  const provider = pickProvider(values.provider ?? "mock");
  return provider
    .complete({ system: agent.body, messages: [{ role: "user", content: task }], maxTokens: 1024 })
    .then((res) => {
      process.stdout.write(res.text.trim() + "\n");
      process.stdout.write(`\n[${agent.name}] ${formatTokens(res.inputTokens + res.outputTokens)} tokens · ${formatUsd(res.costUsd)}\n`);
    });
}

function cmdSkill(args: string[]): void {
  const sub = args[0] ?? "list";
  const store = new Store(process.cwd());
  const loop = new LearningLoop(store);

  if (sub === "list") {
    const skills = loop.list();
    if (skills.length === 0) {
      process.stdout.write("No skill proposals yet. Run: forge learn <session.jsonl>\n");
      return;
    }
    for (const s of skills) {
      const badge = { proposed: "PROPOSED", approved: "APPROVED", rejected: "REJECTED", installed: "INSTALLED" }[s.status];
      process.stdout.write(`  [${badge}] ${s.id}  ${s.name}  (v${s.version}, ${s.evidence.length} evidence)\n`);
    }
    return;
  }
  if (sub === "approve") {
    const id = args[1];
    if (!id) die("skill approve requires an id");
    const skillsDir = resolve("configs/skills");
    const rec = loop.approve(id, { skillsDir });
    process.stdout.write(`Installed ${rec.name} → ${skillsDir}/${rec.name}/SKILL.md\n`);
    return;
  }
  if (sub === "reject") {
    const id = args[1];
    if (!id) die("skill reject requires an id");
    const rec = loop.reject(id);
    process.stdout.write(`Rejected ${rec.id}\n`);
    return;
  }
  die(`unknown skill subcommand: ${sub}`);
}

function cmdLearn(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: { min: { type: "string", default: "2" } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) die("learn requires a session log: forge learn examples/session-log.jsonl");

  const events = parseJsonl(readFileSync(file, "utf8"));
  const min = Math.max(1, parseInt(values.min ?? "2", 10) || 2);
  const candidates = extract(events, { minCount: min });

  // Cluster near-duplicate patterns so we don't propose three versions of the
  // same rule. The most-repeated member of each cluster wins.
  const items = candidates.map((c, i) => ({ id: String(i), text: c.title }));
  const clusters = clusterBySimilarity(items, 0.4);
  const keep = new Set<number>();
  for (const cl of clusters) {
    let best = Number(cl.representative.id);
    for (const m of cl.members) {
      const i = Number(m.id);
      if (candidates[i].count > candidates[best].count) best = i;
    }
    keep.add(best);
  }
  const deduped = candidates.filter((_, i) => keep.has(i));
  const merged = candidates.length - deduped.length;

  const store = new Store(process.cwd());
  const loop = new LearningLoop(store);
  const result = loop.ingest(deduped);

  process.stdout.write(`Scanned ${events.length} events → ${candidates.length} candidate patterns\n`);
  if (merged > 0) {
    process.stdout.write(`Clustered ${clusters.length} group(s) → ${merged} near-duplicate(s) merged\n`);
  }
  process.stdout.write(`New: ${result.created.length}  Updated: ${result.updated.length}  Skipped: ${result.skipped.length}\n\n`);
  for (const c of result.created) {
    process.stdout.write(`  ${c.id}  ${c.name}\n`);
  }
  if (result.created.length) {
    process.stdout.write(`\nReview & install with:\n  forge skill list\n  forge skill approve <id>\n`);
  }
}

interface CiEval {
  dataset: string;
  agent?: string;
  trials?: number;
  graders?: string[];
  floor?: number;
}
interface CiConfig {
  provider?: string;
  evals?: CiEval[];
}

async function cmdCi(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      config: { type: "string", default: CONFIG_FILE },
      provider: { type: "string" },
      "skip-tests": { type: "boolean", default: false },
    },
  });
  const cfgPath = resolve(values.config ?? CONFIG_FILE);
  const cfg: CiConfig = existsSync(cfgPath) ? readJson<CiConfig>(cfgPath) : { evals: [] };
  const providerKind = values.provider ?? cfg.provider ?? "mock";
  let failed = false;

  // 1) Unit tests (enumerate .test.ts so it's cross-platform — no shell glob).
  const testsDir = resolve("tests");
  const testFiles = existsSync(testsDir)
    ? readdirSync(testsDir).filter((f) => f.endsWith(".test.ts")).map((f) => join(testsDir, f))
    : [];
  if (testFiles.length && !values["skip-tests"]) {
    process.stdout.write(`▶ unit tests (${testFiles.length} files)\n`);
    const r = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
    if (r.status !== 0) {
      failed = true;
      process.stdout.write("  ✖ tests FAILED\n\n");
    } else {
      process.stdout.write("  ✔ tests passed\n\n");
    }
  }

  // 2) Eval gates.
  const evals = cfg.evals ?? [];
  const provider = pickProvider(providerKind);
  const store = new Store(process.cwd());

  for (const e of evals) {
    const datasetPath = resolve(e.dataset);
    const dataset = parseDataset(readFileSync(datasetPath, "utf8"));
    const trials = Math.max(1, e.trials ?? 3);
    const graders = e.graders ?? ["contains"];

    let system: string | undefined;
    let agentName = e.agent ?? "default";
    if (e.agent) {
      const cfgDir = "configs";
      const agent = loadConfig(resolve(cfgDir)).find((p) => p.kind === "agent" && p.name === e.agent);
      if (!agent) {
        process.stdout.write(`  ✖ eval ${e.dataset}: agent not found (${e.agent})\n\n`);
        failed = true;
        continue;
      }
      system = agent.body;
      agentName = agent.name;
    }
    const runner: Runner = async (input) => {
      const res = await provider.complete({ system, messages: [{ role: "user", content: input }], maxTokens: 512 });
      return { text: res.text, costUsd: res.costUsd };
    };

    const res = await runEval({
      dataset,
      run: runner,
      trials,
      graders,
      provider,
      store,
      agent: agentName,
      datasetName: e.dataset,
    });

    const floor = e.floor ?? 0;
    const belowFloor = res.passAt1 < floor - 1e-9;
    const regressed = !res.clean;
    const ok = !belowFloor && !regressed;
    if (!ok) failed = true;

    const mark = ok ? "✔" : "✖";
    process.stdout.write(`  ${mark} ${e.dataset}  pass@1=${res.passAt1.toFixed(2)} (floor ${floor.toFixed(2)})`);
    if (regressed) process.stdout.write(`  REGRESSION ${res.regressions[0].baseline.toFixed(2)}→${res.passAt1.toFixed(2)}`);
    process.stdout.write("\n");
  }

  process.stdout.write(failed ? "\nforge ci: FAILED\n" : "\nforge ci: PASSED\n");
  process.exit(failed ? 1 : 0);
}

function cmdConfig(args: string[]): void {
  const sub = args[0] ?? "list";
  const dirIdx = args.indexOf("--config");
  const cfgDir = dirIdx >= 0 && args[dirIdx + 1] ? args[dirIdx + 1] : "configs";
  if (sub !== "list") die(`unknown config subcommand: ${sub}`);
  const plugins = loadConfig(resolve(cfgDir));
  const byKind = new Map<string, Plugin[]>();
  for (const p of plugins) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  for (const kind of ["agent", "skill", "command", "rule"]) {
    const list = byKind.get(kind) ?? [];
    process.stdout.write(`\n${kind.toUpperCase()}S (${list.length})\n`);
    for (const p of list) process.stdout.write(`  ${p.name.padEnd(24)} ${p.description.slice(0, 60)}\n`);
  }
}

function cmdGraph(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: { mermaid: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) die("graph requires a workflow file: forge graph workflows/example-feature.json");

  const wf = readJson<WorkflowDef>(file);
  const a = analyzeDag(wf);
  if (a.cycle) die(`workflow '${wf.name}' has a dependency cycle: ${a.cycle.join(" -> ")}`);

  process.stdout.write(`${wf.name}\n\n${toAscii(wf)}\n`);
  if (values.mermaid) {
    process.stdout.write(`\n${toMermaid(wf)}\n`);
  } else {
    process.stdout.write(`\n(add --mermaid to print the Mermaid flowchart)\n`);
  }
}

function cmdPolicy(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      command: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
      tool: { type: "string" },
    },
    allowPositionals: true,
  });
  const sub = positionals[0] ?? "list";
  const policy = new PolicyEngine();

  if (sub === "list") {
    const rules = policy.list();
    process.stdout.write(`Policy rules (${rules.length})\n\n`);
    for (const r of rules) {
      process.stdout.write(`  [${r.effect.padEnd(17)}] ${r.id.padEnd(28)} ${r.description}\n`);
    }
    process.stdout.write(`\nCheck an action with: forge policy check --command "rm -rf /"\n`);
    return;
  }

  if (sub === "check") {
    const action = {
      command: values.command,
      path: values.path,
      content: values.content,
      tool: values.tool,
    };
    if (!action.command && !action.path && !action.content && !action.tool) {
      die("policy check needs at least one of --command / --path / --content / --tool");
    }
    const verdict = policy.evaluate(action);
    if (verdict.allowed && !verdict.needsApproval) {
      process.stdout.write("ALLOWED\n");
      return;
    }
    process.stdout.write(`${verdict.allowed ? "NEEDS APPROVAL" : "DENIED"}\n${verdict.reason ?? ""}\n`);
    process.exit(verdict.allowed ? 0 : 2);
  }

  die(`unknown policy subcommand: ${sub}`);
}

function memoryFile(): string {
  return join(process.cwd(), STATE_DIR, "memory.json");
}

function cmdMemory(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: {
      kind: { type: "string", default: "fact" },
      tags: { type: "string" },
      k: { type: "string", default: "5" },
    },
    allowPositionals: true,
  });
  const sub = positionals[0] ?? "list";
  const store = new MemoryStore(memoryFile());

  if (sub === "add") {
    const text = positionals.slice(1).join(" ");
    if (!text) die("memory add requires text: forge memory add \"prefer strict mode\" --kind preference");
    const kind = (["fact", "preference", "instruction", "pattern"] as const).includes(
      values.kind as "fact",
    ) ? (values.kind as "fact" | "preference" | "instruction" | "pattern") : "fact";
    const tags = (values.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    const e = store.add(kind, text, tags);
    process.stdout.write(`Added ${e.id} (${e.kind}) → ${memoryFile()}\n`);
    return;
  }
  if (sub === "list") {
    const all = store.all();
    if (!all.length) {
      process.stdout.write("Memory is empty. Add one with: forge memory add \"...\"\n");
      return;
    }
    process.stdout.write(`Memory (${all.length})\n\n`);
    for (const e of all) {
      process.stdout.write(`  ${e.id.padEnd(18)} ${e.kind.padEnd(11)} ${e.text.slice(0, 60)}${e.tags.length ? `  [${e.tags.join(",")}]` : ""}\n`);
    }
    return;
  }
  if (sub === "search") {
    const q = positionals.slice(1).join(" ");
    if (!q) die("memory search requires a query");
    const k = Math.max(1, parseInt(values.k ?? "5", 10) || 5);
    const hits = store.search(q, k);
    if (!hits.length) {
      process.stdout.write(`No memory entries matched "${q}"\n`);
      return;
    }
    process.stdout.write(`Matches for "${q}" (${hits.length})\n\n`);
    for (const e of hits) process.stdout.write(`  ${e.id.padEnd(18)} ${e.text.slice(0, 70)}\n`);
    return;
  }
  if (sub === "rm") {
    const id = positionals[1];
    if (!id) die("memory rm requires an id");
    process.stdout.write(store.remove(id) ? `Removed ${id}\n` : `No memory entry with id ${id}\n`);
    return;
  }
  die(`unknown memory subcommand: ${sub}`);
}

function cmdCheckpoint(args: string[]): void {
  const sub = args[0] ?? "list";
  const store = new CheckpointStore(join(process.cwd(), STATE_DIR, "checkpoints"));

  if (sub === "list") {
    const list = store.list();
    if (!list.length) {
      process.stdout.write("No checkpoints yet. Run a workflow with --checkpoint to create one.\n");
      return;
    }
    process.stdout.write(`Checkpoints (${list.length})\n\n`);
    for (const c of list) {
      process.stdout.write(`  ${c.id.padEnd(22)} ${c.workflow.padEnd(22)} ${Object.keys(c.completed).length} steps · ${c.savedAt}\n`);
    }
    return;
  }
  if (sub === "show") {
    const id = args[1];
    if (!id) die("checkpoint show requires an id");
    const cp = store.load(id);
    if (!cp) die(`checkpoint not found: ${id}`);
    process.stdout.write(`${cp.id}  ${cp.workflow}  (${cp.savedAt})\n\n`);
    for (const [id2, r] of Object.entries(cp.completed)) {
      process.stdout.write(`  ✔ ${id2.padEnd(18)} ${r.output.slice(0, 60)}\n`);
    }
    return;
  }
  die(`unknown checkpoint subcommand: ${sub}`);
}

function cmdHooks(args: string[]): void {
  const { values, positionals } = parseArgs({
    args,
    options: { config: { type: "string", default: "configs" } },
    allowPositionals: true,
  });
  const sub = positionals[0] ?? "list";
  if (sub !== "list") die(`unknown hooks subcommand: ${sub}`);
  const dir = join(resolve(values.config ?? "configs"), "hooks");
  const cfgs = loadHookConfigs(dir);
  if (!cfgs.length) {
    process.stdout.write(`No hook configs found in ${dir}\n`);
    process.stdout.write(`Add one as ${join(dir, "my-hook.json")}:\n`);
    process.stdout.write(`  { "name": "no-secrets", "phases": ["step:end"], "command": "..." }\n`);
    return;
  }
  process.stdout.write(`Hooks (${cfgs.length}) in ${dir}\n\n`);
  for (const c of cfgs) {
    process.stdout.write(`  ${c.name.padEnd(20)} ${c.phases.join(", ").padEnd(28)} ${c.blockOnFail ? "blocking" : "observe-only"}\n`);
    process.stdout.write(`  ${" ".repeat(20)} $ ${c.command}\n`);
  }
}

async function cmdCompare(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      provider: { type: "string", default: "mock" },
      "agent-a": { type: "string" },
      "agent-b": { type: "string" },
      trials: { type: "string", default: "3" },
      graders: { type: "string" },
      config: { type: "string", default: "configs" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) die("compare requires a dataset file: forge compare evals/feature.dataset.json --agent-a a --agent-b b");
  const agentA = values["agent-a"];
  const agentB = values["agent-b"];
  if (!agentA || !agentB) die("compare needs --agent-a and --agent-b");

  const dataset = parseDataset(readFileSync(file, "utf8"));
  const provider = pickProvider(values.provider ?? "mock");
  const trials = Math.max(1, parseInt(values.trials ?? "3", 10) || 3);
  const graders = values.graders ? values.graders.split(",").map((s) => s.trim()) : ["contains"];

  const plugins = loadConfig(resolve(values.config ?? "configs"));
  const bodyOf = (name: string): string => {
    const a = plugins.find((p) => p.kind === "agent" && p.name === name);
    if (!a) die(`agent not found in configs: ${name}`);
    return a.body;
  };
  const sysA = bodyOf(agentA);
  const sysB = bodyOf(agentB);

  const mk = (system: string): Runner => async (input) => {
    const res = await provider.complete({ system, messages: [{ role: "user", content: input }], maxTokens: 512 });
    return { text: res.text, costUsd: res.costUsd };
  };

  const res = await compare({
    dataset,
    runA: mk(sysA),
    runB: mk(sysB),
    trials,
    graders,
  });

  if (values.json) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return;
  }
  process.stdout.write(`\nA/B: ${agentA} vs ${agentB}  (${trials} trials/case, ${dataset.length} cases)\n\n`);
  process.stdout.write(`  ${agentA.padEnd(20)} pass@1 = ${res.aPassAt1.toFixed(3)}\n`);
  process.stdout.write(`  ${agentB.padEnd(20)} pass@1 = ${res.bPassAt1.toFixed(3)}\n\n`);
  process.stdout.write(`  winner:        ${res.winner === "tie" ? "tie" : res.winner === "a" ? agentA : agentB}\n`);
  process.stdout.write(`  delta (B - A): ${res.delta >= 0 ? "+" : ""}${res.delta.toFixed(3)}\n`);
  process.stdout.write(`  95% CI:        [${res.ciLow.toFixed(3)}, ${res.ciHigh.toFixed(3)}]\n`);
  process.stdout.write(`  confidence:    ${(res.confidence * 100).toFixed(1)}%\n`);
  process.stdout.write(`  significant:   ${res.significant ? "YES (the difference is unlikely to be noise)" : "no (treat as noise)"}\n`);
}

function cmdStatus(): void {
  const store = new Store(process.cwd());
  const runs = store.listRuns();
  const evals = store.listEvals();
  const skills = store.listSkills();

  process.stdout.write(`forge status  (store: ${store.dir})\n`);
  process.stdout.write(`\nRuns (${runs.length})\n`);
  for (const r of runs.slice(-5)) {
    process.stdout.write(`  ${r.status.padEnd(8)} ${r.workflow.padEnd(20)} ${formatTokens(r.inputTokens + r.outputTokens)} · ${formatUsd(r.costUsd)}\n`);
  }
  process.stdout.write(`\nEvals (${evals.length})\n`);
  for (const e of evals.slice(-5)) {
    process.stdout.write(`  ${e.agent.padEnd(16)} ${e.dataset.slice(-28).padEnd(28)} pass@1=${e.passAt1.toFixed(2)}\n`);
  }
  const byStatus = { proposed: 0, approved: 0, rejected: 0, installed: 0 } as Record<string, number>;
  for (const s of skills) byStatus[s.status]++;
  process.stdout.write(`\nSkills: ${byStatus.proposed} proposed · ${byStatus.installed} installed · ${byStatus.rejected} rejected\n`);
}

main().catch((e) => die(e instanceof Error ? e.stack ?? e.message : String(e)));

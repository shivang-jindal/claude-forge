# ⚒️ claude-forge

**Config-as-code orchestration for Claude Code. Not config-as-content.**

> Inspired by [`everything-claude-code`](https://github.com/WorldFlowAI/everything-claude-code) —
> which is an excellent *library* of copy-paste markdown configs. **forge** keeps that library
> and adds the thing static configs can't do: a **runtime that executes them.**

`everything-claude-code` gives you agents, skills, hooks, and rules you copy into `~/.claude`.
They are inert until a human drives them. **forge** treats the same artifacts as **plugins inside a
programmable engine** — with real workflows, retries, parallelism, evals that score the output, a
loop that learns from its own mistakes, and a token/cost meter that never lets you blow the context window.

| | everything-claude-code | **claude-forge** |
|---|---|---|
| Nature | Markdown library you copy around | **Runtime** + a bundled config library |
| Agents / skills | ✅ static files | ✅ loaded as typed **plugins** (52 bundled) |
| Workflows | Implicit (you drive them) | **Declarative DAGs** with deps, retries, timeouts, branches |
| Parallelism | Manual worktree advice | **Bounded fan-out**, git **worktrees**, **cascade** — as code |
| Evals | Described in prose | **Executable harness**: pass@k, 12 pluggable graders, regression tracking |
| A/B testing | Not present | **Bootstrap significance** — is change B *actually* better than A? |
| Hooks | Static `hooks.json` samples | **Executable hook runtime** — observe *or veto* any lifecycle event |
| Guardrails | A `security` rule (prose) | **Enforceable policy engine** — deny / require-approval, wired to hooks |
| Rollback | Not present | **Saga compensation** — undo completed work in reverse on failure |
| Interruption | `/checkpoint` command (manual) | **Checkpoint / resume** — the engine skips already-finished steps |
| Memory | `memory-persistence` hook (markdown) | **Typed memory store** with keyword retrieval + usage recency |
| Reliability | Not present | **Token-bucket rate limiting** + **circuit breaker** (with half-open probing) |
| Self-improvement | `continuous-learning` skill (manual) | **Automatic** extraction → clustering → versioned skill proposals with an approval gate |
| Context / tokens | "don't enable too many MCPs" | **Live budgeter** that tracks cost per step and **auto-compacts** |
| Dependencies | — | **Zero.** Runs on Node 24+ native TypeScript. No `npm install`. |

The configs are still here — agents, skills, commands, rules in [`configs/`](./configs) — but they are
**first-class inputs to a system that can run, measure, and improve them.**

---

## Quickstart (zero install)

forge runs TypeScript directly on Node 24+ (native type stripping; no build step). There is
nothing to compile and nothing to install.

```bash
# Option A — clone and run it (no install at all)
git clone https://github.com/shivang-jindal/claude-forge.git
cd claude-forge
node src/cli.ts --help

# Option B — install the CLI globally
npm install -g claude-forge-cli
forge --help
```

Then, from either:

```bash
# 1. Scaffold a forge project (loads the bundled config library)
node src/cli.ts init my-ai-app

# 2. Run a declarative workflow (retries + parallel branches + token budget, handled for you)
node src/cli.ts run workflows/example-feature.json

# 3. Score it. pass@k over a dataset, with graders. Results persist and regressions are flagged.
node src/cli.ts eval evals/feature.dataset.json --trials 5

# 4. Point it at real Claude (uses ANTHROPIC_API_KEY). Falls back to a deterministic mock offline.
export ANTHROPIC_API_KEY=sk-ant-...
node src/cli.ts run workflows/example-feature.json --provider anthropic

# 5. Teach it. Extract reusable patterns from a session log → versioned skill proposals.
node src/cli.ts learn examples/session-log.jsonl

# 6. Inspect state, token spend, and eval history.
node src/cli.ts status

# 7. See the plan before you run it.
node src/cli.ts graph workflows/example-feature.json --mermaid

# 8. Guardrails: check an action before anything runs it.
node src/cli.ts policy check --command "rm -rf /"
```

> **A note on the npm package.** Node deliberately refuses to strip TypeScript
> types from files inside `node_modules`. Rather than add a build step and ship
> a second copy of the source, the published package ships the *same*
> TypeScript you read in this repository and registers a tiny loader hook
> (`bin/loader.js`) that strips the types at load time. So `npm i -g
> claude-forge-cli` runs the identical code — no compiler, no build, no
> dependencies. `tests/packaging.test.ts` verifies every module still loads
> through that loader.

Run the test suite (all capabilities are covered):

```bash
npm test          # or: node --test tests/*.test.ts
```

---

## The four things static configs can't do

### 1. ⚖️ Verification & eval harness — *prove* it works

Stop trusting vibes. Define a dataset, pick graders, run N trials, get **pass@k** and a regression
verdict against your last green baseline.

```ts
import { readFileSync } from "node:fs";
import { runEval, parseDataset } from "./src/eval/harness.ts";
import { makeProvider } from "./src/core/llm.ts";

const provider  = makeProvider("anthropic");
const dataset   = parseDataset(readFileSync("evals/bugs.dataset.json", "utf8")); // { id, input, expected }[]

const result = await runEval({
  dataset,                                    // an EvalCase[] (use parseDataset to load a file)
  run: async (input) => {                     // your runner: (input) => string | { text, costUsd }
    const r = await provider.complete({ messages: [{ role: "user", content: input }] });
    return { text: r.text, costUsd: r.costUsd };  // cost is aggregated for you
  },
  trials: 5,                                  // k trials per case → pass@1 and pass@k
  graders: ["contains"],                      // exact | contains | regex | test-command | llm-judge | your fn
  mode: "continuous",                         // default: persists + flags regressions. "checkpoint" = report-only
});
// → { passAt1, passAtK, costUsd, cases, regressions, clean }
```

Graders are pluggable — 12 built in: `exact`, `contains`, `contains-any`,
`contains-all`, `not-contains`, `regex`, `similarity` (Levenshtein threshold),
`json-valid`, `json-path`, `schema` (mini JSON Schema), `test-command` (runs a
real command — output/expected are passed as `FORGE_OUTPUT`/`FORGE_EXPECTED`
env vars), and `llm-judge` (scores against a rubric). Or bring your own
`(output, expected, ctx) => { passed, score }`.
From the CLI, `forge eval` wires the agent-by-name and file-loading for you.

### 2. 🚀 Parallel orchestration — one command, many workers

- **Bounded fan-out** — map 100 tasks through 8 workers, errors isolated, order preserved.
- **Git worktrees** — run the same workflow across N isolated checkouts, then merge results.
- **Cascade** — try the cheap model first, escalate to the strong one only on failure. Cheaper, still good.

```ts
import { fanOut } from "./src/orchestration/fanout.ts";
const results = await fanOut(files, async (file) => reviewFile(file), { concurrency: 8 });
```

### 3. 🧬 Self-improving loop — it gets better the more you use it

forge reads your session logs, detects **repeated corrections** (the same fix you keep re-applying),
and emits **versioned skill proposals**. Nothing is auto-applied — there is a **human approval gate**.

```bash
node src/cli.ts learn examples/session-log.jsonl   # mine one session log (JSONL)
node src/cli.ts skill list                          # proposals look like: skill-1a2b3c4d
node src/cli.ts skill approve skill-1a2b3c4d       # you stay in control
```

### 4. 🧠 Context & token intelligence — never blow the window again

A live budgeter tracks tokens **and dollars per step**, and **auto-compacts** older turns
(summarize / truncate / drop) before you cross the ceiling. Every workflow step can declare its own budget.

```ts
ctx.addMessage("user", hugeDoc);
ctx.maybeCompact();          // over threshold → compacts older turns, keeps the recent ones
ctx.usage().costUsd;         // USD spent so far (real for API providers, 0 for mock/local)
ctx.tokenCount();            // resident-context token count
```

---

## Everything else in the box

The four above are the headline. These are the rest of the engine — each one
is implemented, wired into the CLI, and covered by tests.

### 🔌 Executable hooks (observe **or veto** any moment)

ECC ships *samples* of `hooks.json`. forge ships a **hook runtime**. A hook
sees every lifecycle event and can block one:

```ts
import { Hooks } from "./src/core/hooks.ts";

const hooks = new Hooks();
hooks.on("step:start", "no-generated-files", (e) =>
  e.stepId === "codegen" ? { block: true, reason: "codegen is disabled" } : undefined,
);
hooks.on(["step:end"], "record-cost", (e) => ({ meta: { costUsd: e.data?.costUsd } }));
```

Phases: `run:start`, `run:end`, `step:start`, `step:end`, `step:retry`,
`step:skip`, `tool:pre`, `tool:post`, `compact`, `budget:exceeded`,
`eval:start`, `eval:end`, `learn:proposed`, `skill:approved`.

Hooks can also be **config-driven** — shell commands in `configs/hooks/*.json`,
so a team can add a check without touching TypeScript:

```json
{
  "name": "no-secrets-in-output",
  "phases": ["step:end"],
  "command": "node -e \"if(/PRIVATE KEY/.test(process.env.FORGE_DATA_OUTPUT||''))process.exit(1)\"",
  "blockOnFail": true
}
```

The command gets `FORGE_PHASE`, `FORGE_RUN_ID`, `FORGE_STEP_ID`, `FORGE_TOOL`,
`FORGE_DATA` and `FORGE_DATA_OUTPUT` in its environment. Exit non-zero blocks
the step. `forge hooks list` shows what's registered.

### 🛡️ Guardrails you can actually enforce

A rule file is advice. forge's policy engine **blocks** things:

```bash
forge policy list
forge policy check --command "rm -rf /"          # DENIED
forge policy check --command "git push --force"  # NEEDS APPROVAL
forge policy check --command "npm test"          # ALLOWED
```

Seven built-in rules (recursive root deletes, `curl | sh`, credential paths,
secrets in content, force-push, prod mutations, lockfile deletion). Add your
own with `{ id, description, effect: "deny" | "require-approval", match }`.
The policy engine is wired into the hook runtime as a `tool:pre` guard, so
denials apply automatically during a run.

### 💾 Checkpoint & resume — don't restart a long run

```bash
node src/cli.ts run workflows/example-feature.json --checkpoint   # save progress
node src/cli.ts run workflows/example-feature.json --resume       # skip finished steps
node src/cli.ts checkpoint list
```

The engine pre-seeds completed steps from the checkpoint, so resumed steps
keep their **previous output** and downstream steps see it.

### ↩️ Saga — roll back on failure

```ts
import { runSaga } from "./src/orchestration/saga.ts";

const res = await runSaga([
  { id: "charge",   run: chargeCard,   compensate: refundCard },
  { id: "provision", run: provisionVM, compensate: destroyVM },
  { id: "email",    run: sendWelcome },
]);
// If "email" throws: "provision" and "charge" are compensated in REVERSE order.
```

### 🚦 Rate limiting & circuit breaking

```ts
import { TokenBucket, CircuitBreaker } from "./src/core/ratelimit.ts";

const limiter = new TokenBucket(60, 1);          // 60 calls, refilling 1/sec
const breaker = new CircuitBreaker(5, 30_000);   // open after 5 failures, probe after 30s

await new Engine({ provider, limiter, breaker }).run(workflow);
```

When the provider is down, the breaker **opens** and stops hammering it; after
the cooldown it lets a single probe through (half-open), and closes again on
success. Both accept an injectable clock, so they're testable without waiting.

### 🧠 Persistent memory

```bash
forge memory add "Prefer strict TypeScript" --kind preference --tags typescript
forge memory search "strict typescript"
forge memory list
forge memory rm mem-xxxx
```

Typed entries (`fact` / `preference` / `instruction` / `pattern`), keyword +
tag retrieval, usage-recency scoring, and durable storage in
`.forge/memory.json`.

### 🧪 A/B testing with real statistics

"Did the new prompt actually help, or is that noise?" forge answers it with a
**bootstrap confidence interval** over the same dataset and graders:

```bash
node src/cli.ts compare evals/feature.dataset.json --agent-a planner --agent-b implementer
```

Real output from the **offline `mock`** provider:

```
A/B: planner vs implementer  (3 trials/case, 4 cases)

  planner              pass@1 = 1.000
  implementer          pass@1 = 1.000

  winner:        tie
  delta (B - A): +0.000
  95% CI:        [0.000, 0.000]
  confidence:    100.0%
  significant:   no (treat as noise)
```

**That tie is expected, and here is why:** the `mock` provider derives its
output from the *input*, so two different agents given the same input return
the *same* text — there is no signal to separate. The harness is working
correctly; the mock simply cannot express a difference between two prompts.

To get a real comparison, point it at a real model, where the system prompt
actually changes the answer:

```bash
node src/cli.ts compare evals/feature.dataset.json \
  --agent-a planner --agent-b implementer --provider anthropic
```

```
  winner:        implementer
  delta (B - A): +0.250
  95% CI:        [0.083, 0.417]
  confidence:    96.4%
  significant:   YES (the difference is unlikely to be noise)
```

*(The numbers above are the output **shape**, not a transcript — they depend on
your agents, your dataset, and the model. The `mock` transcript above is real
and reproducible.)*

The bootstrap resamples cases with replacement to build a percentile interval
on the mean difference. If the interval excludes zero, the difference is
reported as significant; otherwise forge tells you to treat it as noise.

### 🗺️ See the plan before you run it

```bash
node src/cli.ts graph workflows/example-feature.json --mermaid
```

Real output:

```
example-feature

L0: plan
   ------------------
L1: implement
   ------------------
L2: review

critical path: plan -> implement -> review
max parallelism: 1
```

Plus a Mermaid flowchart you can paste into a PR.

### 📚 A much larger config library

**52 bundled plugins** — 18 agents, 12 skills, 13 commands, 9 rules — covering
Go, Rust, Django, Kubernetes, Terraform, ML, frontend, databases, e2e, API
design, performance, incident response and more. All are plain markdown with
frontmatter: read them, edit them, copy them into your own project.

---

## Architecture

```
src/
  core/
    engine.ts     Declarative workflow engine: DAG deps, parallel execution, retries+backoff,
                  timeouts, conditional branching, per-step budgets, event stream, agent
                  system-prompt injection, resume-from-checkpoint.
    context.ts    ContextManager: token/cost metering + auto-compaction strategies.
    llm.ts        Provider abstraction (Anthropic / OpenAI / Ollama / deterministic Mock).
    tokens.ts     Token estimator + per-model pricing table.
    store.ts      Atomic JSON state store (.forge/) — run history, evals, skill registry.
    hooks.ts      Typed lifecycle hook runtime — observers and vetoes.
    hookconfig.ts Loads configs/hooks/*.json as executable hooks.
    policy.ts     Guardrail engine (deny / require-approval) + hook integration.
    memory.ts     Persistent typed memory with keyword/recency retrieval.
    ratelimit.ts  Token bucket + circuit breaker (injectable clock).
    checkpoint.ts Checkpoint store for run resume.
  config/
    frontmatter.ts  Minimal YAML-frontmatter parser for the markdown config library.
    loader.ts       Loads configs/agents|skills|commands|rules into typed plugins.
    registry.ts     Plugin registry with activation + dependency ordering.
  eval/
    graders.ts    12 pluggable graders (exact/contains/regex/test-command/llm-judge/
                  contains-all/not-contains/similarity/json-valid/json-path/schema/custom).
    harness.ts    Runs an agent over a dataset, k trials → pass@k, checkpoint or continuous.
    metrics.ts    pass@k math + regression detection against a stored baseline.
    compare.ts    A/B comparison with a bootstrap confidence interval.
  orchestration/
    fanout.ts     Bounded-concurrency map with isolated errors + preserved order.
    worktrees.ts  Create/clean isolated git worktrees for parallel runs.
    cascade.ts    Cheap-model-first escalation.
    saga.ts       Compensating transactions — reverse-order rollback on failure.
    graph.ts      DAG analysis (levels, critical path) + Mermaid/ASCII rendering.
  learning/
    logformat.ts  Session-log schema (Claude Code JSONL compatible).
    extractor.ts  Heuristic pattern extraction (repeated fixes, lint loops, self-corrections).
    proposal.ts   Candidate → versioned skill proposal + approval gate + dedupe.
    cluster.ts    Groups near-duplicate patterns so one skill covers the family.
  cli.ts          `forge` command dispatcher (node:util parseArgs — no deps).
scripts/
  rename.ts      One-command project rename (repo, npm package, CLI binary, state dir).
configs/          The bundled, editable config library (agents, skills, commands, rules, hooks).
workflows/        Example declarative workflow DAGs.
evals/            Eval datasets (+ README explaining what each one proves).
examples/         Sample session log for `learn`.
tests/            Unit tests for every capability.
```

**Zero runtime dependencies.** Everything uses Node built-ins (`node:test`, `node:util`,
`node:fs`, global `fetch`). That is the point: an orchestration engine should not drag in 300 packages.

---

## Why "more powerful"

1. **It executes.** The original is a menu. forge is a machine that runs the menu — and tells you
   whether the meal was any good.
2. **It measures.** Every agent and workflow is testable. pass@k + graders turn "looks right" into a number.
3. **It compares.** A/B with a bootstrap CI tells you whether a change helped or you're fooling yourself.
4. **It compounds.** Usage produces learnings; learnings are clustered into versioned skills; skills
   improve the next run.
5. **It respects the meter.** Token and cost budgeting is a first-class primitive, not an afterthought.
6. **It scales out.** Bounded fan-out, worktrees, and cascade turn one session into a coordinated swarm.
7. **It fails safely.** Retries, timeouts, circuit breaking, saga rollback, checkpoints, and resumes.
8. **It enforces.** Guardrails and hooks that actually block, not a rule file nobody reads.
9. **It stays honest.** Human approval gate on self-modification. Deterministic mock for offline/CI.

---

## Bring your own model

forge is **model-agnostic**. Every capability talks to the `LLMProvider` interface, so
swapping the backend is a one-liner:

```bash
--provider mock       # deterministic, offline, free (default; powers all tests)
--provider anthropic  # requires ANTHROPIC_API_KEY
--provider openai     # requires OPENAI_API_KEY   (any OpenAI-compatible API via OPENAI_BASE_URL)
--provider ollama     # free local models via Ollama (OLLAMA_MODEL, e.g. llama3.1)
```

Adding OpenAI, a local Ollama, a hosted alternative, or a fully deterministic CI stub is a
single file against the interface — the bundled **Mock** provider runs every test with no
network and no key. OpenAI-compatible endpoints (vLLM, LM Studio, OpenRouter, …) work by
pointing `OPENAI_BASE_URL` at them.

---

## CI: fail the build on an eval regression

The thing static configs can't do — and the reason teams adopt forge — is a **quality gate**.
`forge ci` runs your unit tests **and** your eval datasets, then exits non-zero if tests fail,
an eval drops below its floor, or pass@1 regresses vs the last stored run.

```bash
node src/cli.ts ci                 # reads forge.config.json, runs tests + evals
node src/cli.ts ci --skip-tests    # eval gate only
```

`forge.config.json`:

```json
{
  "provider": "mock",
  "evals": [
    { "dataset": "evals/feature.dataset.json", "trials": 3, "graders": ["contains"], "floor": 1.0 },
    { "dataset": "evals/arithmetic-exact.dataset.json", "trials": 3, "graders": ["exact"], "floor": 1.0 },
    { "dataset": "evals/quality.dataset.json", "trials": 2, "graders": ["similarity"], "floor": 1.0 }
  ]
}
```

See [`evals/README.md`](./evals/README.md) for what each bundled dataset proves
(and what it does **not** prove).

A ready-to-run **GitHub Actions** workflow ships in [`.github/workflows/forge-ci.yml`](./.github/workflows/forge-ci.yml)
— it checks out, sets up Node 24, and runs `node src/cli.ts ci`. No `npm install` step,
because there is nothing to install. Uncomment the env block to grade real model output on PRs.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add a **provider**, **grader**, **agent**,
**hook**, **policy rule**, or **capability** — plus the native-TypeScript rules (erasable syntax,
`.ts` import extensions, zero deps) that keep forge runnable without a build step.

Every API example in this README is **executed as a test** in
[`tests/readme.test.ts`](./tests/readme.test.ts) — if the docs drift from the code, the test
suite fails.

---

## Honest limitations (read this)

No smoke and mirrors. Here's exactly what's real and what's a demonstration:

- **The default provider is a deterministic `mock`.** It runs offline, costs $0, and returns
  predictable, content-derived output so tests and CI are reproducible. It is **not** a real
  model. Getting `pass@1 = 1.0` on the bundled `evals/feature.dataset.json` (arithmetic like
  `add 2 and 3`) proves the **harness wiring works** — it is *not* a claim about model
  intelligence. Point `--provider anthropic|openai|ollama` at a real model to evaluate one.
- **Token counts** are *exact* for Anthropic, OpenAI, and Ollama (we read the provider's own
  `usage` / `prompt_eval_count`). For the `mock` they're a fast chars/4 *estimate* — fine for
  budgeting, not for billing.
- **The pricing table** (`src/core/tokens.ts`) is an estimate for cost *display*. Prices change;
  it is not authoritative. Override or update it as needed.
- **The self-improving loop is heuristic.** It matches *repeated text signatures* (corrections,
  rituals, lint loops) in your session logs — it does not "understand" them. It surfaces
  *candidates*; a human approves or rejects. It will not catch a correction phrased two
  different ways.
- **`cascade` and `worktrees` are real and tested** against actual `git`. `cascade`'s quality
  check is *your* `isGood` callback — forge won't decide what "good enough" means.
- **`test-command` graders execute a real shell command.** On Windows the inline `{{output}}`
  substitution is best-effort; the `FORGE_OUTPUT` / `FORGE_EXPECTED` env-var form is the
  cross-platform-safe path.
- **The A/B bootstrap assumes the cases are independent samples.** If your dataset has
  correlated or duplicated cases, the confidence interval will be too narrow. The
  bootstrap itself is seeded and reproducible, but it cannot fix a biased dataset.
- **The policy engine matches with regexes, not semantics.** It catches the shapes it was
  given (`rm -rf /`, `curl | sh`, an `AKIA…` key) and will happily miss a novel spelling.
  It is a speed bump, not a sandbox.
- **Config-driven hooks run real shell commands** with your permissions. A hook is only as
  trustworthy as the command in it. Read them before you trust them.
- **Memory retrieval is keyword + tag overlap**, not semantic search. It will not match
  "avoid `console.log`" to "no debugging output" — that needs embeddings.
- **The circuit breaker is per-`Engine` instance.** It is not shared across processes, and
  the token bucket's rate is whatever you configure — it is not read from your provider's
  published RPM/TPM limits.
- **Sagas only compensate what you give them.** A step with no `compensate()` is not undone.
  External side effects (a sent email, a charged card) need a real compensation function.
- **Checkpoint/resume restores step *outputs*, not external state.** If a step changed
  something outside the workflow (a deployed service, a file another system reads), resuming
  will not undo that.

If something here says it does X, there's a test that runs X.

---

## License

MIT. Contributions welcome — the config library in [`configs/`](./configs) is meant to be forked,
trimmed, and extended for your stack.

**Star the original. Then forge yours.**

---

## Independence notice

`claude-forge` is an independent, open-source project. It is **not affiliated with, endorsed
by, or sponsored by Anthropic PBC**. "Claude", "Claude Code", and "Anthropic" are trademarks of
Anthropic PBC; they are used here only to describe compatibility — this is a third-party tool
that works with Claude Code, and it also works with OpenAI, Ollama, and any OpenAI-compatible
endpoint. Use of the trademarks in the project name is a nominative reference to the tool it
integrates with, and does not imply any sponsorship or endorsement.

If you fork this, please keep a similar notice in your fork.

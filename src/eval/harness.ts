/**
 * Eval harness — run an agent/runner over a dataset, k trials per case,
 * grade each trial, compute pass@1 and pass@k, and detect regressions against
 * a stored baseline. Cases run through bounded fan-out.
 *
 * Signature capability #1: turn "looks right" into a number.
 */

import { fanOut } from "../orchestration/fanout.ts";
import type { LLMProvider } from "../core/llm.ts";
import type { Store } from "../core/store.ts";
import { resolveGrader, type GraderSpec, type GraderContext } from "./graders.ts";
import { passAtK, detectRegression, mean, type Regression } from "./metrics.ts";

export interface EvalCase {
  id: string;
  input: string;
  expected: string;
  meta?: Record<string, unknown>;
}

export type RunOutput = string | { text: string; costUsd?: number };
export type Runner = (input: string, ctx: { id: string; trial: number }) => RunOutput | Promise<RunOutput>;

export interface RunEvalOptions {
  dataset: EvalCase[];
  run: Runner;
  /** k: trials per case. Default 1. */
  trials?: number;
  /** Grader specs. Default ["contains"]. */
  graders?: GraderSpec[];
  /** Concurrency across cases. Default 4. */
  concurrency?: number;
  provider?: LLMProvider;
  /** Persist + compare against baseline when provided with agent & dataset names. */
  store?: Store;
  agent?: string;
  datasetName?: string;
  regressionThreshold?: number;
  mode?: "checkpoint" | "continuous";
  onProgress?: (done: number, total: number) => void;
}

export interface TrialResult {
  passed: boolean;
  score: number;
  output: string;
  reason?: string;
}

export interface CaseResult {
  id: string;
  trials: TrialResult[];
  passAt1: number;
  passAtK: number;
}

export interface EvalResult {
  agent: string;
  dataset: string;
  trials: number;
  passAt1: number;
  passAtK: number;
  costUsd: number;
  cases: CaseResult[];
  regressions: Regression[];
  /** true when no regressions were flagged. */
  clean: boolean;
}

export async function runEval(opts: RunEvalOptions): Promise<EvalResult> {
  const k = Math.max(1, opts.trials ?? 1);
  const concurrency = opts.concurrency ?? 4;
  const specList: GraderSpec[] = opts.graders ?? ["contains"];
  const graders = specList.map(resolveGrader);

  // Accumulates runner-reported cost across all trials (JS is single-threaded,
  // so concurrent cases sharing this closure variable is safe).
  let totalCost = 0;

  const evalCase = async (c: EvalCase): Promise<CaseResult> => {
    const trials: TrialResult[] = [];
    for (let t = 0; t < k; t++) {
      const raw = await opts.run(c.input, { id: c.id, trial: t });
      const output = typeof raw === "string" ? raw : raw.text;
      // Accumulate any cost the runner reported for this trial.
      if (typeof raw !== "string" && typeof raw.costUsd === "number") totalCost += raw.costUsd;
      // All graders must pass for the trial to count as correct.
      let passed = true;
      let bestScore = 1;
      let firstReason: string | undefined;
      for (const g of graders) {
        const ctx: GraderContext = { id: c.id, provider: opts.provider };
        const r = await g(output, c.expected, ctx);
        if (!r.passed) {
          passed = false;
          bestScore = Math.min(bestScore, r.score);
          firstReason = firstReason ?? r.reason;
        } else {
          bestScore = Math.min(bestScore, r.score);
        }
      }
      trials.push({ passed, score: passed ? bestScore : bestScore, output, reason: firstReason });
    }
    const correct = trials.filter((t) => t.passed).length;
    return {
      id: c.id,
      trials,
      passAt1: passAtK(correct, k, 1),
      passAtK: passAtK(correct, k, k),
    };
  };

  const caseResults = await fanOut(opts.dataset, evalCase, {
    concurrency,
    isolateErrors: true,
    onProgress: opts.onProgress,
  });

  // If a case runner threw, record it as an all-fail case.
  const cases: CaseResult[] = caseResults.map((r) =>
    r.ok && r.value
      ? r.value
      : { id: String(r.item.id), trials: [], passAt1: 0, passAtK: 0 },
  );

  const passAt1 = mean(cases.map((c) => c.passAt1));
  const passAtKAgg = mean(cases.map((c) => c.passAtK));

  // Cost: aggregate any per-trial cost the runner reported (0 for the mock).
  const costUsd = totalCost;

  // Regression vs stored baseline. `mode` controls persistence:
  //  - "continuous" (default): persist the result so the NEXT run can detect a regression.
  //  - "checkpoint": evaluate + report only; don't write to history (a cheap one-off gate).
  const agent = opts.agent ?? "custom";
  const dataset = opts.datasetName ?? "inline";
  const persist = opts.mode !== "checkpoint";
  let regressions: Regression[] = [];
  if (opts.store) {
    const baseline = opts.store.latestEval(agent, dataset);
    const reg = detectRegression(passAt1, baseline?.passAt1, {
      metric: "pass@1",
      threshold: opts.regressionThreshold ?? 0.05,
    });
    if (reg) regressions = [reg];
    if (persist) {
      opts.store.addEval({
        id: `${agent}:${dataset}:${Date.now()}`,
        agent,
        dataset,
        trials: k,
        passAt1,
        passAtK: passAtKAgg,
        costUsd,
        at: new Date().toISOString(),
      });
    }
  }

  return {
    agent,
    dataset,
    trials: k,
    passAt1,
    passAtK: passAtKAgg,
    costUsd,
    cases,
    regressions,
    clean: regressions.every((r) => !r.regressed),
  };
}

/** Load an eval dataset from a JSON file (array of EvalCase). */
export function parseDataset(json: string): EvalCase[] {
  // Strip a UTF-8 BOM (Windows tools write one; JSON.parse rejects it).
  const data = JSON.parse(json.replace(/^\uFEFF/, "")) as EvalCase[];
  if (!Array.isArray(data)) throw new Error("dataset must be a JSON array");
  for (const c of data) {
    if (!c.id || typeof c.input !== "string" || typeof c.expected !== "string") {
      throw new Error(`invalid eval case: ${JSON.stringify(c).slice(0, 100)}`);
    }
  }
  return data;
}

/**
 * A/B comparison between two agents / prompts, with statistical significance.
 *
 * Run two runners over the same dataset, compute per-case pass rates, then
 * bootstrap a confidence interval on the difference. This answers the question
 * static configs never can: "did change B *actually* beat change A, or is it
 * noise?" — using the same graders as the main harness.
 */

import type { EvalCase, Runner } from "./harness.ts";
import { resolveGrader, type GraderSpec } from "./graders.ts";

export interface CompareOptions {
  dataset: EvalCase[];
  runA: Runner;
  runB: Runner;
  trials?: number;
  graders?: GraderSpec[];
  /** Bootstrap resamples (default 2000). */
  bootstrap?: number;
  /** Significance level (default 0.05 → 95% CI). */
  alpha?: number;
  /** RNG seed for reproducible bootstrap (default 1). */
  seed?: number;
}

export interface CompareResult {
  aPassAt1: number;
  bPassAt1: number;
  /** b − a (positive means B is better). */
  delta: number;
  winner: "a" | "b" | "tie";
  /** Fraction of bootstrap resamples agreeing with the observed direction. */
  confidence: number;
  significant: boolean;
  ciLow: number;
  ciHigh: number;
  perCase: { id: string; a: number; b: number }[];
}

/** Small, fast, seedable PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function casePassRate(
  c: EvalCase,
  run: Runner,
  trials: number,
  graders: ReturnType<typeof resolveGrader>[],
): Promise<number> {
  let passed = 0;
  for (let t = 0; t < trials; t++) {
    let ok = true;
    try {
      const raw = await run(c.input, { id: c.id, trial: t });
      const output = typeof raw === "string" ? raw : raw.text;
      for (const g of graders) {
        const r = await g(output, c.expected, { id: c.id });
        if (!r.passed) {
          ok = false;
          break;
        }
      }
    } catch {
      ok = false;
    }
    if (ok) passed += 1;
  }
  return trials > 0 ? passed / trials : 0;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export async function compare(opts: CompareOptions): Promise<CompareResult> {
  const trials = opts.trials ?? 1;
  const graders = (opts.graders ?? ["contains"]).map(resolveGrader);
  const bootstrapN = opts.bootstrap ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  const rand = mulberry32(opts.seed ?? 1);

  const perCase: { id: string; a: number; b: number }[] = [];
  for (const c of opts.dataset) {
    const a = await casePassRate(c, opts.runA, trials, graders);
    const b = await casePassRate(c, opts.runB, trials, graders);
    perCase.push({ id: c.id, a, b });
  }

  const aVals = perCase.map((p) => p.a);
  const bVals = perCase.map((p) => p.b);
  const aPassAt1 = mean(aVals);
  const bPassAt1 = mean(bVals);
  const diffs = perCase.map((p) => p.b - p.a);
  const delta = mean(diffs);

  // Bootstrap the mean difference across resampled cases.
  const n = perCase.length;
  const samples: number[] = [];
  if (n > 0) {
    for (let i = 0; i < bootstrapN; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += diffs[Math.floor(rand() * n)];
      samples.push(sum / n);
    }
    samples.sort((x, y) => x - y);
  }
  const loIdx = Math.floor((alpha / 2) * samples.length);
  const hiIdx = Math.ceil((1 - alpha / 2) * samples.length) - 1;
  const ciLow = samples.length ? samples[loIdx] : 0;
  const ciHigh = samples.length ? samples[hiIdx] : 0;

  const significant = delta !== 0 && (ciLow > 0 || ciHigh < 0);
  const agreeing = samples.filter((s) => (delta >= 0 ? s >= 0 : s <= 0)).length;
  const confidence = samples.length ? agreeing / samples.length : 0;

  return {
    aPassAt1,
    bPassAt1,
    delta,
    winner: delta > 0 ? "b" : delta < 0 ? "a" : "tie",
    confidence,
    significant,
    ciLow,
    ciHigh,
    perCase,
  };
}

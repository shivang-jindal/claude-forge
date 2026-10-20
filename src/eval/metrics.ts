/**
 * Eval metrics — pass@k and regression detection.
 *
 * pass@k uses the standard unbiased estimator (Codex paper): the probability
 * that at least one of k randomly chosen samples is correct, given `correct`
 * passing samples out of `n` total trials.
 */

export interface Regression {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  threshold: number;
  regressed: boolean;
}

/**
 * Unbiased pass@k estimator.
 * @param correct number of passing trials
 * @param n total trials
 * @param k number of samples considered
 */
export function passAtK(correct: number, n: number, k: number): number {
  if (k <= 0) return 0;
  if (n <= 0) return 0;
  if (correct <= 0) return 0;
  if (n - correct < k) return 1; // enough correct samples to guarantee a hit
  // 1 - prod_{i=0..k-1} (n - correct - i) / (n - i)
  let prod = 1;
  for (let i = 0; i < k; i++) {
    prod *= (n - correct - i) / (n - i);
  }
  return 1 - prod;
}

/**
 * Compare a current metric against a stored baseline and flag regressions.
 * A metric regresses when it falls more than `threshold` (absolute, 0–1) below
 * the baseline.
 */
export function detectRegression(
  current: number,
  baseline: number | undefined,
  opts: { metric?: string; threshold?: number } = {},
): Regression | null {
  if (baseline === undefined) return null;
  const threshold = opts.threshold ?? 0.05;
  const delta = current - baseline;
  return {
    metric: opts.metric ?? "pass@1",
    baseline,
    current,
    delta,
    threshold,
    regressed: delta < -threshold,
  };
}

/** Mean of a numeric array (0 for empty). */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

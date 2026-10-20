/**
 * Token estimation + per-model pricing.
 *
 * We ship a fast heuristic (chars/4) so forge works offline with zero deps, and
 * allow a pluggable real counter (e.g. tiktoken) to be injected for exactness.
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMtc: number;
  /** USD per 1M output tokens. */
  outputPerMtc: number;
}

/** Fallback pricing table (USD per 1M tokens). Update as prices change. */
export const PRICING: Record<string, ModelPricing> = {
  "claude-3-5-haiku": { inputPerMtc: 0.8, outputPerMtc: 4 },
  "claude-3-5-sonnet": { inputPerMtc: 3, outputPerMtc: 15 },
  "claude-3-7-sonnet": { inputPerMtc: 3, outputPerMtc: 15 },
  "claude-sonnet-4": { inputPerMtc: 3, outputPerMtc: 15 },
  "claude-opus-4": { inputPerMtc: 15, outputPerMtc: 75 },
  "gpt-4o-mini": { inputPerMtc: 0.15, outputPerMtc: 0.6 },
  "gpt-4o": { inputPerMtc: 2.5, outputPerMtc: 10 },
  "gpt-4.1-mini": { inputPerMtc: 0.4, outputPerMtc: 1.6 },
  "gpt-4.1": { inputPerMtc: 2, outputPerMtc: 8 },
  "o4-mini": { inputPerMtc: 1.1, outputPerMtc: 4.4 },
  mock: { inputPerMtc: 0, outputPerMtc: 0 },
};

export type TokenCounter = (text: string) => number;

/**
 * Fast heuristic counter: ~4 chars/token for English, with a floor so short
 * strings don't round to 0. Good enough for budgeting; inject a real one for
 * billing-grade accuracy.
 */
export const estimateTokens: TokenCounter = (text) => {
  if (!text) return 0;
  // Weight whitespace/newlines slightly — code tokenizes denser than prose.
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return Math.max(1, Math.ceil((chars / 4 + words * 0.15)));
};

export function pricingFor(model: string): ModelPricing {
  const key = Object.keys(PRICING).find((k) => model.includes(k));
  return key ? PRICING[key] : { inputPerMtc: 0, outputPerMtc: 0 };
}

export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = pricingFor(model);
  return (inputTokens / 1_000_000) * p.inputPerMtc + (outputTokens / 1_000_000) * p.outputPerMtc;
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}t`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

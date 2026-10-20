/**
 * Cascade orchestration — cheap model first, escalate only on failure.
 *
 * Sends the request to a fast/cheap provider; if its output passes your
 * `isGood` check, done. Otherwise escalate to a stronger provider. Cheaper on
 * average, still high quality. Signature capability #2.
 */

import type { CompleteRequest, LLMProvider } from "../core/llm.ts";

export interface CascadeOptions {
  /** Fast/cheap provider tried first. */
  cheap: LLMProvider;
  /** Strong/expensive provider used when the cheap one fails the check. */
  strong: LLMProvider;
  /** Decide whether the cheap output is acceptable. Default: non-empty. */
  isGood?: (text: string, req: CompleteRequest) => boolean;
  cheapModel?: string;
  strongModel?: string;
  maxCheapTokens?: number;
}

export interface CascadeResult {
  text: string;
  provider: string;
  escalated: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function cascade(
  req: CompleteRequest,
  opts: CascadeOptions,
): Promise<CascadeResult> {
  const isGood = opts.isGood ?? ((text: string) => text.trim().length > 0);

  const cheapRes = await opts.cheap.complete({
    ...req,
    model: opts.cheapModel ?? req.model,
    maxTokens: opts.maxCheapTokens ?? req.maxTokens,
  });
  if (isGood(cheapRes.text, req)) {
    return {
      text: cheapRes.text,
      provider: opts.cheap.name,
      escalated: false,
      inputTokens: cheapRes.inputTokens,
      outputTokens: cheapRes.outputTokens,
      costUsd: cheapRes.costUsd,
    };
  }

  const strongRes = await opts.strong.complete({
    ...req,
    model: opts.strongModel ?? req.model,
  });
  return {
    text: strongRes.text,
    provider: opts.strong.name,
    escalated: true,
    inputTokens: cheapRes.inputTokens + strongRes.inputTokens,
    outputTokens: cheapRes.outputTokens + strongRes.outputTokens,
    costUsd: cheapRes.costUsd + strongRes.costUsd,
  };
}

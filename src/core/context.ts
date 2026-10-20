/**
 * ContextManager — token & cost metering + auto-compaction.
 *
 * Signature capability #4. Wraps a provider, tracks input/output tokens and
 * dollars, and compacts older turns (summarize / truncate / drop) before the
 * context window is blown. Workflow steps and evals share this class so every
 * run reports an accurate spend.
 */

import type { ChatMessage, CompleteRequest, CompleteResponse, LLMProvider } from "./llm.ts";
import { estimateTokens, formatTokens } from "./tokens.ts";

export type CompactionStrategy = "summarize" | "truncate" | "drop";

export interface ContextOptions {
  /** Hard ceiling in tokens for the resident context. */
  maxTokens: number;
  /** Fraction of maxTokens (0–1) that triggers compaction. Default 0.85. */
  compactionThreshold?: number;
  /** Most-recent messages never compacted. Default 2. */
  keepRecent?: number;
  provider?: LLMProvider;
  model?: string;
}

export interface CompactionReport {
  strategy: CompactionStrategy;
  beforeTokens: number;
  afterTokens: number;
  messagesRemoved: number;
  tokensSaved: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  compactions: number;
}

export class ContextManager {
  private messages: ChatMessage[] = [];
  private readonly maxTokens: number;
  private readonly threshold: number;
  private readonly keepRecent: number;
  private provider?: LLMProvider;
  private model?: string;
  private spent: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, compactions: 0 };

  constructor(opts: ContextOptions) {
    this.maxTokens = opts.maxTokens;
    this.threshold = opts.compactionThreshold ?? 0.85;
    this.keepRecent = Math.max(1, opts.keepRecent ?? 2);
    this.provider = opts.provider;
    this.model = opts.model;
  }

  setProvider(provider: LLMProvider, model?: string): void {
    this.provider = provider;
    if (model) this.model = model;
  }

  addMessage(role: "user" | "assistant", content: string): void {
    this.messages.push({ role, content });
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** Resident-context token count (what actually competes for the window). */
  tokenCount(): number {
    return this.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }

  /** Fraction of the ceiling currently used (0–1+). */
  fillRatio(): number {
    return this.tokenCount() / this.maxTokens;
  }

  needsCompaction(): boolean {
    return this.fillRatio() >= this.threshold;
  }

  usage(): Usage {
    return { ...this.spent };
  }

  /** Human-readable spend line for status output. */
  spendLine(): string {
    const u = this.usage();
    return `${formatTokens(u.inputTokens + u.outputTokens)} tokens · $${u.costUsd.toFixed(4)} · ${u.compactions} compactions`;
  }

  /** Compact if over the threshold. Returns a report, or null if nothing to do. */
  maybeCompact(strategy: CompactionStrategy = "summarize"): CompactionReport | null {
    if (!this.needsCompaction()) return null;
    return this.compact(strategy);
  }

  /**
   * Force a compaction. Keeps the most-recent `keepRecent` messages intact and
   * folds everything older into the strategy's chosen reduction.
   */
  async compact(strategy: CompactionStrategy = "summarize"): Promise<CompactionReport | null> {
    const beforeTokens = this.tokenCount();
    if (this.messages.length <= this.keepRecent) return null;

    const cut = this.messages.length - this.keepRecent;
    const older = this.messages.slice(0, cut);
    const recent = this.messages.slice(cut);

    let head: ChatMessage[] = [];
    if (strategy === "drop") {
      head = [];
    } else if (strategy === "truncate") {
      const kept = older.map((m) => ({
        role: m.role,
        content: m.content.length > 400 ? `${m.content.slice(0, 400)}…[truncated]` : m.content,
      }));
      head = kept;
    } else {
      // summarize
      const summary = await this.summarize(older);
      head = [{ role: "user", content: `[conversation summary]\n${summary}` }];
    }

    this.messages = [...head, ...recent];
    const afterTokens = this.tokenCount();
    this.spent.compactions += 1;
    return {
      strategy,
      beforeTokens,
      afterTokens,
      messagesRemoved: older.length - head.length,
      tokensSaved: Math.max(0, beforeTokens - afterTokens),
    };
  }

  private async summarize(older: ChatMessage[]): Promise<string> {
    const transcript = older.map((m) => `${m.role}: ${m.content}`).join("\n");
    if (!this.provider) {
      // Offline fallback: deterministic extractive summary.
      const head = transcript.slice(0, 300);
      return `(${older.length} earlier turns condensed)\n${head}…`;
    }
    const req: CompleteRequest = {
      system:
        "You compress conversations. Summarize the following transcript into dense bullet notes " +
        "preserving decisions, open tasks, and any numbers. Output only the summary.",
      messages: [{ role: "user", content: transcript }],
      maxTokens: 300,
      model: this.model,
    };
    const res: CompleteResponse = await this.provider.complete(req);
    this.spent.inputTokens += res.inputTokens;
    this.spent.outputTokens += res.outputTokens;
    this.spent.costUsd += res.costUsd;
    return res.text.trim();
  }

  /**
   * Route a completion through the provider with this context's latest state,
   * metering usage. Appends the exchange to the resident context.
   */
  async complete(userContent: string, opts: Omit<CompleteRequest, "messages"> = {}): Promise<string> {
    if (!this.provider) throw new Error("ContextManager has no provider set");
    const req: CompleteRequest = {
      ...opts,
      model: opts.model ?? this.model,
      messages: [...this.messages, { role: "user", content: userContent }],
    };
    const res = await this.provider.complete(req);
    this.spent.inputTokens += res.inputTokens;
    this.spent.outputTokens += res.outputTokens;
    this.spent.costUsd += res.costUsd;
    this.addMessage("user", userContent);
    this.addMessage("assistant", res.text);
    return res.text;
  }
}

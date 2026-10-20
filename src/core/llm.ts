/**
 * LLM provider abstraction.
 *
 * Every forge capability is written against `LLMProvider`, so swapping the real
 * Anthropic API for OpenAI, a local Ollama model, or a deterministic mock
 * (CI/tests) is a one-file change. All HTTP providers accept an injectable
 * `fetchFn` so they can be unit-tested offline. The Mock provider needs no
 * network and no API key.
 */

import { estimateTokens, costUsd } from "./tokens.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteRequest {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface CompleteResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string;
  costUsd: number;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: CompleteRequest): Promise<CompleteResponse>;
}

/** Minimal fetch shape so providers can be tested without the network. */
export interface FetchLike {
  (url: string, init?: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }>;
}

function getFetch(injected?: FetchLike): FetchLike {
  return injected ?? (globalThis.fetch as unknown as FetchLike);
}

/** Turn (system?, messages) into an OpenAI/Ollama-style message list. */
function toRoleMessages(req: CompleteRequest, systemRole: "system" | "developer"): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  if (req.system) out.push({ role: systemRole, content: req.system });
  for (const m of req.messages) out.push({ role: m.role, content: m.content });
  return out;
}

/** Real Anthropic Messages API via fetch (no SDK dependency). */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly fetchFn?: FetchLike;

  constructor(apiKey: string, defaultModel = "claude-sonnet-4", fetchFn?: FetchLike) {
    if (!apiKey) throw new Error("AnthropicProvider requires an API key");
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.fetchFn = fetchFn;
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const model = req.model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.system) body.system = req.system;

    const res = await getFetch(this.fetchFn)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    return {
      text,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      model,
      stopReason: data.stop_reason,
      costUsd: costUsd(model, data.usage.input_tokens, data.usage.output_tokens),
    };
  }
}

export interface OpenAIOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

/** OpenAI Chat Completions (works with most OpenAI-compatible APIs via baseUrl). */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly fetchFn?: FetchLike;

  constructor(apiKey: string, defaultModel = "gpt-4o-mini", opts: OpenAIOptions = {}) {
    if (!apiKey) throw new Error("OpenAIProvider requires an API key");
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.fetchFn = opts.fetchFn;
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const model = req.model ?? this.defaultModel;
    const body = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      messages: toRoleMessages(req, "system"),
    };

    const res = await getFetch(this.fetchFn)(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI API ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string }; finish_reason: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(body.messages));
    const outputTokens = data.usage?.completion_tokens ?? estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens,
      model,
      stopReason: data.choices?.[0]?.finish_reason ?? "stop",
      costUsd: costUsd(model, inputTokens, outputTokens),
    };
  }
}

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  fetchFn?: FetchLike;
}

/** Local Ollama model (http://localhost:11434). Free — no API key. */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchFn?: FetchLike;

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
    this.defaultModel = opts.model ?? "llama3.1";
    this.fetchFn = opts.fetchFn;
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const model = req.model ?? this.defaultModel;
    const body = {
      model,
      stream: false,
      options: { temperature: req.temperature ?? 0.2, num_predict: req.maxTokens ?? 1024 },
      messages: toRoleMessages(req, "system"),
    };

    const res = await getFetch(this.fetchFn)(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama API ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      message?: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = data.message?.content ?? "";
    const inputTokens = data.prompt_eval_count ?? estimateTokens(JSON.stringify(body.messages));
    const outputTokens = data.eval_count ?? estimateTokens(text);

    return {
      text,
      inputTokens,
      outputTokens,
      model,
      stopReason: "stop",
      costUsd: 0, // local inference is free
    };
  }
}

export interface MockProviderOptions {
  /** Optional scripted responses, consumed in order; falls back to a default. */
  script?: string[];
  /** Simulated failure indices (0-based message turn) to exercise retries. */
  failOn?: number[];
}

/**
 * Deterministic, offline provider. Echoes a stable transformation of the input
 * and estimates tokens locally — enough to run the engine, evals, and learning
 * loop in tests without spending a cent.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  private cursor = 0;
  private readonly opts: MockProviderOptions;
  constructor(opts: MockProviderOptions = {}) {
    this.opts = opts;
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const turn = this.cursor++;
    if (this.opts.failOn?.includes(turn)) {
      throw new Error(`MockProvider: simulated failure on turn ${turn}`);
    }

    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";

    let text: string;
    if (this.opts.script && turn < this.opts.script.length) {
      text = this.opts.script[turn];
    } else {
      // Stable, content-derived output so graders can assert on it.
      text = this._derive(prompt);
    }

    const inputText = (req.system ?? "") + req.messages.map((m) => m.content).join("\n");
    const inputTokens = estimateTokens(inputText);
    const outputTokens = estimateTokens(text);
    return {
      text,
      inputTokens,
      outputTokens,
      model: req.model ?? "mock",
      stopReason: "end_turn",
      costUsd: costUsd("mock", inputTokens, outputTokens),
    };
  }

  private _derive(prompt: string): string {
    const lower = prompt.toLowerCase();
    // A few recognizable behaviors the eval graders key on.
    if (lower.includes("review") || lower.includes("bug")) {
      return "CRITICAL: mutable default argument detected. Fix: use None sentinel.";
    }
    if (lower.includes("summarize")) {
      return `Summary: ${prompt.slice(0, 80).trim()}...`;
    }
    if (lower.includes("add ")) {
      const nums = prompt.match(/-?\d+/g)?.map(Number) ?? [];
      return `Result: ${nums.reduce((a, b) => a + b, 0)}`;
    }
    return `OK: processed ${estimateTokens(prompt)} tokens of input.`;
  }
}

export type ProviderKind = "mock" | "anthropic" | "openai" | "ollama";

/**
 * Build a provider from a kind + env vars. `model` overrides the default model
 * where relevant. Throws a helpful message when a required key is missing.
 */
export function makeProvider(kind: string, model?: string): LLMProvider {
  switch (kind) {
    case "anthropic": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("provider 'anthropic' needs ANTHROPIC_API_KEY. Export it or use --provider mock|ollama.");
      return new AnthropicProvider(key, model ?? "claude-sonnet-4");
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("provider 'openai' needs OPENAI_API_KEY. Export it or use --provider mock|ollama.");
      return new OpenAIProvider(key, model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini", {
        baseUrl: process.env.OPENAI_BASE_URL,
      });
    }
    case "ollama": {
      const p = new OllamaProvider({
        baseUrl: process.env.OLLAMA_BASE_URL,
        model: model ?? process.env.OLLAMA_MODEL,
      });
      return p;
    }
    default:
      return new MockProvider();
  }
}

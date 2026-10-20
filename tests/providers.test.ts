import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider, OllamaProvider, AnthropicProvider, makeProvider } from "../src/core/llm.ts";
import type { FetchLike } from "../src/core/llm.ts";

function fakeFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
      text: async () => (typeof response === "string" ? response : JSON.stringify(response)),
    };
  };
  return { fn, calls };
}

test("OpenAIProvider parses choices + usage and sends an auth header", async () => {
  const { fn, calls } = fakeFetch({
    choices: [{ message: { content: "Hello from GPT" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  const p = new OpenAIProvider("sk-test", "gpt-4o-mini", { fetchFn: fn });
  const res = await p.complete({
    system: "Be brief.",
    messages: [{ role: "user", content: "hi" }],
  });

  assert.equal(res.text, "Hello from GPT");
  assert.equal(res.inputTokens, 10);
  assert.equal(res.outputTokens, 5);
  assert.ok(res.costUsd > 0);

  const call = calls[0];
  assert.ok(call.url.includes("/chat/completions"));
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer sk-test");
  const sent = JSON.parse(String(call.init?.body)) as { messages: Array<{ role: string }> };
  assert.equal(sent.messages[0].role, "system");
});

test("OpenAIProvider honors a custom baseUrl (OpenAI-compatible APIs)", async () => {
  const { fn, calls } = fakeFetch({
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  const p = new OpenAIProvider("k", "m", { baseUrl: "http://localhost:8080/v1/", fetchFn: fn });
  await p.complete({ messages: [{ role: "user", content: "x" }] });
  assert.equal(calls[0].url, "http://localhost:8080/v1/chat/completions");
});

test("OllamaProvider parses message + counts and is free", async () => {
  const { fn, calls } = fakeFetch({
    message: { content: "local answer" },
    prompt_eval_count: 12,
    eval_count: 7,
  });
  const p = new OllamaProvider({ model: "llama3.1", fetchFn: fn });
  const res = await p.complete({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.text, "local answer");
  assert.equal(res.inputTokens, 12);
  assert.equal(res.outputTokens, 7);
  assert.equal(res.costUsd, 0);
  assert.ok(calls[0].url.startsWith("http://localhost:11434/api/chat"));
});

test("HTTP providers throw on non-2xx responses", async () => {
  const { fn } = fakeFetch({ error: "bad key" }, 401);
  const p = new OpenAIProvider("bad", "gpt-4o-mini", { fetchFn: fn });
  await assert.rejects(() => p.complete({ messages: [{ role: "user", content: "x" }] }), /401/);

  const a = new AnthropicProvider("bad", "claude-sonnet-4", fn);
  await assert.rejects(() => a.complete({ messages: [{ role: "user", content: "x" }] }), /401/);
});

test("makeProvider falls back to mock and errors helpfully for missing keys", () => {
  assert.equal(makeProvider("mock").name, "mock");
  assert.equal(makeProvider("bogus").name, "mock");

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  assert.throws(() => makeProvider("anthropic"), /ANTHROPIC_API_KEY/);
  assert.throws(() => makeProvider("openai"), /OPENAI_API_KEY/);
  // ollama needs no key.
  assert.equal(makeProvider("ollama").name, "ollama");
});

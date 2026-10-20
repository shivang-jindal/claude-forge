import test from "node:test";
import assert from "node:assert/strict";
import { ContextManager } from "../src/core/context.ts";
import { MockProvider } from "../src/core/llm.ts";
import { estimateTokens, costUsd } from "../src/core/tokens.ts";

test("estimateTokens scales with text length and never returns 0 for input", () => {
  assert.equal(estimateTokens(""), 0);
  assert.ok(estimateTokens("hello world") >= 1);
  const long = "word ".repeat(500);
  assert.ok(estimateTokens(long) > estimateTokens("hi"));
});

test("costUsd uses the pricing table and is 0 for mock", () => {
  assert.equal(costUsd("mock", 1000, 1000), 0);
  const real = costUsd("claude-opus-4", 1_000_000, 1_000_000);
  assert.ok(real > 0);
});

test("ContextManager tracks usage and reports spend", async () => {
  const cm = new ContextManager({ maxTokens: 10_000, provider: new MockProvider() });
  const out = await cm.complete("summarize this document for me");
  assert.ok(out.length > 0);
  const u = cm.usage();
  assert.ok(u.inputTokens > 0);
  assert.ok(u.outputTokens > 0);
  assert.ok(cm.spendLine().includes("tokens"));
});

test("does not compact below the threshold", () => {
  const cm = new ContextManager({ maxTokens: 1000, compactionThreshold: 0.9 });
  cm.addMessage("user", "short message");
  assert.equal(cm.needsCompaction(), false);
  assert.equal(cm.maybeCompact("drop"), null);
});

test("maybeCompact triggers over the threshold and drop reduces tokens", async () => {
  const cm = new ContextManager({ maxTokens: 500, compactionThreshold: 0.5, keepRecent: 1 });
  for (let i = 0; i < 10; i++) cm.addMessage("user", `padding message number ${i} `.repeat(20));
  assert.equal(cm.needsCompaction(), true);
  const before = cm.tokenCount();
  const report = await cm.compact("drop");
  assert.ok(report);
  assert.ok(report!.tokensSaved > 0);
  assert.ok(cm.tokenCount() < before);
  assert.equal(cm.usage().compactions, 1);
});

test("keepRecent protects the newest messages during compaction", async () => {
  const cm = new ContextManager({ maxTokens: 400, compactionThreshold: 0.5, keepRecent: 2 });
  cm.addMessage("user", "old one " + "x".repeat(200));
  cm.addMessage("assistant", "old two " + "y".repeat(200));
  cm.addMessage("user", "recent user");
  cm.addMessage("assistant", "recent assistant");
  await cm.compact("drop");
  const msgs = cm.getMessages();
  const tail = msgs[msgs.length - 1];
  assert.equal(tail.content, "recent assistant");
});

test("summarize strategy folds older turns into one head message", async () => {
  const cm = new ContextManager({
    maxTokens: 400,
    compactionThreshold: 0.5,
    keepRecent: 1,
    provider: new MockProvider(),
  });
  for (let i = 0; i < 8; i++) cm.addMessage("user", `turn ${i} ` + "z".repeat(60));
  cm.addMessage("assistant", "the newest reply");
  const report = await cm.compact("summarize");
  assert.ok(report);
  const msgs = cm.getMessages();
  // One summary head + the kept recent message.
  assert.ok(msgs.length <= 3);
  assert.ok(msgs[0].content.includes("summary"));
});

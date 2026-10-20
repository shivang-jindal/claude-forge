/**
 * README examples, executed.
 *
 * Every code block in README.md that shows an API call is mirrored here so the
 * documentation cannot drift away from the code. If an example breaks, this
 * test breaks.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runEval, parseDataset } from "../src/eval/harness.ts";
import { MockProvider } from "../src/core/llm.ts";
import { fanOut } from "../src/orchestration/fanout.ts";
import { ContextManager } from "../src/core/context.ts";
import { Hooks } from "../src/core/hooks.ts";
import { runSaga } from "../src/orchestration/saga.ts";
import { TokenBucket, CircuitBreaker } from "../src/core/ratelimit.ts";
import { analyzeDag, toAscii, toMermaid } from "../src/orchestration/graph.ts";
import { PolicyEngine } from "../src/core/policy.ts";
import { MemoryStore } from "../src/core/memory.ts";
import { compare } from "../src/eval/compare.ts";
import { Engine } from "../src/core/engine.ts";

test("README: eval harness example produces the documented result shape", async () => {
  // README uses makeProvider("anthropic"); the mock stands in so the example
  // runs offline. The API and the returned shape are identical.
  const provider = new MockProvider();
  const dataset = parseDataset(JSON.stringify([{ id: "c1", input: "add 2 and 3", expected: "Result: 5" }]));

  const result = await runEval({
    dataset,
    run: async (input) => {
      const r = await provider.complete({ messages: [{ role: "user", content: input }] });
      return { text: r.text, costUsd: r.costUsd };
    },
    trials: 2,
    graders: ["contains"],
    mode: "continuous",
  });

  // README claims: → { passAt1, passAtK, costUsd, cases, regressions, clean }
  for (const key of ["passAt1", "passAtK", "costUsd", "cases", "regressions", "clean"]) {
    assert.ok(key in result, `README says the result has "${key}"`);
  }
  assert.equal(result.passAt1, 1);
  assert.equal(result.cases.length, 1);
});

test("README: fanOut example maps files through a worker", async () => {
  const files = ["a.ts", "b.ts", "c.ts"];
  const reviewFile = (f: string) => `reviewed:${f}`;
  const results = await fanOut(files, async (file) => reviewFile(file), { concurrency: 8 });
  assert.equal(results.length, 3);
  assert.equal(results[0]?.ok, true);
});

test("README: ContextManager example uses the real API", () => {
  const provider = new MockProvider();
  const ctx = new ContextManager({ maxTokens: 200_000, provider });
  ctx.addMessage("user", "x".repeat(1000));
  ctx.maybeCompact();
  // README claims: ctx.usage().costUsd and ctx.tokenCount()
  assert.equal(typeof ctx.usage().costUsd, "number");
  assert.equal(typeof ctx.tokenCount(), "number");
  assert.ok(ctx.tokenCount() > 0);
});

test("README: hooks example observes and vetoes", async () => {
  const hooks = new Hooks();
  hooks.on("step:start", "no-generated-files", (e) =>
    e.stepId === "codegen" ? { block: true, reason: "codegen is disabled" } : undefined,
  );
  hooks.on(["step:end"], "record-cost", (e) => ({ meta: { costUsd: e.data?.costUsd } }));

  const veto = await hooks.trigger({ phase: "step:start", stepId: "codegen" });
  assert.equal(veto.blocked, true);
  assert.equal(veto.reason, "codegen is disabled");

  const ok = await hooks.trigger({ phase: "step:start", stepId: "other" });
  assert.equal(ok.blocked, false);

  const meta = await hooks.trigger({ phase: "step:end", stepId: "s", data: { costUsd: 0.5 } });
  assert.equal(meta.event.meta?.costUsd, 0.5);
});

test("README: saga example compensates in reverse order", async () => {
  const done: string[] = [];
  const chargeCard = () => {};
  const refundCard = () => { done.push("refund"); };
  const provisionVM = () => {};
  const destroyVM = () => { done.push("destroy"); };
  const sendWelcome = () => { throw new Error("smtp down"); };

  const res = await runSaga([
    { id: "charge", run: chargeCard, compensate: refundCard },
    { id: "provision", run: provisionVM, compensate: destroyVM },
    { id: "email", run: sendWelcome },
  ]);
  assert.equal(res.status, "compensated");
  assert.deepEqual(done, ["destroy", "refund"]);
});

test("README: rate limiter and circuit breaker are constructible as documented", async () => {
  const limiter = new TokenBucket(60, 1);
  const breaker = new CircuitBreaker(5, 30_000);
  assert.equal(breaker.state, "closed");

  let calls = 0;
  const provider = {
    name: "counting",
    async complete() {
      calls += 1;
      return { text: "ok", inputTokens: 1, outputTokens: 1, model: "m", stopReason: "end_turn", costUsd: 0 };
    },
  };
  await new Engine({ provider, limiter, breaker }).run({
    name: "w",
    steps: [{ id: "s", prompt: "x" }],
  });
  assert.equal(calls, 1);
});

test("README: graph example output matches the documented text", () => {
  const wf = {
    name: "example-feature",
    steps: [
      { id: "plan" },
      { id: "implement", needs: ["plan"] },
      { id: "review", needs: ["implement"] },
    ],
  };
  const ascii = toAscii(wf);
  // README shows these exact lines.
  assert.match(ascii, /L0: plan/);
  assert.match(ascii, /L1: implement/);
  assert.match(ascii, /L2: review/);
  assert.match(ascii, /critical path: plan -> implement -> review/);
  assert.match(ascii, /max parallelism: 1/);
  assert.match(toMermaid(wf), /flowchart TD/);
  assert.equal(analyzeDag(wf).maxParallel, 1);
});

test("README: policy check verdicts are the documented ones", () => {
  const p = new PolicyEngine();
  assert.equal(p.evaluate({ command: "rm -rf /" }).allowed, false);              // DENIED
  assert.equal(p.evaluate({ command: "git push --force" }).needsApproval, true);  // NEEDS APPROVAL
  assert.equal(p.evaluate({ command: "npm test" }).allowed, true);                 // ALLOWED
});

test("README: memory add/list/search round-trip works", () => {
  const file = join(mkdtempSync(join(tmpdir(), "forge-readme-")), "memory.json");
  const store = new MemoryStore(file);
  store.add("preference", "Prefer strict TypeScript", ["typescript"]);
  assert.equal(store.all().length, 1);
  assert.equal(store.search("strict typescript").length, 1);
  assert.equal(new MemoryStore(file).all().length, 1); // persisted
});

test("README: compare returns the documented fields", async () => {
  const dataset = [{ id: "1", input: "add 2 and 3", expected: "Result: 5" }];
  const res = await compare({
    dataset,
    runA: () => "Result: 5",
    runB: () => "nope",
    bootstrap: 200,
  });
  for (const key of ["aPassAt1", "bPassAt1", "delta", "winner", "confidence", "significant", "ciLow", "ciHigh"]) {
    assert.ok(key in res, `README says compare returns "${key}"`);
  }
  assert.equal(res.winner, "a");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { passAtK, detectRegression, mean } from "../src/eval/metrics.ts";
import { resolveGrader } from "../src/eval/graders.ts";
import { runEval, parseDataset } from "../src/eval/harness.ts";
import { Store } from "../src/core/store.ts";

test("passAtK computes the unbiased estimator", () => {
  assert.equal(passAtK(0, 5, 1), 0);
  assert.equal(passAtK(5, 5, 1), 1);
  assert.equal(passAtK(3, 5, 5), 1); // n-c < k → guaranteed
  // correct=1, n=2, k=1 → 0.5
  assert.ok(Math.abs(passAtK(1, 2, 1) - 0.5) < 1e-9);
});

test("detectRegression flags drops beyond threshold", () => {
  assert.equal(detectRegression(0.9, undefined), null);
  const ok = detectRegression(0.9, 0.92, { threshold: 0.05 });
  assert.equal(ok!.regressed, false);
  const bad = detectRegression(0.7, 0.9, { threshold: 0.05 });
  assert.equal(bad!.regressed, true);
  assert.ok(bad!.delta < 0);
});

test("mean handles empty and normal arrays", () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
});

test("graders: exact, contains, contains-any, regex, llm-judge offline", async () => {
  const exact = resolveGrader("exact");
  assert.equal((await exact("hello", "hello")).passed, true);
  assert.equal((await exact("hello ", "hello")).passed, true); // trims
  assert.equal((await exact("hello", "world")).passed, false);

  const contains = resolveGrader("contains");
  assert.equal((await contains("the answer is 42", "42")).passed, true);

  const any = resolveGrader("contains-any");
  assert.equal((await any("foo", "bar||foo")).passed, true);
  assert.equal((await any("baz", "bar||foo")).passed, false);

  const re = resolveGrader("regex");
  assert.equal((await re("Error: ValueError", "Value\\s*Error")).passed, true);

  const judge = resolveGrader("llm-judge"); // no provider → offline heuristic
  const r = await judge("Python uses mutable default arguments bug here", "mutable default", {});
  assert.equal(typeof r.passed, "boolean");
  assert.ok(r.score >= 0 && r.score <= 1);
});

test("runEval grades a dataset and computes pass@1 and pass@k", async () => {
  const dataset = [
    { id: "a", input: "add 2 and 3", expected: "5" },
    { id: "b", input: "add 10 and 20", expected: "30" },
    { id: "c", input: "add 1 and 1", expected: "999" }, // always wrong
  ];
  const run = (input: string) => {
    const nums = (input.match(/\d+/g) ?? []).map(Number);
    return `Result: ${nums.reduce((a, b) => a + b, 0)}`;
  };
  const res = await runEval({
    dataset,
    run,
    trials: 3,
    graders: ["contains"],
    agent: "math",
    datasetName: "add",
  });
  assert.equal(res.cases.length, 3);
  // cases a,b always pass; c always fails → pass@1 = 2/3, pass@k = 2/3
  assert.ok(Math.abs(res.passAt1 - 2 / 3) < 1e-9);
  assert.equal(res.trials, 3);
});

test("runEval isolates runner errors and records a failing case", async () => {
  const res = await runEval({
    dataset: [{ id: "boom", input: "x", expected: "y" }],
    run: () => { throw new Error("runner exploded"); },
    trials: 2,
    graders: ["contains"],
  });
  assert.equal(res.cases[0].passAtK, 0);
  assert.ok(Math.abs(res.passAt1 - 0) < 1e-9);
});

test("runEval detects a regression against a stored baseline", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "forge-eval-store-")));
  // Seed a strong baseline.
  store.addEval({ id: "1", agent: "bot", dataset: "d", trials: 1, passAt1: 1.0, passAtK: 1, costUsd: 0, at: new Date().toISOString() });

  // Now a weaker run.
  const res = await runEval({
    dataset: [{ id: "a", input: "x", expected: "never" }],
    run: () => "wrong",
    trials: 2,
    graders: ["contains"],
    store,
    agent: "bot",
    datasetName: "d",
    regressionThreshold: 0.05,
  });
  assert.equal(res.clean, false);
  assert.equal(res.regressions.length, 1);
  assert.equal(res.regressions[0].metric, "pass@1");
  assert.ok(res.regressions[0].regressed);
});

test("parseDataset validates shape", () => {
  const good = parseDataset(JSON.stringify([{ id: "a", input: "i", expected: "e" }]));
  assert.equal(good.length, 1);
  assert.throws(() => parseDataset(JSON.stringify([{ nope: true }])));
  assert.throws(() => parseDataset('"not an array"'));
});

test("parseDataset tolerates a UTF-8 BOM (Windows tools write one)", () => {
  const withBom = "\uFEFF" + JSON.stringify([{ id: "a", input: "i", expected: "e" }]);
  const parsed = parseDataset(withBom);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "a");
});

test("graders: test-command runs a real command and passes via env var", async () => {
  // Uses FORGE_OUTPUT (set by the grader) — cross-platform, no fragile quoting.
  const cmd = `node -e "process.exit(process.env.FORGE_OUTPUT==='Result: 5'?0:1)"`;
  const g = resolveGrader({ type: "test-command", command: cmd });
  const pass = await g("Result: 5", "Result: 5", {});
  assert.equal(pass.passed, true);
  const fail = await g("wrong", "Result: 5", {});
  assert.equal(fail.passed, false);
  // Missing command → reported, not thrown.
  const noCmd = resolveGrader({ type: "test-command" });
  assert.equal((await noCmd("x", "y", {})).passed, false);
});

test("runEval aggregates runner-reported cost across trials", async () => {
  const res = await runEval({
    dataset: [{ id: "a", input: "x", expected: "y" }],
    run: () => ({ text: "y", costUsd: 0.01 }),
    trials: 3,
    graders: ["contains"],
  });
  assert.ok(Math.abs(res.costUsd - 0.03) < 1e-9);
});

test("runEval mode=checkpoint does not persist; continuous does", async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "forge-eval-mode-")));
  const ds = [{ id: "a", input: "x", expected: "y" }];
  const run = () => "y";
  await runEval({ dataset: ds, run, trials: 1, graders: ["contains"], store, agent: "bot", datasetName: "d", mode: "checkpoint" });
  assert.equal(store.listEvals().length, 0); // checkpoint: report only, no history
  await runEval({ dataset: ds, run, trials: 1, graders: ["contains"], store, agent: "bot", datasetName: "d", mode: "continuous" });
  assert.equal(store.listEvals().length, 1); // continuous: persisted for future baselines
});

import test from "node:test";
import assert from "node:assert/strict";
import { Engine, validateWorkflow, type WorkflowDef } from "../src/core/engine.ts";

test("validateWorkflow rejects cycles, duplicate ids, and unknown deps", () => {
  assert.throws(() =>
    validateWorkflow({ name: "cyc", steps: [
      { id: "a", needs: ["b"] },
      { id: "b", needs: ["a"] },
    ] }),
  );
  assert.throws(() =>
    validateWorkflow({ name: "dup", steps: [{ id: "a" }, { id: "a" }] }),
  );
  assert.throws(() =>
    validateWorkflow({ name: "ghost", steps: [{ id: "a", needs: ["nope"] }] }),
  );
});

test("runs a linear chain and propagates outputs forward", async () => {
  const wf: WorkflowDef = {
    name: "chain",
    steps: [
      { id: "one", run: () => "first" },
      { id: "two", needs: ["one"], run: (ctx) => `${ctx.outputs.one}-second` },
      { id: "three", needs: ["two"], run: (ctx) => `${ctx.outputs.two}-third` },
    ],
  };
  const engine = new Engine();
  const res = await engine.run(wf);
  assert.equal(res.status, "success");
  assert.equal(res.outputs.three, "first-second-third");
  // Order respects dependencies.
  const order = res.steps.map((s) => s.id);
  assert.ok(order.indexOf("one") < order.indexOf("two"));
  assert.ok(order.indexOf("two") < order.indexOf("three"));
});

test("runs independent steps in parallel, respecting the concurrency cap", async () => {
  let active = 0;
  let maxActive = 0;
  const makeStep = (id: string) => ({
    id,
    run: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      return id;
    },
  });
  const wf: WorkflowDef = {
    name: "parallel",
    concurrency: 3,
    steps: ["a", "b", "c", "d", "e"].map(makeStep),
  };
  const res = await new Engine().run(wf);
  assert.equal(res.status, "success");
  assert.equal(res.steps.filter((s) => s.status === "success").length, 5);
  assert.ok(maxActive > 1, "expected parallel execution");
  assert.ok(maxActive <= 3, `concurrency cap exceeded: ${maxActive}`);
});

test("retries a flaky step until it succeeds", async () => {
  let calls = 0;
  const res = await new Engine().run({
    name: "retry",
    steps: [
      {
        id: "flaky",
        retries: 3,
        run: () => {
          calls++;
          if (calls < 3) throw new Error(`fail ${calls}`);
          return "ok";
        },
      },
    ],
  });
  assert.equal(res.status, "success");
  assert.equal(calls, 3);
  assert.equal(res.steps[0].attempts, 3);
});

test("times out a step that exceeds its deadline", async () => {
  const res = await new Engine().run({
    name: "timeout",
    steps: [
      {
        id: "slow",
        timeoutMs: 40,
        run: () => new Promise((r) => setTimeout(() => r("late"), 200)),
      },
    ],
  });
  assert.equal(res.status, "failed");
  assert.equal(res.steps[0].status, "timeout");
});

test("skips a step when when() is false and cascades to dependents", async () => {
  const ran: string[] = [];
  const res = await new Engine().run({
    name: "conditional",
    inputs: { prod: false },
    steps: [
      { id: "seed", run: () => "s" },
      {
        id: "gated",
        needs: ["seed"],
        when: (ctx) => ctx.inputs.prod === true,
        run: () => { ran.push("gated"); return "g"; },
      },
      { id: "after", needs: ["gated"], run: () => { ran.push("after"); return "a"; } },
    ],
  });
  assert.equal(res.steps.find((s) => s.id === "gated")!.status, "skipped");
  assert.equal(res.steps.find((s) => s.id === "after")!.status, "skipped");
  assert.deepEqual(ran, []);
});

test("route() unblocks exactly one branch and skips the others", async () => {
  const res = await new Engine().run({
    name: "routing",
    steps: [
      { id: "decide", run: () => "branch-b" },
      { id: "branch-a", needs: ["decide"], run: () => "A" },
      { id: "branch-b", needs: ["decide"], run: () => "B" },
      { id: "join", needs: ["branch-b"], run: () => "joined" },
    ],
  });
  // decide.route is not defined on decide, so both branches run. Define routing:
  const routed = await new Engine().run({
    name: "routing2",
    steps: [
      { id: "decide", run: () => "b", route: (out) => `branch-${out}` },
      { id: "branch-a", needs: ["decide"], run: () => "A" },
      { id: "branch-b", needs: ["decide"], run: () => "B" },
    ],
  });
  assert.equal(routed.status, "success");
  assert.equal(routed.steps.find((s) => s.id === "branch-a")!.status, "skipped");
  assert.equal(routed.steps.find((s) => s.id === "branch-b")!.status, "success");
});

test("records a partial run when one branch fails and another succeeds", async () => {
  const res = await new Engine().run({
    name: "partial",
    steps: [
      { id: "ok", run: () => "good" },
      { id: "bad", run: () => { throw new Error("boom"); } },
    ],
  });
  assert.equal(res.status, "partial");
  assert.equal(res.steps.find((s) => s.id === "ok")!.status, "success");
  assert.equal(res.steps.find((s) => s.id === "bad")!.status, "failed");
});

test("engine injects the named agent's system prompt into the provider call", async () => {
  const captured: Array<string | undefined> = [];
  const provider = {
    name: "capture",
    async complete(req: { system?: string }) {
      captured.push(req.system);
      return { text: "ok", inputTokens: 1, outputTokens: 1, model: "m", stopReason: "end_turn", costUsd: 0 };
    },
  };
  const res = await new Engine({
    provider,
    agents: { reviewer: "You are a reviewer." },
  }).run({
    name: "agent-inject",
    steps: [
      { id: "with-agent", agent: "reviewer", prompt: "review this" },
      { id: "no-agent", prompt: "plain" },
    ],
  });
  assert.equal(res.status, "success");
  assert.deepEqual(captured, ["You are a reviewer.", undefined]);
});

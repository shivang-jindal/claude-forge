import test from "node:test";
import assert from "node:assert/strict";
import { fanOut, fanOutValues } from "../src/orchestration/fanout.ts";

test("fanOut respects the concurrency cap and preserves order", async () => {
  let active = 0;
  let maxActive = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const results = await fanOut(
    items,
    async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return n * 2;
    },
    { concurrency: 3 },
  );
  assert.equal(results.length, items.length);
  assert.deepEqual(results.map((r) => r.value), items.map((n) => n * 2));
  assert.ok(maxActive <= 3, `cap exceeded: ${maxActive}`);
  assert.ok(maxActive > 1, "expected parallelism");
});

test("fanOut isolates errors by default", async () => {
  const results = await fanOut(
    [1, 2, 3, 4],
    async (n) => {
      if (n % 2 === 0) throw new Error(`even ${n}`);
      return n;
    },
    { concurrency: 2 },
  );
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(results.filter((r) => !r.ok).length, 2);
  assert.ok(results.find((r) => r.item === 2)!.error!.includes("even 2"));
  // Order preserved even with failures interleaved.
  assert.deepEqual(results.map((r) => r.index), [0, 1, 2, 3]);
});

test("fanOut throws on error when isolateErrors is false", async () => {
  await assert.rejects(() =>
    fanOut(
      [1, 2],
      async (n) => {
        throw new Error(`fail ${n}`);
      },
      { concurrency: 1, isolateErrors: false },
    ),
  );
});

test("fanOutValues returns only successful values in order", async () => {
  const values = await fanOutValues(
    [1, 2, 3, 4, 5],
    async (n) => {
      if (n === 3) throw new Error("skip 3");
      return n * 10;
    },
    { concurrency: 2 },
  );
  assert.deepEqual(values, [10, 20, 40, 50]);
});

test("onProgress reports completion counts", async () => {
  const seen: number[] = [];
  await fanOut(
    [1, 2, 3],
    async (n) => n,
    { concurrency: 1, onProgress: (done) => seen.push(done) },
  );
  assert.deepEqual(seen, [1, 2, 3]);
});

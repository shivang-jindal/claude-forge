import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cascade } from "../src/orchestration/cascade.ts";
import { WorktreeManager } from "../src/orchestration/worktrees.ts";
import { MockProvider } from "../src/core/llm.ts";

test("cascade uses the cheap provider when its output is good", async () => {
  const res = await cascade(
    { messages: [{ role: "user", content: "add 2 and 3" }] },
    {
      cheap: new MockProvider(),
      strong: new MockProvider({ script: ["strong"] }),
      isGood: (text) => text.includes("Result:"),
    },
  );
  assert.equal(res.escalated, false);
  assert.equal(res.provider, "mock");
  assert.ok(res.text.includes("Result: 5"));
});

test("cascade escalates to the strong provider when the cheap one fails the check", async () => {
  const res = await cascade(
    { messages: [{ role: "user", content: "hard task" }] },
    {
      // Cheap provider produces output that never passes isGood.
      cheap: new MockProvider({ script: ["garbage"] }),
      strong: new MockProvider({ script: ["solid answer"] }),
      isGood: (text) => text.includes("solid"),
    },
  );
  assert.equal(res.escalated, true);
  assert.equal(res.provider, "mock");
  assert.equal(res.text, "solid answer");
  // Cost/token accounting includes both legs.
  assert.ok(res.inputTokens > 0);
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-wt-"));
  git(dir, "init");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "Test");
  execFileSync("node", ["-e", "require('fs').writeFileSync('a.txt','hi')"], { cwd: dir });
  git(dir, "add", ".");
  git(dir, "commit", "-m", "init");
  return dir;
}

test("WorktreeManager creates isolated worktrees and cleans them up", async () => {
  const repo = makeRepo();
  const manager = new WorktreeManager({ root: repo, baseDir: join(repo, ".wt") });
  const paths = await manager.create(2);
  assert.equal(paths.length, 2);
  // Each worktree is its own checkout with a distinct branch.
  const branches = paths.map((p) => git(p, "rev-parse", "--abbrev-ref", "HEAD"));
  assert.equal(new Set(branches).size, 2);

  await manager.cleanup(paths);
  const remaining = git(repo, "worktree", "list");
  // Only the primary repo worktree remains.
  assert.equal(remaining.split("\n").length, 1);
});

test("WorktreeManager.map runs a task in each worktree then cleans up", async () => {
  const repo = makeRepo();
  const manager = new WorktreeManager({ root: repo, baseDir: join(repo, ".wt2") });
  const results = await manager.map(2, async (path) => git(path, "rev-parse", "--abbrev-ref", "HEAD"));
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));
  const remaining = git(repo, "worktree", "list");
  assert.equal(remaining.split("\n").length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "../src/learning/extractor.ts";
import { LearningLoop } from "../src/learning/proposal.ts";
import { parseJsonl, signature } from "../src/learning/logformat.ts";
import { Store } from "../src/core/store.ts";

test("signature normalizes paths, urls, numbers, and time", () => {
  const a = signature("remove console.log in /home/user/app/src/index.ts at 12:30");
  const b = signature("remove console.log in /home/other/app/src/x.ts at 09:15");
  assert.equal(a, b);
});

test("extractor finds repeated user corrections", () => {
  const events = [
    { type: "message", role: "user", content: "remove the console.log statements" },
    { type: "message", role: "assistant", content: "done" },
    { type: "message", role: "user", content: "remove the console.log statements" },
  ];
  const candidates = extract(events, { minCount: 2 });
  const corr = candidates.find((c) => c.kind === "correction");
  assert.ok(corr);
  assert.ok(corr!.count >= 2);
  assert.ok(corr!.suggestedBody.includes("Rule"));
});

test("extractor detects self-corrections and repeated commands", () => {
  const events = [
    { type: "message", role: "assistant", content: "Actually, let me redo that function." },
    { type: "message", role: "assistant", content: "Actually, let me redo that function." },
    { type: "tool_use", tool: "bash", input: { command: "git status" } },
    { type: "tool_use", tool: "bash", input: { command: "git status" } },
    { type: "tool_use", tool: "bash", input: { command: "git status" } },
  ];
  const candidates = extract(events, { minCount: 2 });
  assert.ok(candidates.some((c) => c.kind === "self-correction"));
  const cmd = candidates.find((c) => c.kind === "repeated-command");
  assert.ok(cmd);
  assert.equal(cmd!.count, 3);
});

test("extractor detects lint fix-loops", () => {
  const events = [
    { type: "tool_use", tool: "ruff", input: { command: "ruff check ." } },
    { type: "tool_use", tool: "ruff", input: { command: "ruff check ." } },
  ];
  const candidates = extract(events, { minCount: 2 });
  assert.ok(candidates.some((c) => c.kind === "lint-loop"));
});

test("parseJsonl skips malformed lines", () => {
  const jsonl = [
    '{"type":"message","role":"user","content":"hello"}',
    "not json at all",
    '{"type":"tool_use","tool":"bash","input":{"command":"ls"}}',
  ].join("\n");
  const events = parseJsonl(jsonl);
  assert.equal(events.length, 2);
});

test("LearningLoop: ingest creates proposals; approve installs to disk; reject is remembered", () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "forge-loop-store-a-")));
  const loop = new LearningLoop(store);
  const events = [
    { type: "message", role: "user", content: "prefer immutability over mutation everywhere" },
    { type: "message", role: "user", content: "prefer immutability over mutation everywhere" },
  ];
  const candidates = extract(events, { minCount: 2 });
  assert.ok(candidates.length > 0);

  const first = loop.ingest(candidates);
  assert.ok(first.created.length > 0);
  const id = first.created[0].id;
  assert.equal(first.created[0].status, "proposed");

  // Re-ingest same pattern → dedupe (no new duplicate).
  const second = loop.ingest(candidates);
  assert.equal(second.created.length, 0);

  // Approve → installed + written to disk.
  const skillsDir = mkdtempSync(join(tmpdir(), "forge-skills-"));
  const installed = loop.approve(id, { skillsDir });
  assert.equal(installed.status, "installed");
  assert.ok(existsSync(join(skillsDir, installed.name, "SKILL.md")));
  const md = readFileSync(join(skillsDir, installed.name, "SKILL.md"), "utf8");
  assert.ok(md.includes(installed.name));

  // Installed skills are skipped on re-ingest.
  const third = loop.ingest(candidates);
  assert.ok(third.skipped.length > 0);
});

test("LearningLoop: rejected proposals are not re-proposed", () => {
  const store = new Store(mkdtempSync(join(tmpdir(), "forge-loop-store-b-")));
  const loop = new LearningLoop(store);
  const events = [
    { type: "message", role: "user", content: "always rename variables to tmp2 for temps" },
    { type: "message", role: "user", content: "always rename variables to tmp2 for temps" },
  ];
  const candidates = extract(events, { minCount: 2 });
  const { created } = loop.ingest(candidates);
  const id = created[0].id;
  loop.reject(id);
  const again = loop.ingest(candidates);
  assert.equal(again.created.length, 0);
  assert.ok(again.skipped.length > 0);
});

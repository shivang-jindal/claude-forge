import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, renderFrontmatter } from "../src/config/frontmatter.ts";
import { loadConfig, ConfigError } from "../src/config/loader.ts";
import { PluginRegistry } from "../src/config/registry.ts";

test("parseFrontmatter extracts scalars, lists, and body", () => {
  const md = `---
name: code-reviewer
description: Reviews code for quality
tools: Read, Grep, Glob
model: opus
depends_on: base-skill
---

# Body

Instructions here.
`;
  const { data, body } = parseFrontmatter(md);
  assert.equal(data.name, "code-reviewer");
  assert.equal(data.description, "Reviews code for quality");
  assert.deepEqual(data.tools, ["Read", "Grep", "Glob"]);
  assert.equal(data.model, "opus");
  assert.equal(data.depends_on, "base-skill"); // scalar (loader widens to array)
  assert.ok(body.startsWith("# Body"));
});

test("parseFrontmatter handles no frontmatter and quoted values", () => {
  const noFm = parseFrontmatter("# Just markdown");
  assert.deepEqual(noFm.data, {});
  assert.equal(noFm.body, "# Just markdown");

  const quoted = parseFrontmatter('---\ndescription: "Has, commas, inside"\n---\nbody');
  assert.equal(quoted.data.description, "Has, commas, inside");
});

test("renderFrontmatter round-trips", () => {
  const out = renderFrontmatter({ name: "x", description: "y", tools: ["a", "b"] });
  const parsed = parseFrontmatter(out + "\nbody");
  assert.equal(parsed.data.name, "x");
  assert.deepEqual(parsed.data.tools, ["a", "b"]);
});

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-cfg-"));
  mkdirSync(join(dir, "agents"), { recursive: true });
  mkdirSync(join(dir, "skills", "base-skill"), { recursive: true });
  mkdirSync(join(dir, "skills", "python-patterns"), { recursive: true });
  mkdirSync(join(dir, "commands"), { recursive: true });
  mkdirSync(join(dir, "rules"), { recursive: true });

  writeFileSync(
    join(dir, "agents", "reviewer.md"),
    "---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\nmodel: opus\ndepends_on: base-skill\n---\n\nReview body.",
  );
  writeFileSync(
    join(dir, "skills", "base-skill", "SKILL.md"),
    "---\nname: base-skill\ndescription: Base knowledge\n---\n\nBase body.",
  );
  writeFileSync(
    join(dir, "skills", "python-patterns", "SKILL.md"),
    "---\nname: python-patterns\ndescription: Python patterns\ndepends_on: base-skill\n---\n\nPython body.",
  );
  writeFileSync(join(dir, "commands", "review.md"), "---\ndescription: Run a review\n---\n\nDo review.");
  writeFileSync(join(dir, "rules", "security.md"), "---\ndescription: Security rules\n---\n\nNo secrets.");
  return dir;
}

test("loadConfig reads agents, skills, commands, rules", () => {
  const dir = makeFixture();
  const plugins = loadConfig(dir);
  const names = (k: string) => plugins.filter((p) => p.kind === k).map((p) => p.name).sort();
  assert.deepEqual(names("agent"), ["reviewer"]);
  assert.deepEqual(names("skill"), ["base-skill", "python-patterns"]);
  assert.deepEqual(names("command"), ["review"]);
  assert.deepEqual(names("rule"), ["security"]);

  const agent = plugins.find((p) => p.name === "reviewer")!;
  assert.deepEqual(agent.tools, ["Read", "Grep"]);
  assert.equal(agent.model, "opus");
});

test("loadConfig rejects an agent missing a description", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-bad-"));
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, "agents", "bad.md"), "---\nname: bad\n---\n\nbody");
  assert.throws(() => loadConfig(dir), ConfigError);
});

test("PluginRegistry resolves deps in dependency-first order and detects cycles", () => {
  const dir = makeFixture();
  const registry = new PluginRegistry(loadConfig(dir));
  const ordered = registry.activationOrder(["python-patterns"]);
  const order = ordered.map((p) => p.name);
  assert.ok(order.indexOf("base-skill") < order.indexOf("python-patterns"));

  // Cycle.
  const cyc = new PluginRegistry();
  cyc.add({ kind: "skill", name: "a", description: "", body: "", path: "", dependsOn: ["b"] });
  cyc.add({ kind: "skill", name: "b", description: "", body: "", path: "", dependsOn: ["a"] });
  assert.throws(() => cyc.activationOrder(["a"]), /cycle/i);

  // Missing dep.
  assert.throws(() => registry.activationOrder(["ghost-skill"]), /Unknown plugin/);
});

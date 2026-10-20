/**
 * Config loader — turns the markdown config library into typed plugins.
 *
 * Reads configs/{agents,skills,commands,rules}, parses frontmatter, and
 * validates the fields each kind requires. These are the same artifacts static
 * toolkits ship — but here they become first-class inputs to the engine.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";

export type PluginKind = "agent" | "skill" | "command" | "rule";

export interface Plugin {
  kind: PluginKind;
  name: string;
  description: string;
  /** Raw markdown body (instructions / workflow / command definition). */
  body: string;
  /** Source file path. */
  path: string;
  /** Agent-only: allowed tools. */
  tools?: string[];
  /** Agent-only: suggested model. */
  model?: string;
  /** Optional dependencies on other plugin names. */
  dependsOn?: string[];
}

export class ConfigError extends Error {}

function readKind(configDir: string, kind: PluginKind): string {
  return join(configDir, kind === "skill" ? "skills" : `${kind}s`);
}

/** Load every plugin under a config directory. */
export function loadConfig(configDir: string): Plugin[] {
  const plugins: Plugin[] = [];
  plugins.push(...loadAgents(configDir));
  plugins.push(...loadSkills(configDir));
  plugins.push(...loadCommands(configDir));
  plugins.push(...loadRules(configDir));
  return plugins;
}

export function loadAgents(configDir: string): Plugin[] {
  const dir = readKind(configDir, "agent");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(dir, f);
      const { data, body } = parseFrontmatter(readFileSync(path, "utf8"));
      const name = str(data.name) ?? f.replace(/\.md$/, "");
      const description = str(data.description);
      if (!description) throw new ConfigError(`${path}: agent missing "description" frontmatter`);
      return {
        kind: "agent" as const,
        name,
        description,
        body,
        path,
        tools: arr(data.tools),
        model: str(data.model),
        dependsOn: arr(data.depends_on ?? data.dependsOn),
      };
    });
}

export function loadSkills(configDir: string): Plugin[] {
  const dir = readKind(configDir, "skill");
  if (!existsSync(dir)) return [];
  const out: Plugin[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    const skillFile = join(entryPath, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const { data, body } = parseFrontmatter(readFileSync(skillFile, "utf8"));
    const name = str(data.name) ?? entry;
    const description = str(data.description);
    if (!description) throw new ConfigError(`${skillFile}: skill missing "description"`);
    out.push({
      kind: "skill",
      name,
      description,
      body,
      path: skillFile,
      dependsOn: arr(data.depends_on ?? data.dependsOn),
    });
  }
  return out;
}

export function loadCommands(configDir: string): Plugin[] {
  const dir = readKind(configDir, "command");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(dir, f);
      const { data, body } = parseFrontmatter(readFileSync(path, "utf8"));
      const name = str(data.name) ?? f.replace(/\.md$/, "");
      const description = str(data.description) ?? "";
      return { kind: "command" as const, name, description, body, path, dependsOn: arr(data.depends_on ?? data.dependsOn) };
    });
}

export function loadRules(configDir: string): Plugin[] {
  const dir = readKind(configDir, "rule");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(dir, f);
      const { data, body } = parseFrontmatter(readFileSync(path, "utf8"));
      const name = str(data.name) ?? f.replace(/\.md$/, "");
      const description = str(data.description) ?? "";
      return { kind: "rule" as const, name, description, body, path };
    });
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function arr(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return undefined;
}

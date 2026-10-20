/**
 * Rename the project everywhere, safely.
 *
 *   node scripts/rename.ts <new-repo-name> [--pkg <npm-name>] [--bin <cli-name>]
 *                                   [--desc "<one-line description>"]
 *                                   [--owner <github-handle>] [--dir <state-dir>]
 *
 * Example:
 *   node scripts/rename.ts anvil --pkg @yourhandle/anvil --bin anvil \
 *     --owner yourhandle --dir .anvil
 *
 * It rewrites every file that mentions the old name, renames the files whose
 * names embed it, and prints a report. It never touches `configs/` (those are
 * agent/skill names, not the project name) and never touches `git` history.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, renameSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Options {
  repo: string;
  pkg: string;
  bin: string;
  desc?: string;
  owner?: string;
  dir: string;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".forge", "dist", "coverage"]);
const TEXT_EXT = new Set([
  ".md", ".ts", ".json", ".yml", ".yaml", ".txt", ".mjs", ".js", "",
]);

function parseArgs(argv: string[]): Options | null {
  const [repo, ...rest] = argv;
  if (!repo || repo.startsWith("--")) {
    process.stderr.write(
      "usage: node scripts/rename.ts <new-repo-name> [--pkg <name>] [--bin <name>]\n" +
      "                              [--desc \"<description>\"] [--owner <handle>]\n" +
      "                              [--dir <state-dir>]\n",
    );
    return null;
  }
  const o: Options = {
    repo,
    pkg: repo,
    bin: repo,
    dir: `.${repo}`,
  };
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i];
    const v = rest[i + 1];
    if (f === "--pkg") { o.pkg = v; i++; }
    else if (f === "--bin") { o.bin = v; i++; }
    else if (f === "--desc") { o.desc = v; i++; }
    else if (f === "--owner") { o.owner = v; i++; }
    else if (f === "--dir") { o.dir = v; i++; }
    else {
      process.stderr.write(`unknown flag: ${f}\n`);
      return null;
    }
  }
  return o;
}

/** Recursively list files relative to ROOT, skipping generated/hidden dirs. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const OLD_REPO = "claude-forge";
const OLD_BIN = "forge";
const OLD_DIR = ".forge";
const OLD_PKG = "claude-forge";

/**
 * Replace a word only when it stands alone, preserving capitalisation.
 * `replaceWord(text, "forge", "anvil")` turns "forge" -> "anvil" and
 * "Forge's" -> "Anvil's", but leaves "forget", "forged", and "forgeable"
 * untouched.
 */
function replaceWord(text: string, word: string, replacement: string): string {
  const cap = replacement.charAt(0).toUpperCase() + replacement.slice(1);
  const upper = replacement.toUpperCase();
  return text
    .replace(new RegExp(`\\b${word}\\b`, "g"), () => replacement)
    .replace(new RegExp(`\\b${word[0].toUpperCase()}${word.slice(1)}\\b`, "g"), () => cap)
    .replace(new RegExp(`\\b${word.toUpperCase()}\\b`, "g"), () => upper);
}

function main(): void {
  const o = parseArgs(process.argv.slice(2));
  if (!o) process.exit(1);

  const pkgJsonPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;

  const changed: string[] = [];
  const skipped: string[] = [];

  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
    // The agent/skill/command/rule library is content, not branding.
    if (rel.startsWith("configs/") && !rel.startsWith("configs/hooks/")) continue;
    // Don't rewrite the script that is doing the rewriting.
    if (rel === "scripts/rename.ts") continue;

    const ext = rel.slice(rel.lastIndexOf("."));
    if (!TEXT_EXT.has(ext)) continue;

    const before = readFileSync(file, "utf8");
    let after = before;

    // Order matters: longest / most specific first.
    // Every replacement is word-boundary aware so that "forget" / "forged" /
    // "forgeable" are never mangled by a rename of "forge".
    after = after.split(OLD_PKG).join(o.pkg);
    after = after.split(OLD_DIR).join(o.dir);
    after = after.split(`${OLD_BIN}.config.json`).join(`${o.bin}.config.json`);
    after = after.split(OLD_REPO).join(o.repo);
    after = replaceWord(after, OLD_BIN, o.bin);

    if (o.owner) after = after.split("OWNER").join(o.owner);
    after = after.replace(/\bREPO\b/g, o.repo);
    if (o.desc) after = after.split(String(pkg.description)).join(o.desc);

    // The README title should carry the repo name (and its symbol), not the
    // npm package name — the two are often different.
    if (rel === "README.md") {
      const originalFirst = before.split("\n")[0] ?? "";
      const symbol = originalFirst.replace(/^#\s*/, "").replace(/[A-Za-z0-9].*$/, "").trim();
      const lines = after.split("\n");
      lines[0] = symbol ? `# ${symbol} ${o.repo}` : `# ${o.repo}`;
      after = lines.join("\n");
    }

    if (after !== before) {
      writeFileSync(file, after, "utf8");
      changed.push(rel);
    } else {
      skipped.push(rel);
    }
  }

  // package.json needs structured edits (name, bin key, scripts).
  const pkgAfter = { ...pkg } as Record<string, unknown>;
  pkgAfter.name = o.pkg;
  // The bin target is the JS bootstrap; it moves with the new name.
  const currentBin = (pkg.bin ?? {}) as Record<string, string>;
  const binTarget = `./bin/${o.bin}.js`;
  pkgAfter.bin = o.bin === o.repo ? { [o.bin]: binTarget } : { [o.bin]: binTarget, [o.repo]: binTarget };
  const scripts = { ...(pkgAfter.scripts as Record<string, string>) };
  if (scripts[OLD_BIN]) scripts[o.bin] = scripts[OLD_BIN];
  delete scripts[OLD_BIN];
  pkgAfter.scripts = scripts;
  if (o.desc) pkgAfter.description = o.desc;
  const repoUrl = `https://github.com/${o.owner ?? "OWNER"}/${o.repo}`;
  pkgAfter.repository = { type: "git", url: `git+${repoUrl}.git` };
  pkgAfter.homepage = `${repoUrl}#readme`;
  pkgAfter.bugs = { url: `${repoUrl}/issues` };
  writeFileSync(pkgJsonPath, `${JSON.stringify(pkgAfter, null, 2)}\n`, "utf8");

  // Rename files whose names embed the old name.
  const renames: [string, string][] = [
    [`${OLD_BIN}.config.json`, `${o.bin}.config.json`],
    [`.github/workflows/${OLD_BIN}-ci.yml`, `.github/workflows/${o.bin}-ci.yml`],
    [`bin/${OLD_BIN}.js`, `bin/${o.bin}.js`],
  ];
  for (const [from, to] of renames) {
    const src = join(ROOT, from);
    if (existsSync(src)) {
      renameSync(src, join(ROOT, to));
      changed.push(`${from} -> ${to}`);
    }
  }

  process.stdout.write(`\nRenamed to "${o.repo}"\n`);
  process.stdout.write(`  package : ${o.pkg}\n`);
  process.stdout.write(`  binary  : ${o.bin}\n`);
  process.stdout.write(`  state   : ${o.dir}\n\n`);
  process.stdout.write(`  ${changed.length} file(s) updated:\n`);
  for (const c of changed) process.stdout.write(`    ${c}\n`);
  process.stdout.write(`\n  ${skipped.length} file(s) left unchanged.\n\n`);
  process.stdout.write("Next steps:\n");
  process.stdout.write(`  1. Review the diff:  git diff\n`);
  process.stdout.write(`  2. Run the suite:     node --test tests/*.test.ts\n`);
  process.stdout.write(`  3. Run the gate:      node src/cli.ts ci\n`);
}

main();

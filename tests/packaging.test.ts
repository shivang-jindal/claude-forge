/**
 * Packaging tests.
 *
 * The npm package cannot simply point its `bin` at `src/cli.ts`: Node refuses
 * to strip TypeScript types from files under `node_modules`
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). The package ships a loader
 * bootstrap instead. These tests make sure that arrangement keeps working —
 * a broken published package is a silent disaster until someone installs it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "node:module";

/** register() needs a file:// URL, not a bare Windows path. */
function loaderUrl(): string {
  return pathToFileURL(packagePaths().loader).href;
}

/** Derive the bootstrap + loader paths from package.json so a rename cannot
 *  silently break these tests. */
function packagePaths(): { bin: string; loader: string } {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    bin: Record<string, string>;
  };
  const bin = resolve(Object.values(pkg.bin)[0]);
  return { bin, loader: join(dirname(bin), "loader.js") };
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("packaging: the npm bootstrap and loader exist and are valid JS", () => {
  const { bin, loader } = packagePaths();
  assert.ok(existsSync(bin), `${bin} must exist — it is the published entry point`);
  assert.ok(existsSync(loader), `${loader} must exist — it strips types inside node_modules`);

  // The bootstrap must be plain JavaScript: it is executed by Node before any
  // type stripping can happen, so it must not itself contain TypeScript.
  const binSrc = readFileSync(bin, "utf8");
  const loaderSrc = readFileSync(loader, "utf8");
  for (const [name, src] of [[bin, binSrc], [loader, loaderSrc]] as const) {
    assert.ok(!/^\s*import\s+type\s/m.test(src), `${name} must not use TypeScript-only syntax`);
    assert.ok(!/:\s*string\b/.test(src), `${name} must be plain JavaScript`);
  }
  assert.match(binSrc, /register\(/);
  assert.match(loaderSrc, /stripTypeScriptTypes/);
});

test("packaging: package.json ships what the CLI needs at runtime", () => {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    name: string;
    bin: Record<string, string>;
    files: string[];
    dependencies: Record<string, unknown>;
    engines: { node: string };
    scripts: Record<string, string>;
  };

  // The bin must be the JS bootstrap, not the .ts file (Node blocks that).
  for (const [cmd, target] of Object.entries(pkg.bin)) {
    assert.ok(target.endsWith(".js"), `bin "${cmd}" must point at a .js entry point, got ${target}`);
    assert.ok(existsSync(resolve(target)), `bin "${cmd}" points at a missing file: ${target}`);
  }

  // The bundled config library must ship: `forge init` copies it from the
  // package root, and `forge run` loads agents from it.
  assert.ok(pkg.files.includes("configs/"), "configs/ must be published");
  assert.ok(pkg.files.includes("src/"), "src/ must be published");
  assert.ok(pkg.files.includes("bin/"), "bin/ must be published");
  assert.ok(!pkg.files.includes("tests/"), "tests/ should not be published");

  assert.deepEqual(pkg.dependencies, {}, "the package must stay dependency-free");
  assert.match(pkg.engines.node, /24/, "the published package needs Node 24+ for type stripping");
  assert.ok(pkg.scripts.prepublishOnly, "prepublishOnly must run the test gate before publishing");
});

test("packaging: every source module loads through the npm loader", async () => {
  // This is the check that would have caught a type-only import written as a
  // value import: the strip step cannot tell them apart, so the published
  // package would fail to load at runtime.
  register(loaderUrl(), import.meta.url);

  const files = sourceFiles(resolve("src"));
  assert.ok(files.length > 20, "expected the full source tree");

  for (const f of files) {
    if (f.endsWith(join("src", "cli.ts"))) continue; // executed separately below
    await import(pathToFileURL(f).href);
  }
});

test("packaging: the CLI entry point loads and its imports resolve", async () => {
  register(loaderUrl(), import.meta.url);

  // Importing cli.ts runs main(); point it at --help and swallow the output
  // so the test log stays clean.
  const originalArgv = process.argv;
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.argv = [originalArgv[0] ?? "node", "cli.ts", "--help"];
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    await import(pathToFileURL(resolve("src/cli.ts")).href);
  } finally {
    process.stdout.write = originalWrite;
    process.argv = originalArgv;
  }
});

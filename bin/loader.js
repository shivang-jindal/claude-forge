/**
 * ESM loader hook that lets Node run TypeScript source from inside
 * `node_modules`.
 *
 * Node's built-in type stripping deliberately skips `node_modules`, so the
 * published package registers this hook to strip types itself. Only `.ts`
 * files are touched; everything else falls through to the default loader.
 *
 * The source must use **erasable syntax only** (no enums, no namespaces, no
 * constructor parameter properties) and must import types with `import type`,
 * because the strip step cannot tell a type-only import from a value import.
 * Both rules are enforced by the project's tsconfig and its test suite.
 */

import { stripTypeScriptTypes } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// This hook runs in its own worker thread, with its own `process`, so the
// experimental warning has to be filtered here as well as in bin/forge.js.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
  const name = typeof rest[1] === "string" ? rest[1] : rest[1]?.name;
  const text = typeof warning === "string" ? warning : String(warning?.message ?? warning);
  if (type === "ExperimentalWarning" || name === "ExperimentalWarning") {
    if (text.includes("stripTypeScriptTypes")) return;
  }
  return emitWarning(warning, ...rest);
};

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return {
      format: "module",
      source: stripTypeScriptTypes(source, { mode: "strip" }),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}

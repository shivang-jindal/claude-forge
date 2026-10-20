#!/usr/bin/env node
/**
 * Published-package entry point.
 *
 * Node refuses to strip TypeScript types from files under `node_modules`
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so the npm package cannot
 * simply point its bin at `src/cli.ts`. Rather than add a build step and a
 * second copy of the source, we ship the TypeScript as-is and register a
 * loader hook that strips the types on the fly.
 *
 * The result: the published package runs the exact same source you read in
 * the repository, with no build step, no compiler, and no dependencies.
 */

import { register } from "node:module";

// `stripTypeScriptTypes` is flagged experimental and prints a warning. It is
// stable in practice for erasable syntax, and the warning would pollute the
// CLI's output, so it is filtered out here.
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

register("./loader.js", import.meta.url);

// Run the real CLI.
await import("../src/cli.ts");

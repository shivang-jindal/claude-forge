#!/usr/bin/env node
/**
 * Publish helper.
 *
 * npm requires a one-time password (TOTP) for direct publishes, and a token
 * with "bypass 2FA" for CI. This script keeps the token out of your shell
 * history and handles the retry loop, because TOTP codes rotate every 30
 * seconds and a slow typist will occasionally land on an expired one.
 *
 *   node scripts/publish.mjs           # prompts for a code, retries if it expires
 *   node scripts/publish.mjs 123456    # one-shot with a code you already have
 *
 * After the first publish, enable "Trusted Publishing" on npmjs.com and let
 * the GitHub release workflow take over — then no token is needed at all.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ATTEMPTS = 5;

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((res) => rl.question(question, res));
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function publish(otp) {
  const res = spawnSync(
    npmCommand(),
    ["publish", "--access", "public", `--otp=${otp}`, "--ignore-scripts"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: process.platform === "win32" },
  );
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  return { code: res.status ?? 1, out };
}

console.log(`\nPublishing ${pkg.name}@${pkg.version}`);

// IMPORTANT: run the quality gate BEFORE asking for the one-time password.
// TOTP codes expire after ~30 seconds, and `npm publish` would otherwise run
// the (slow) prepublishOnly gate first and eat the code's lifetime.
console.log("\n  Running the quality gate (tests + eval gate)...");
const gate = spawnSync(process.execPath, [resolve(ROOT, "src", "cli.ts"), "ci"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (gate.status !== 0) {
  console.error("\n  The quality gate failed — nothing was published.\n");
  rl.close();
  process.exit(1);
}
console.log("\n  Gate passed.");

console.log("Open your npm authenticator app and read the 6-digit code.\n");

let otp = process.argv[2];

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  if (otp === undefined) {
    const answer = (await ask("  npm one-time password: ")).trim();
    if (!answer) {
      console.error("\n  No code entered — nothing was published.\n");
      rl.close();
      process.exit(1);
    }
    otp = answer;
  }

  if (!/^\d{6}$/.test(otp)) {
    console.log("  That is not a 6-digit code.");
    otp = undefined;
    continue;
  }

  console.log(`\n  Publishing (attempt ${attempt}/${MAX_ATTEMPTS})...`);
  // --ignore-scripts: the gate already ran above; re-running it here would
  // delay the upload past the code's expiry.
  const { code, out } = publish(otp);

  if (code === 0) {
    const tarball = out.match(/filename:\s*(\S+)/)?.[1] ?? "";
    console.log(`\n  Published ${pkg.name}@${pkg.version}${tarball ? ` (${tarball})` : ""}`);
    console.log(`  https://www.npmjs.com/package/${pkg.name}\n`);
    rl.close();
    process.exit(0);
  }

  if (/EOTP|one-time password|expired/i.test(out)) {
    console.log("  That code was rejected or expired — read the current code and try again.");
    otp = undefined;
    continue;
  }

  // Any other error is a real problem — print it and stop.
  console.error("\n  Publish failed:\n");
  console.error(out.split("\n").filter((l) => l.trim()).slice(-25).join("\n"));
  rl.close();
  process.exit(code);
}

console.error("\n  Gave up after too many attempts.\n");
rl.close();
process.exit(1);

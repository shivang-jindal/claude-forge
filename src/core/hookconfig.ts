/**
 * Config-driven hooks.
 *
 * A hook config is a JSON file in `configs/hooks/*.json`:
 *
 * ```json
 * {
 *   "name": "no-secrets",
 *   "phases": ["step:end"],
 *   "command": "node -e \"if(/PRIVATE KEY/.test(process.env.FORGE_DATA_OUTPUT||''))process.exit(1)\"",
 *   "blockOnFail": true
 * }
 * ```
 *
 * The command runs with `FORGE_PHASE`, `FORGE_RUN_ID`, `FORGE_STEP_ID`,
 * `FORGE_TOOL`, `FORGE_DATA` (JSON) and `FORGE_DATA_OUTPUT` in the
 * environment. Exit code 0 = allow; non-zero blocks the step (when
 * `blockOnFail` is true).
 *
 * Note on quoting: read values from the environment rather than interpolating
 * them into the command — Windows paths and quotes do not survive shell
 * escaping reliably, but environment variables always do.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HookPhase, Hooks, HookEvent } from "./hooks.ts";

const execAsync = promisify(exec);

export interface HookConfig {
  name: string;
  phases: HookPhase[];
  /** Shell command. Exit 0 = allow, non-zero = block (see blockOnFail). */
  command: string;
  priority?: number;
  /** Block the step when the command exits non-zero. Default: true. */
  blockOnFail?: boolean;
  timeoutMs?: number;
}

const VALID_PHASES: HookPhase[] = [
  "run:start", "run:end",
  "step:start", "step:end", "step:retry", "step:skip",
  "tool:pre", "tool:post",
  "compact", "budget:exceeded",
  "eval:start", "eval:end",
  "learn:proposed", "skill:approved",
];

/** Load `*.json` hook configs from a directory. Bad files are skipped, not fatal. */
export function loadHookConfigs(dir: string): HookConfig[] {
  if (!existsSync(dir)) return [];
  const out: HookConfig[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf8").replace(/^\uFEFF/, "")) as HookConfig;
      if (!raw || typeof raw.name !== "string" || typeof raw.command !== "string") continue;
      const phases = (Array.isArray(raw.phases) ? raw.phases : []).filter(
        (p): p is HookPhase => VALID_PHASES.includes(p as HookPhase),
      );
      if (!phases.length) continue;
      out.push({
        name: raw.name,
        phases,
        command: raw.command,
        priority: raw.priority ?? 0,
        blockOnFail: raw.blockOnFail ?? true,
        timeoutMs: raw.timeoutMs ?? 30_000,
      });
    } catch {
      /* skip malformed hook files */
    }
  }
  return out;
}

/** Register loaded hook configs onto a Hooks registry. */
export function registerHookConfigs(hooks: Hooks, configs: HookConfig[]): void {
  for (const cfg of configs) {
    hooks.on(
      cfg.phases,
      cfg.name,
      async (event: HookEvent) => {
        const data = event.data ?? {};
        const env: Record<string, string> = {
          ...(process.env as Record<string, string>),
          FORGE_PHASE: event.phase,
          FORGE_RUN_ID: event.runId ?? "",
          FORGE_STEP_ID: event.stepId ?? "",
          FORGE_TOOL: event.tool ?? "",
          FORGE_DATA: JSON.stringify(data),
        };
        if (typeof data.output === "string") env.FORGE_DATA_OUTPUT = data.output;
        try {
          const res = await execAsync(cfg.command, { timeout: cfg.timeoutMs ?? 30_000, env });
          // Surface the hook's own output — a hook that runs silently is a
          // hook nobody can debug.
          if (res.stdout) process.stdout.write(res.stdout);
          if (res.stderr) process.stderr.write(res.stderr);
          return undefined;
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          if (e.stdout) process.stdout.write(e.stdout);
          if (e.stderr) process.stderr.write(e.stderr);
          const detail = (e.stderr || e.message || "hook command failed").slice(0, 200);
          if (cfg.blockOnFail) {
            return { block: true, reason: `hook '${cfg.name}' failed: ${detail}` };
          }
          return { meta: { hookFailure: cfg.name, detail } };
        }
      },
      cfg.priority ?? 0,
    );
  }
}

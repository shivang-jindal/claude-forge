/**
 * Pluggable graders.
 *
 * A grader scores one trial's output against the expected answer. Build-in
 * graders cover exact/contains/regex, running a real test command, and an
 * LLM-as-judge. Pass your own function for anything else.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { LLMProvider } from "../core/llm.ts";

const execAsync = promisify(exec);

export interface GradeResult {
  passed: boolean;
  /** 0–1 quality score. Defaults to 1/0 for pass/fail graders. */
  score: number;
  reason?: string;
}

export type Grader = (
  output: string,
  expected: string,
  ctx?: GraderContext,
) => GradeResult | Promise<GradeResult>;

export interface GraderContext {
  id?: string;
  provider?: LLMProvider;
  /** Extra options forwarded from the grader config. */
  opts?: Record<string, unknown>;
}

export type GraderSpec = string | ({ type: string } & Record<string, unknown>);

function specType(spec: GraderSpec): string {
  return typeof spec === "string" ? spec : spec.type;
}
function specOpts(spec: GraderSpec): Record<string, unknown> {
  return typeof spec === "string" ? {} : spec;
}

export const graders: Record<string, Grader> = {
  exact: (output, expected) => {
    const o = output.trim();
    const e = expected.trim();
    return { passed: o === e, score: o === e ? 1 : 0, reason: o === e ? undefined : "not exactly equal" };
  },

  contains: (output, expected) => {
    const passed = output.includes(expected);
    return { passed, score: passed ? 1 : 0, reason: passed ? undefined : `output does not contain "${expected}"` };
  },

  "contains-any": (output, expected) => {
    const alts = expected.split("||").map((s) => s.trim()).filter(Boolean);
    const passed = alts.some((a) => output.includes(a));
    return { passed, score: passed ? 1 : 0, reason: passed ? undefined : `output contains none of ${alts.join(", ")}` };
  },

  regex: (output, expected) => {
    let passed = false;
    try {
      passed = new RegExp(expected, "i").test(output);
    } catch {
      passed = false;
    }
    return { passed, score: passed ? 1 : 0, reason: passed ? undefined : `no regex match for /${expected}/` };
  },

  /** Runs a shell command; exit code 0 = pass. Output/expected are passed as
   *  FORGE_OUTPUT / FORGE_EXPECTED env vars (cross-platform safe), and the
   *  {{output}} / {{expected}} placeholders are substituted with
   *  platform-correct quoting. */
  "test-command": async (output, expected, ctx) => {
    const opts = ctx?.opts ?? {};
    const command = String(opts.command ?? "");
    if (!command) return { passed: false, score: 0, reason: "test-command grader needs a `command`" };
    const rendered = command
      .replaceAll("{{output}}", shellQuote(output))
      .replaceAll("{{expected}}", shellQuote(expected));
    try {
      await execAsync(rendered, {
        cwd: opts.cwd ? String(opts.cwd) : process.cwd(),
        timeout: 30_000,
        env: { ...process.env, FORGE_OUTPUT: output, FORGE_EXPECTED: expected },
      });
      return { passed: true, score: 1 };
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return { passed: false, score: 0, reason: (e.stderr || e.message || "command failed").slice(0, 300) };
    }
  },

  /** LLM-as-judge against a rubric. Deterministic fallback when no provider. */
  "llm-judge": async (output, expected, ctx) => {
    const rubric = String(ctx?.opts?.rubric ?? "The output correctly and completely answers the expected result.");
    const provider = ctx?.provider;
    if (!provider) {
      // Deterministic offline judge: substring overlap heuristic.
      const o = output.toLowerCase();
      const e = expected.toLowerCase();
      const tokens = e.split(/\s+/).filter((t) => t.length > 3);
      const hits = tokens.filter((t) => o.includes(t)).length;
      const score = tokens.length ? hits / tokens.length : o.includes(e) ? 1 : 0;
      return { passed: score >= 0.5, score, reason: `offline judge overlap=${score.toFixed(2)}` };
    }
    const prompt =
      `Rubric: ${rubric}\n\nExpected: ${expected}\n\nOutput:\n${output}\n\n` +
      `Reply with JSON: {"passed":boolean,"score":number,"reason":"..."}`;
    const res = await provider.complete({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 200,
      temperature: 0,
    });
    const parsed = safeParseJson(res.text);
    if (parsed && typeof parsed.passed === "boolean") {
      return {
        passed: parsed.passed,
        score: typeof parsed.score === "number" ? parsed.score : parsed.passed ? 1 : 0,
        reason: parsed.reason,
      };
    }
    return { passed: false, score: 0, reason: "llm-judge returned unparseable output" };
  },

  /** Every whitespace-separated token in `expected` must appear in the output. */
  "contains-all": (output, expected) => {
    const tokens = expected.split(/\s+/).filter(Boolean);
    const missing = tokens.filter((t) => !output.includes(t));
    return {
      passed: missing.length === 0,
      score: tokens.length ? (tokens.length - missing.length) / tokens.length : 0,
      reason: missing.length ? `missing: ${missing.join(", ")}` : undefined,
    };
  },

  /** Pass if output contains NONE of the `||`-separated forbidden strings. */
  "not-contains": (output, expected) => {
    const forbidden = expected.split("||").map((s) => s.trim()).filter(Boolean);
    const found = forbidden.filter((f) => output.includes(f));
    return {
      passed: found.length === 0,
      score: found.length === 0 ? 1 : 0,
      reason: found.length ? `forbidden present: ${found.join(", ")}` : undefined,
    };
  },

  /** Normalized Levenshtein similarity vs expected, ≥ opts.threshold (default 0.8). */
  similarity: (output, expected, ctx) => {
    const threshold = Number(ctx?.opts?.threshold ?? 0.8);
    const sim = levenshteinSimilarity(output.trim(), expected.trim());
    return {
      passed: sim >= threshold,
      score: sim,
      reason: `similarity ${sim.toFixed(2)} (threshold ${threshold})`,
    };
  },

  /** Output must parse as JSON (tolerates surrounding prose). */
  "json-valid": (output) => {
    try {
      JSON.parse(extractJson(output));
      return { passed: true, score: 1 };
    } catch (e) {
      return { passed: false, score: 0, reason: `invalid JSON: ${(e as Error).message}` };
    }
  },

  /** Check a dot-path inside parsed JSON equals opts.equals (or the expected string). */
  "json-path": (output, expected, ctx) => {
    const path = String(ctx?.opts?.path ?? "");
    if (!path) return { passed: false, score: 0, reason: "json-path grader needs `path`" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(output));
    } catch (e) {
      return { passed: false, score: 0, reason: `invalid JSON: ${(e as Error).message}` };
    }
    const actual = getPath(parsed, path);
    const want = ctx?.opts?.equals !== undefined ? ctx.opts.equals : expected;
    const passed =
      JSON.stringify(actual) === JSON.stringify(want) || String(actual) === String(want);
    return {
      passed,
      score: passed ? 1 : 0,
      reason: passed ? undefined : `path ${path} = ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`,
    };
  },

  /** Minimal JSON-schema validation (type / required / properties / enum). */
  schema: (output, _expected, ctx) => {
    const schema = (ctx?.opts?.schema ?? {}) as Record<string, unknown>;
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(output));
    } catch (e) {
      return { passed: false, score: 0, reason: `invalid JSON: ${(e as Error).message}` };
    }
    const errors = validateMinimal(parsed, schema, "$");
    return {
      passed: errors.length === 0,
      score: errors.length === 0 ? 1 : 0,
      reason: errors.length ? errors.slice(0, 5).join("; ") : undefined,
    };
  },
};

/** Resolve a spec (string or object) into a bound grader function. */
export function resolveGrader(spec: GraderSpec): Grader {
  const type = specType(spec);
  const base = graders[type];
  if (!base) throw new Error(`Unknown grader: ${type}`);
  const opts = specOpts(spec);
  return (output, expected, ctx) => base(output, expected, { ...ctx, opts: { ...opts, ...(ctx?.opts ?? {}) } });
}

/** Platform-correct shell quoting for inline `{{output}}` substitution.
 *  On Windows (cmd.exe) there's no perfect escape, so the env-var form
 *  (FORGE_OUTPUT / FORGE_EXPECTED) is the robust option; this is best-effort. */
function shellQuote(s: string): string {
  if (process.platform === "win32") {
    return `"${s.replaceAll('"', '\\"')}"`;
  }
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    const match = s.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Normalized Levenshtein similarity in [0, 1] (1 = identical). */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  const dist = prev[n];
  return 1 - dist / Math.max(m, n);
}

/** Extract the first JSON object/array from a string that may contain prose. */
function extractJson(s: string): string {
  const t = s.trim();
  if (t.startsWith("{") || t.startsWith("[")) return t;
  const m = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return m ? m[1] : s;
}

/** Read a dot-separated path out of a parsed value. */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** Deliberately small JSON-schema validator (enough for eval assertions). */
function validateMinimal(value: unknown, schema: Record<string, unknown>, path: string): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (type === "string" && typeof value !== "string") errors.push(`${path}: expected string`);
  if (type === "number" && typeof value !== "number") errors.push(`${path}: expected number`);
  if (type === "integer" && (!Number.isInteger(value))) errors.push(`${path}: expected integer`);
  if (type === "boolean" && typeof value !== "boolean") errors.push(`${path}: expected boolean`);
  if (type === "array" && !Array.isArray(value)) errors.push(`${path}: expected array`);
  if (type === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
    errors.push(`${path}: expected object`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: not in enum`);
  }
  if (
    Array.isArray(schema.required) &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    for (const r of schema.required) {
      if (!(r as string in (value as object))) errors.push(`${path}.${r}: required`);
    }
  }
  if (schema.properties && typeof value === "object" && value && !Array.isArray(value)) {
    for (const [k, sub] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) errors.push(...validateMinimal(v, sub, `${path}.${k}`));
    }
  }
  return errors;
}

/**
 * Pattern extractor — the engine of the self-improving loop.
 *
 * Scans session events for behaviors worth learning:
 *  - repeated user corrections (the same fix you keep re-applying)
 *  - assistant self-corrections ("actually…", "scratch that")
 *  - lint/test fix-loops (same rule flagged again and again)
 *  - repeated shell commands (a ritual you run every time)
 *
 * Signature capability #3: usage produces learnings.
 */

import { type LogEvent, signature } from "./logformat.ts";

export type CandidateKind =
  | "correction"
  | "self-correction"
  | "lint-loop"
  | "repeated-command";

export interface Candidate {
  kind: CandidateKind;
  /** Normalized signature used for dedupe/versioning. */
  pattern: string;
  count: number;
  evidence: string[];
  /** Human-readable title. */
  title: string;
  suggestedName: string;
  suggestedBody: string;
}

export interface ExtractOptions {
  /** Minimum occurrences before a pattern becomes a candidate. Default 2. */
  minCount?: number;
  /** Cap evidence samples retained per candidate. Default 3. */
  maxEvidence?: number;
}

const CORRECTION_RE =
  /^(remove|stop|don'?t|never|avoid|use|always|prefer|instead of|fix|you should|rename|make sure)\b|\binstead of\b/i;
const SELF_CORRECTION_RE =
  /\b(actually|correction:|let me (redo|revert|fix|rewrite)|scratch that|my (mistake|apology)|oops)\b/i;
const LINT_TOOL_RE = /\b(eslint|ruff|flake8|pylint|tsc|typescript|mypy|pytest|npm test|go test|cargo test|lint)\b/i;

export function extract(events: LogEvent[], opts: ExtractOptions = {}): Candidate[] {
  const minCount = opts.minCount ?? 2;
  const maxEvidence = opts.maxEvidence ?? 3;

  // Buckets keyed by kind + signature.
  const buckets = new Map<string, { kind: CandidateKind; pattern: string; count: number; evidence: string[]; title: string }>();

  const bump = (kind: CandidateKind, text: string, title?: string) => {
    const sig = signature(text);
    if (sig.length < 8) return; // ignore trivial lines
    const key = `${kind}::${sig}`;
    const b = buckets.get(key) ?? { kind, pattern: sig, count: 0, evidence: [], title: title ?? text.slice(0, 80) };
    b.count++;
    if (b.evidence.length < maxEvidence) b.evidence.push(text.trim().slice(0, 200));
    buckets.set(key, b);
  };

  for (const e of events) {
    const text = e.content ?? "";
    if (e.type === "message" && e.role === "user" && text && CORRECTION_RE.test(text.trim())) {
      bump("correction", text);
    }
    if (e.type === "message" && e.role === "assistant" && text && SELF_CORRECTION_RE.test(text)) {
      bump("self-correction", text);
    }
    if (e.type === "tool_use") {
      const tool = e.tool ?? "";
      const cmdline = describeToolCall(e);
      if (LINT_TOOL_RE.test(tool) || LINT_TOOL_RE.test(cmdline)) {
        bump("lint-loop", cmdline || tool);
      } else if (isShellTool(tool)) {
        bump("repeated-command", cmdline || tool);
      }
    }
  }

  const candidates: Candidate[] = [];
  for (const b of buckets.values()) {
    if (b.count < minCount) continue;
    candidates.push(toCandidate(b));
  }

  // Most-repeated first.
  candidates.sort((a, b) => b.count - a.count);
  return candidates;
}

function isShellTool(tool: string): boolean {
  return /bash|shell|terminal|exec|run_command|powershell/i.test(tool);
}

function describeToolCall(e: LogEvent): string {
  const input = e.input;
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const key of ["command", "cmd", "script", "code", "pattern"]) {
      if (typeof o[key] === "string") return o[key] as string;
    }
    return JSON.stringify(input);
  }
  return e.tool ?? "";
}

function toCandidate(b: {
  kind: CandidateKind;
  pattern: string;
  count: number;
  evidence: string[];
  title: string;
}): Candidate {
  const name = slug(b.title);
  return {
    kind: b.kind,
    pattern: b.pattern,
    count: b.count,
    evidence: b.evidence,
    title: b.title,
    suggestedName: name,
    suggestedBody: renderSkillBody(b),
  };
}

function renderSkillBody(b: { kind: CandidateKind; title: string; count: number; evidence: string[] }): string {
  const lines: string[] = [];
  lines.push(`# ${b.title}`);
  lines.push("");
  lines.push(`> Auto-extracted by forge learn (${b.kind}, observed ${b.count}x).`);
  lines.push("");
  lines.push("## Rule");
  lines.push("");
  lines.push(ruleFor(b));
  lines.push("");
  lines.push("## Evidence from sessions");
  lines.push("");
  for (const ev of b.evidence) lines.push(`- \`${ev.replaceAll("\n", " ").slice(0, 160)}\``);
  lines.push("");
  return lines.join("\n");
}

function ruleFor(b: { kind: CandidateKind; title: string }): string {
  switch (b.kind) {
    case "correction":
      return `Always apply this user preference by default: **${b.title}**`;
    case "self-correction":
      return `Avoid the misstep that triggered: **${b.title}** — verify before emitting.`;
    case "lint-loop":
      return `Run and satisfy this check before finishing: **${b.title}**`;
    case "repeated-command":
      return `This command is part of your workflow — run it proactively: **${b.title}**`;
    default:
      return b.title;
  }
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "pattern"
  );
}

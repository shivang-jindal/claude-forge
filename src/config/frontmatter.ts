/**
 * Minimal YAML-frontmatter parser for the markdown config library.
 *
 * Supports the subset forge needs: scalars, quoted strings, inline comma
 * lists, and simple `key: value` pairs. Deliberately small — no external deps.
 */

export interface Frontmatter {
  data: Record<string, string | number | boolean | string[]>;
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^﻿/, "");
  if (!normalized.startsWith("---")) {
    return { data: {}, body: normalized };
  }
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: normalized };
  }
  const header = normalized.slice(normalized.indexOf("\n") + 1, end);
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1).replace(/^\n/, "");

  const data: Frontmatter["data"] = {};
  for (const rawLine of header.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    data[key] = coerce(value);
  }
  return { data, body };
}

function coerce(value: string): string | number | boolean | string[] {
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  // Inline comma list — but ONLY when every segment is a bare token (no spaces).
  // This keeps prose values ("…concrete, dependency-ordered plan…") as strings
  // while still parsing tool/dependency lists ("Read, Grep, Glob").
  if (value.includes(",") && !value.startsWith('"') && !value.startsWith("'")) {
    const segments = value.split(",").map((v) => v.trim()).filter(Boolean);
    if (segments.length > 1 && segments.every((s) => /^[A-Za-z0-9_.@/-]+$/.test(s))) {
      return segments;
    }
  }
  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Build a frontmatter block from a data object (for writing skills). */
export function renderFrontmatter(data: Record<string, string | string[]>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    lines.push(Array.isArray(v) ? `${k}: ${v.join(", ")}` : `${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

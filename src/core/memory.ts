/**
 * Persistent, cross-session memory.
 *
 * ECC's `memory-persistence` hook appends free-form markdown. forge has a
 * typed memory store with keyword/tag retrieval, usage-recency scoring, and
 * durable persistence to `.forge/memory.json`. It backs `forge memory` and the
 * `learn` loop (approved skills can be promoted to memory entries).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type MemoryKind = "fact" | "preference" | "instruction" | "pattern";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  tags: string[];
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 1),
  );
}

let seq = 0;
function memId(): string {
  seq += 1;
  return `mem-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export class MemoryStore {
  private entries: MemoryEntry[] = [];
  private readonly file?: string;

  constructor(file?: string) {
    this.file = file;
    if (file) this.load();
  }
  add(kind: MemoryKind, text: string, tags: string[] = []): MemoryEntry {
    const entry: MemoryEntry = {
      id: memId(),
      kind,
      text,
      tags,
      createdAt: new Date().toISOString(),
      useCount: 0,
    };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  /** Keyword/tag overlap search; returns top-k by score, recency as tiebreak. */
  search(query: string, k = 5): MemoryEntry[] {
    const q = tokenize(query);
    const scored = this.entries.map((e) => {
      const eTokens = tokenize(e.text);
      const tagSet = new Set(e.tags.map((t) => t.toLowerCase()));
      let overlap = 0;
      for (const t of q) if (eTokens.has(t) || tagSet.has(t)) overlap += 1;
      const denom = Math.max(1, new Set([...q, ...eTokens]).size);
      const base = overlap / denom;
      const recency = e.useCount > 0 ? Math.min(0.1, e.useCount * 0.01) : 0;
      return { e, score: base + recency };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.e.createdAt.localeCompare(a.e.createdAt))
      .slice(0, k)
      .map((s) => s.e);
  }

  /** Look up by id and bump its usage counter (feeds recency). */
  recall(id: string): MemoryEntry | undefined {
    const e = this.entries.find((x) => x.id === id);
    if (e) {
      e.useCount += 1;
      e.lastUsedAt = new Date().toISOString();
      this.save();
    }
    return e;
  }

  get(id: string): MemoryEntry | undefined {
    return this.entries.find((x) => x.id === id);
  }

  remove(id: string): boolean {
    const i = this.entries.findIndex((x) => x.id === id);
    if (i >= 0) {
      this.entries.splice(i, 1);
      this.save();
      return true;
    }
    return false;
  }

  all(): MemoryEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ version: 1, entries: this.entries }, null, 2));
  }

  load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { entries?: MemoryEntry[] };
      this.entries = Array.isArray(raw.entries) ? raw.entries : [];
    } catch {
      this.entries = [];
    }
  }
}

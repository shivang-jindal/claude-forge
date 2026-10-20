/**
 * Skill proposals + human approval gate.
 *
 * Candidates from the extractor become versioned skill proposals persisted in
 * the store. Nothing is auto-installed — a human approves. Rejections are
 * remembered so the same pattern isn't re-proposed. This closes the loop:
 * usage → learnings → approved skills → better next run.
 *
 * Signature capability #3.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store, SkillRecord } from "../core/store.ts";
import type { Candidate } from "./extractor.ts";
import { log } from "../core/logger.ts";

export interface IngestResult {
  created: SkillRecord[];
  updated: SkillRecord[];
  skipped: SkillRecord[];
}

function hash(str: string): string {
  // djb2 → 8-hex-digit id.
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export class LearningLoop {
  private readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  /** Turn candidates into proposals (deduped, versioned, never auto-approved). */
  ingest(candidates: Candidate[]): IngestResult {
    const created: SkillRecord[] = [];
    const updated: SkillRecord[] = [];
    const skipped: SkillRecord[] = [];

    for (const c of candidates) {
      const id = `skill-${hash(c.kind + "::" + c.pattern)}`;
      const existing = this.store.getSkill(id);

      if (existing) {
        if (existing.status === "rejected" || existing.status === "installed") {
          skipped.push(existing);
          continue;
        }
        // Merge new evidence into the still-proposed skill.
        const evidence = [...existing.evidence];
        for (const ev of c.evidence) if (!evidence.includes(ev)) evidence.push(ev);
        const merged: SkillRecord = { ...existing, evidence, body: c.suggestedBody };
        this.store.upsertSkill(merged);
        updated.push(merged);
        continue;
      }

      const rec: SkillRecord = {
        id,
        name: c.suggestedName,
        version: 1,
        status: "proposed",
        body: c.suggestedBody,
        evidence: c.evidence,
        createdAt: new Date().toISOString(),
      };
      this.store.upsertSkill(rec);
      created.push(rec);
    }

    log.info(`learn: ${created.length} new, ${updated.length} updated, ${skipped.length} skipped`);
    return { created, updated, skipped };
  }

  list(status?: SkillRecord["status"]): SkillRecord[] {
    return this.store.listSkills(status);
  }

  /**
   * Approve a proposal → installed. If `skillsDir` is given, also writes
   * `skillsDir/<name>/SKILL.md` so the config loader can pick it up.
   */
  approve(id: string, opts: { skillsDir?: string } = {}): SkillRecord {
    const rec = this.store.getSkill(id);
    if (!rec) throw new Error(`No skill proposal with id ${id}`);
    if (rec.status === "rejected") throw new Error(`${id} was rejected; un-reject is not supported`);
    const installed: SkillRecord = { ...rec, status: "installed" };
    this.store.upsertSkill(installed);

    if (opts.skillsDir) {
      const dir = join(opts.skillsDir, installed.name);
      mkdirSync(dir, { recursive: true });
      const md = `---\nname: ${installed.name}\ndescription: ${firstLine(installed.body)}\n---\n\n${installed.body}\n`;
      writeFileSync(join(dir, "SKILL.md"), md, "utf8");
      log.info(`learn: installed ${installed.name} → ${dir}/SKILL.md`);
    }
    return installed;
  }

  /** Reject a proposal; it will not be re-proposed. */
  reject(id: string): SkillRecord {
    const rec = this.store.getSkill(id);
    if (!rec) throw new Error(`No skill proposal with id ${id}`);
    const rejected: SkillRecord = { ...rec, status: "rejected" };
    this.store.upsertSkill(rejected);
    return rejected;
  }
}

function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim() && !l.startsWith("#"));
  return (line ?? "Auto-extracted forge skill").replace(/^>\s*/, "").slice(0, 120);
}

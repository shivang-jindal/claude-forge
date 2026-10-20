/**
 * Atomic JSON state store under `.forge/`.
 *
 * Holds run history, eval results, the skill registry, and learning candidates.
 * Writes are atomic (temp file + rename) so a crash never corrupts state.
 */

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Directory (relative to the project root) holding all local state. */
export const STATE_DIR = ".forge";

export interface RunRecord {
  id: string;
  workflow: string;
  status: "success" | "failed" | "partial";
  startedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  steps: Array<{ id: string; status: string; attempts: number; durationMs: number }>;
}

export interface EvalRecord {
  id: string;
  agent: string;
  dataset: string;
  trials: number;
  passAt1: number;
  passAtK: number;
  costUsd: number;
  at: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  version: number;
  status: "proposed" | "approved" | "rejected" | "installed";
  body: string;
  evidence: string[];
  createdAt: string;
}

interface StoreShape {
  runs: RunRecord[];
  evals: EvalRecord[];
  skills: SkillRecord[];
}

const EMPTY: StoreShape = { runs: [], evals: [], skills: [] };

export class Store {
  readonly dir: string;
  private readonly file: string;

  constructor(root = process.cwd()) {
    this.dir = join(root, STATE_DIR);
    this.file = join(this.dir, "state.json");
  }

  private load(): StoreShape {
    if (!existsSync(this.file)) return { ...EMPTY, runs: [], evals: [], skills: [] };
    try {
      const raw = readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      return {
        runs: parsed.runs ?? [],
        evals: parsed.evals ?? [],
        skills: parsed.skills ?? [],
      };
    } catch {
      return { ...EMPTY, runs: [], evals: [], skills: [] };
    }
  }

  private save(data: StoreShape): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, this.file); // atomic on POSIX + NTFS
  }

  addRun(run: RunRecord): void {
    const d = this.load();
    d.runs.push(run);
    // Keep last 200 runs.
    if (d.runs.length > 200) d.runs = d.runs.slice(-200);
    this.save(d);
  }

  addEval(evalRec: EvalRecord): void {
    const d = this.load();
    d.evals.push(evalRec);
    this.save(d);
  }

  listEvals(agent?: string): EvalRecord[] {
    const d = this.load();
    return agent ? d.evals.filter((e) => e.agent === agent) : d.evals;
  }

  latestEval(agent: string, dataset: string): EvalRecord | undefined {
    const matches = this.load().evals.filter((e) => e.agent === agent && e.dataset === dataset);
    return matches[matches.length - 1];
  }

  listRuns(): RunRecord[] {
    return this.load().runs;
  }

  upsertSkill(rec: SkillRecord): void {
    const d = this.load();
    const i = d.skills.findIndex((s) => s.id === rec.id);
    if (i >= 0) d.skills[i] = rec;
    else d.skills.push(rec);
    this.save(d);
  }

  listSkills(status?: SkillRecord["status"]): SkillRecord[] {
    const d = this.load();
    return status ? d.skills.filter((s) => s.status === status) : d.skills;
  }

  getSkill(id: string): SkillRecord | undefined {
    return this.load().skills.find((s) => s.id === id);
  }
}

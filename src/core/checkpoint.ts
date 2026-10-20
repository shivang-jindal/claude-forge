/**
 * Checkpoint / resume for workflow runs.
 *
 * Long runs shouldn't restart from scratch after an interruption. forge can
 * persist a snapshot of completed step results (`CheckpointStore`) and resume
 * a workflow, skipping steps that already succeeded. The engine accepts
 * `resumeFrom` to pre-seed those results.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { StepResult } from "./engine.ts";

export interface Checkpoint {
  id: string;
  workflow: string;
  inputs: Record<string, unknown>;
  /** stepId → result for steps that completed successfully. */
  completed: Record<string, StepResult>;
  savedAt: string;
}

let cpSeq = 0;

export class CheckpointStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  save(
    workflow: string,
    inputs: Record<string, unknown>,
    results: StepResult[],
    id?: string,
  ): Checkpoint {
    cpSeq += 1;
    const cp: Checkpoint = {
      id: id ?? `cp-${Date.now().toString(36)}-${cpSeq.toString(36)}`,
      workflow,
      inputs,
      completed: Object.fromEntries(
        results.filter((r) => r.status === "success").map((r) => [r.id, r]),
      ),
      savedAt: new Date().toISOString(),
    };
    writeFileSync(join(this.dir, `${cp.id}.json`), JSON.stringify(cp, null, 2));
    return cp;
  }

  load(id: string): Checkpoint | undefined {
    const f = join(this.dir, `${id}.json`);
    if (!existsSync(f)) return undefined;
    try {
      return JSON.parse(readFileSync(f, "utf8")) as Checkpoint;
    } catch {
      return undefined;
    }
  }

  /** Most recent checkpoint (by savedAt) for a workflow name. */
  latestFor(workflow: string): Checkpoint | undefined {
    return this.list()
      .filter((c) => c.workflow === workflow)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  }

  list(): Checkpoint[] {
    if (!existsSync(this.dir)) return [];
    const out: Checkpoint[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(readFileSync(join(this.dir, f), "utf8")) as Checkpoint);
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  }

  remove(id: string): boolean {
    const f = join(this.dir, `${id}.json`);
    if (!existsSync(f)) return false;
    try {
      unlinkSync(f);
      return true;
    } catch {
      return false;
    }
  }
}

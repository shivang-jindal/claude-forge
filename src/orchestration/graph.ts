/**
 * DAG analysis + visualization for workflows.
 *
 * Given a workflow's steps and `needs` dependencies, compute:
 *  - levels (steps that can run in parallel together),
 *  - the critical path (longest dependency chain),
 *  - max concurrency, and
 *  - renderable output (ASCII tree + Mermaid flowchart) so you can SEE the plan.
 */

import type { WorkflowDef } from "../core/engine.ts";

export interface DagAnalysis {
  levels: string[][];
  criticalPath: string[];
  criticalLength: number;
  maxParallel: number;
  cycle?: string[];
}

function neighbors(wf: WorkflowDef): { ids: string[]; deps: Map<string, string[]> } {
  const ids = wf.steps.map((s) => s.id);
  const deps = new Map<string, string[]>();
  for (const s of wf.steps) deps.set(s.id, [...(s.needs ?? [])]);
  return { ids, deps };
}

/** Longest-path leveling. Returns undefined level assignment if there's a cycle. */
export function analyzeDag(wf: WorkflowDef): DagAnalysis {
  const { ids, deps } = neighbors(wf);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (id: string): number | undefined => {
    const memo = depth.get(id);
    if (memo !== undefined) return memo;
    if (visiting.has(id)) return undefined; // cycle
    visiting.add(id);
    let maxDep = -1;
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue; // unknown dep ignored (engine treats as no-op)
      const dd = depthOf(d);
      if (dd === undefined) return undefined;
      maxDep = Math.max(maxDep, dd);
    }
    visiting.delete(id);
    const v = maxDep + 1;
    depth.set(id, v);
    return v;
  };

  for (const id of ids) {
    const d = depthOf(id);
    if (d === undefined) {
      return { levels: [], criticalPath: [], criticalLength: 0, maxParallel: 0, cycle: [id] };
    }
  }

  const levels: string[][] = [];
  for (const id of ids) {
    const d = depth.get(id)!;
    (levels[d] ??= []).push(id);
  }
  // Trim holes (shouldn't be any, but be safe) and keep only populated levels.
  const cleanLevels = levels.filter((l) => l && l.length > 0);

  // Critical path: walk back from the deepest node through a max-depth parent.
  const parentOf = new Map<string, string | undefined>();
  for (const s of wf.steps) {
    let best: string | undefined;
    let bestDepth = -1;
    for (const d of s.needs ?? []) {
      const dd = depth.get(d);
      if (dd !== undefined && dd > bestDepth) {
        bestDepth = dd;
        best = d;
      }
    }
    parentOf.set(s.id, best);
  }
  let tail = ids[0];
  for (const id of ids) if ((depth.get(id) ?? 0) > (depth.get(tail) ?? 0)) tail = id;
  const criticalPath: string[] = [];
  let cur: string | undefined = tail;
  while (cur !== undefined) {
    criticalPath.unshift(cur);
    cur = parentOf.get(cur);
  }

  return {
    levels: cleanLevels,
    criticalPath,
    criticalLength: cleanLevels.length,
    maxParallel: Math.max(1, ...cleanLevels.map((l) => l.length)),
  };
}

/** Render the workflow as a Mermaid flowchart (for READMEs / PR comments). */
export function toMermaid(wf: WorkflowDef): string {
  const lines: string[] = ["flowchart TD"];
  for (const s of wf.steps) {
    const node = `${s.id.replace(/[^A-Za-z0-9_]/g, "_")}["${s.id}${s.agent ? ` (${s.agent})` : ""}"]`;
    lines.push(`  ${node}`);
  }
  for (const s of wf.steps) {
    const from = s.id.replace(/[^A-Za-z0-9_]/g, "_");
    for (const d of s.needs ?? []) {
      const to = d.replace(/[^A-Za-z0-9_]/g, "_");
      lines.push(`  ${to} --> ${from}`);
    }
  }
  return lines.join("\n");
}

/** Render a compact ASCII level view. */
export function toAscii(wf: WorkflowDef): string {
  const a = analyzeDag(wf);
  if (a.cycle) return `cycle detected at: ${a.cycle.join(", ")}`;
  const width = Math.max(...a.levels.map((l) => Math.max(...l.map((id) => id.length))));
  const out: string[] = [];
  a.levels.forEach((level, i) => {
    out.push(`L${i}: ${level.map((id) => id.padEnd(width)).join(" | ")}`);
    if (i < a.levels.length - 1) out.push(" ".repeat(3) + "-".repeat(width * 2));
  });
  out.push("");
  out.push(`critical path: ${a.criticalPath.join(" -> ")}`);
  out.push(`max parallelism: ${a.maxParallel}`);
  return out.join("\n");
}

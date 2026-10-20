/**
 * Workflow engine — config-as-code.
 *
 * Declarative DAGs with: dependency ordering, bounded parallel execution,
 * per-step retries with exponential backoff, timeouts, conditional skips
 * (`when`), and dynamic branch routing (`route`). Every step can run through a
 * ContextManager (so it inherits token budgeting) or a custom `run` executor.
 *
 * Signature capability: this is what static markdown configs cannot do.
 */

import { ContextManager, type CompactionStrategy } from "./context.ts";
import type { LLMProvider } from "./llm.ts";
import { log } from "./logger.ts";
import type { Hooks } from "./hooks.ts";
import type { TokenBucket, CircuitBreaker } from "./ratelimit.ts";

export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "timeout";

export interface StepContext {
  stepId: string;
  /** Outputs of completed prerequisite steps, keyed by step id. */
  outputs: Record<string, string>;
  /** Run-level inputs/vars. */
  inputs: Record<string, unknown>;
  attempt: number;
}

export interface StepDef {
  id: string;
  /** Optional agent name (informational / for config lookup). */
  agent?: string;
  /** Prompt template (string) or function of the step context. */
  prompt?: string | ((ctx: StepContext) => string);
  /** Custom executor. If present, it wins over prompt/provider. */
  run?: (ctx: StepContext) => string | Promise<string>;
  /** Static dependencies (step ids). */
  needs?: string[];
  /** Additional attempts after the first. Default 0. */
  retries?: number;
  timeoutMs?: number;
  /** Per-step resident-context ceiling (tokens). Overrides workflow budget. */
  maxInputTokens?: number;
  /** Conditional gate; returning false skips the step. */
  when?: (ctx: StepContext) => boolean;
  /** After success, choose the single dependent to unblock (exclusive branch). */
  route?: (output: string, ctx: StepContext) => string | null;
}

export interface WorkflowDef {
  name: string;
  description?: string;
  inputs?: Record<string, unknown>;
  concurrency?: number;
  compaction?: CompactionStrategy;
  budget?: { maxTokens?: number };
  steps: StepDef[];
}

export interface StepResult {
  id: string;
  status: StepStatus;
  output: string;
  attempts: number;
  durationMs: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface RunResult {
  workflow: string;
  status: "success" | "failed" | "partial";
  steps: StepResult[];
  durationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  outputs: Record<string, string>;
}

export interface EngineOptions {
  provider?: LLMProvider;
  inputs?: Record<string, unknown>;
  concurrency?: number;
  model?: string;
  /** Map of agent name → system prompt (from the config library). Steps that
   *  declare an `agent` get its body injected as the system prompt. */
  agents?: Record<string, string>;
  /** Lifecycle hooks — observers and vetoes for run/step/tool events. */
  hooks?: Hooks;
  /** Token-bucket limiter applied before every provider call. */
  limiter?: TokenBucket;
  /** Circuit breaker guarding the provider (opens after repeated failures). */
  breaker?: CircuitBreaker;
  /** Pre-completed step results (from a checkpoint) — these steps are skipped. */
  resumeFrom?: Record<string, StepResult>;
  /** Called for each engine event (for CLIs / tracing). */
  onEvent?: (e: EngineEvent) => void;
}

export type EngineEventType =
  | "run:start"
  | "run:end"
  | "step:start"
  | "step:retry"
  | "step:end"
  | "step:skip"
  | "compact";

export interface EngineEvent {
  type: EngineEventType;
  stepId?: string;
  attempt?: number;
  status?: StepStatus;
  message?: string;
  ms?: number;
}

/** Validate the DAG: unique ids, resolvable deps, and no cycles. */
export function validateWorkflow(wf: WorkflowDef): void {
  const ids = new Set<string>();
  for (const s of wf.steps) {
    if (ids.has(s.id)) throw new Error(`Duplicate step id: ${s.id}`);
    ids.add(s.id);
  }
  for (const s of wf.steps) {
    for (const d of s.needs ?? []) {
      if (!ids.has(d)) throw new Error(`Step '${s.id}' needs unknown step '${d}'`);
    }
  }
  // Kahn's algorithm for cycle detection.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of wf.steps) {
    indegree.set(s.id, (s.needs ?? []).length);
    for (const d of s.needs ?? []) {
      dependents.set(d, [...(dependents.get(d) ?? []), s.id]);
    }
  }
  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const dep of dependents.get(id) ?? []) {
      const n = indegree.get(dep)! - 1;
      indegree.set(dep, n);
      if (n === 0) queue.push(dep);
    }
  }
  if (visited !== wf.steps.length) {
    throw new Error(`Workflow '${wf.name}' contains a dependency cycle`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Engine {
  private readonly opts: EngineOptions;
  constructor(opts: EngineOptions = {}) {
    this.opts = opts;
  }

  async run(wf: WorkflowDef): Promise<RunResult> {
    validateWorkflow(wf);
    const t0 = Date.now();
    const emit = (e: EngineEvent) => {
      this.opts.onEvent?.(e);
      log.debug(`[${e.type}]${e.stepId ? ` ${e.stepId}` : ""}${e.message ? ` ${e.message}` : ""}`);
    };

    const inputs = { ...(wf.inputs ?? {}), ...(this.opts.inputs ?? {}) };
    const concurrency = this.opts.concurrency ?? wf.concurrency ?? 4;

    const state = new Map<string, StepResult>();
    const started = new Set<string>();
    const unresolved = new Map<string, Set<string>>();
    const dependents = new Map<string, string[]>();
    for (const s of wf.steps) {
      state.set(s.id, { id: s.id, status: "pending", output: "", attempts: 0, durationMs: 0 });
      unresolved.set(s.id, new Set(s.needs ?? []));
      for (const d of s.needs ?? []) {
        dependents.set(d, [...(dependents.get(d) ?? []), s.id]);
      }
    }

    // Resume support: seed previously-completed steps from a checkpoint so a
    // re-run doesn't redo work that already succeeded.
    if (this.opts.resumeFrom) {
      for (const s of wf.steps) {
        const prev = this.opts.resumeFrom[s.id];
        if (!prev || prev.status !== "success") continue;
        state.set(s.id, { ...prev });
        started.add(s.id);
        for (const depId of dependents.get(s.id) ?? []) unresolved.get(depId)?.delete(s.id);
      }
    }

    const inflight = new Map<string, Promise<void>>();
    let runFailed = false;
    const runId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

    emit({ type: "run:start", message: wf.name });
    await this.opts.hooks?.trigger({ phase: "run:start", runId, data: { workflow: wf.name } });

    const ctxOf = (step: StepDef, attempt: number): StepContext => {
      const outputs: Record<string, string> = {};
      for (const d of step.needs ?? []) outputs[d] = state.get(d)?.output ?? "";
      return { stepId: step.id, outputs, inputs, attempt };
    };

    const skipStep = (id: string, reason: string) => {
      const st = state.get(id)!;
      st.status = "skipped";
      st.error = reason;
      emit({ type: "step:skip", stepId: id, message: reason });
      // Cascade: resolve this step for its dependents.
      resolveDependents(id);
    };

    const resolveDependents = (finishedId: string) => {
      for (const depId of dependents.get(finishedId) ?? []) {
        unresolved.get(depId)?.delete(finishedId);
      }
    };

    const startStep = (step: StepDef): Promise<void> => {
      const p = this.executeStep(step, wf, emit, (attempt) => ctxOf(step, attempt), runId)
        .then((result) => {
          state.set(step.id, result);
          inflight.delete(step.id);
          if (result.status === "failed" || result.status === "timeout") {
            runFailed = true;
          }
          // Branch routing: pick exactly one dependent to unblock.
          if (result.status === "success" && step.route) {
            const target = step.route(result.output, ctxOf(step, 0));
            for (const depId of dependents.get(step.id) ?? []) {
              if (depId === target) unresolved.get(depId)?.delete(step.id);
              else skipStep(depId, `not routed from ${step.id}`);
            }
          } else {
            resolveDependents(step.id);
          }
        })
        .catch((err) => {
          const st = state.get(step.id)!;
          st.status = "failed";
          st.error = err instanceof Error ? err.message : String(err);
          inflight.delete(step.id);
          runFailed = true;
          resolveDependents(step.id);
        });
      inflight.set(step.id, p);
      return p;
    };

    // Scheduler loop.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Enqueue all ready steps up to the concurrency cap.
      for (const step of wf.steps) {
        if (started.has(step.id)) continue;
        if (inflight.size >= concurrency) break;
        const unres = unresolved.get(step.id)!;
        if (unres.size > 0) continue;

        // All deps finished. Decide: run, skip (upstream skipped/failed), or gate.
        const depStatuses = (step.needs ?? []).map((d) => state.get(d)?.status);
        if (runFailed && depStatuses.some((s) => s === "failed")) {
          started.add(step.id);
          skipStep(step.id, "upstream failed");
          continue;
        }
        if (depStatuses.some((s) => s === "skipped")) {
          started.add(step.id);
          skipStep(step.id, "upstream skipped");
          continue;
        }

        // Evaluate `when` gate with the base context.
        if (step.when && !step.when(ctxOf(step, 0))) {
          started.add(step.id);
          skipStep(step.id, "when() gate returned false");
          continue;
        }

        started.add(step.id);
        void startStep(step);
      }

      if (inflight.size === 0) {
        // Nothing running. If any step is still pending-and-ready we'd have
        // started it above; so either we're done or we're deadlocked.
        const stillPending = wf.steps.filter((s) => state.get(s.id)!.status === "pending");
        if (stillPending.length === 0) break;
        // Deadlock guard (shouldn't happen post-validation, but be safe).
        for (const s of stillPending) skipStep(s.id, "unreachable (deps never resolved)");
        break;
      }

      await Promise.race(inflight.values());
    }

    await Promise.allSettled(inflight.values());

    const steps = wf.steps.map((s) => state.get(s.id)!);
    const anyFailed = steps.some((s) => s.status === "failed" || s.status === "timeout");
    const anySuccess = steps.some((s) => s.status === "success");
    const status: RunResult["status"] = anyFailed
      ? anySuccess
        ? "partial"
        : "failed"
      : "success";

    const totals = steps.reduce(
      (acc, s) => ({
        input: acc.input + (s.inputTokens ?? 0),
        output: acc.output + (s.outputTokens ?? 0),
        cost: acc.cost + (s.costUsd ?? 0),
      }),
      { input: 0, output: 0, cost: 0 },
    );

    const outputs: Record<string, string> = {};
    for (const s of steps) outputs[s.id] = s.output;

    const result: RunResult = {
      workflow: wf.name,
      status,
      steps,
      durationMs: Date.now() - t0,
      totalInputTokens: totals.input,
      totalOutputTokens: totals.output,
      totalCostUsd: totals.cost,
      outputs,
    };
    emit({ type: "run:end", status, ms: result.durationMs, message: status });
    await this.opts.hooks?.trigger({
      phase: "run:end",
      runId,
      data: { workflow: wf.name, status, durationMs: result.durationMs, costUsd: result.totalCostUsd },
    });
    return result;
  }

  private async executeStep(
    step: StepDef,
    wf: WorkflowDef,
    emit: (e: EngineEvent) => void,
    ctxForAttempt: (attempt: number) => StepContext,
    runId: string,
  ): Promise<StepResult> {
    const st: StepResult = {
      id: step.id,
      status: "pending",
      output: "",
      attempts: 0,
      durationMs: 0,
    };
    const t0 = Date.now();
    const retries = step.retries ?? 0;
    const maxAttempts = retries + 1;
    emit({ type: "step:start", stepId: step.id, attempt: 1 });

    // A hook may VETO the step. A vetoed step is skipped (not failed) so the
    // rest of the workflow still resolves.
    const startHook = await this.opts.hooks?.trigger({
      phase: "step:start",
      runId,
      stepId: step.id,
      data: { agent: step.agent },
    });
    if (startHook?.blocked) {
      st.status = "skipped";
      st.error = startHook.reason;
      st.durationMs = Date.now() - t0;
      emit({ type: "step:skip", stepId: step.id, message: startHook.reason });
      return st;
    }

    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      st.attempts = attempt;
      if (attempt > 1) {
        const backoff = Math.min(1000 * 2 ** (attempt - 2), 8000);
        emit({ type: "step:retry", stepId: step.id, attempt, message: lastError });
        await this.opts.hooks?.trigger({
          phase: "step:retry",
          runId,
          stepId: step.id,
          data: { attempt, error: lastError },
        });
        await sleep(backoff);
      }
      try {
        const output = await this.runOnce(step, ctxForAttempt(attempt), wf, emit);
        st.output = output.text;
        st.status = "success";
        st.inputTokens = output.inputTokens;
        st.outputTokens = output.outputTokens;
        st.costUsd = output.costUsd;
        st.durationMs = Date.now() - t0;
        emit({ type: "step:end", stepId: step.id, status: "success", ms: st.durationMs });
        await this.opts.hooks?.trigger({
          phase: "step:end",
          runId,
          stepId: step.id,
          data: { status: "success", output: st.output, costUsd: st.costUsd },
        });
        return st;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (err instanceof TimeoutError) {
          st.status = "timeout";
          st.error = lastError;
          st.durationMs = Date.now() - t0;
          emit({ type: "step:end", stepId: step.id, status: "timeout", ms: st.durationMs });
          await this.opts.hooks?.trigger({
            phase: "step:end",
            runId,
            stepId: step.id,
            data: { status: "timeout", error: lastError },
          });
          return st;
        }
      }
    }

    st.status = "failed";
    st.error = lastError;
    st.durationMs = Date.now() - t0;
    emit({ type: "step:end", stepId: step.id, status: "failed", ms: st.durationMs });
    await this.opts.hooks?.trigger({
      phase: "step:end",
      runId,
      stepId: step.id,
      data: { status: "failed", error: lastError },
    });
    return st;
  }

  private async runOnce(
    step: StepDef,
    ctx: StepContext,
    wf: WorkflowDef,
    emit: (e: EngineEvent) => void,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> {
    const exec = async (): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number }> => {
      // Rate limiting + circuit breaking wrap every unit of work.
      if (this.opts.limiter) await this.opts.limiter.waitFor(1, 30_000);
      if (this.opts.breaker && !this.opts.breaker.allow()) {
        throw new Error("Circuit breaker is open - provider calls are temporarily blocked");
      }
      if (!step.run && !this.opts.provider) {
        throw new Error(`Step '${step.id}' has no run() and no provider is configured`);
      }
      try {
        if (step.run) {
          const text = await step.run(ctx);
          this.opts.breaker?.recordSuccess();
          return { text, inputTokens: 0, outputTokens: 0, costUsd: 0 };
        }
        const prompt =
          typeof step.prompt === "function" ? step.prompt(ctx) : (step.prompt ?? "");
        const cm = new ContextManager({
          maxTokens: step.maxInputTokens ?? wf.budget?.maxTokens ?? 200_000,
          compactionThreshold: 0.85,
          provider: this.opts.provider,
          model: this.opts.model,
        });
        // Inject the named agent's instructions as the system prompt, if provided.
        const system = step.agent ? this.opts.agents?.[step.agent] : undefined;
        const text = await cm.complete(prompt, system ? { system } : {});
        this.opts.breaker?.recordSuccess();
        const u = cm.usage();
        return { text, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costUsd: u.costUsd };
      } catch (err) {
        this.opts.breaker?.recordFailure();
        throw err;
      }
    };

    if (!step.timeoutMs) return exec();
    return withTimeout(exec(), step.timeoutMs, `Step '${step.id}' timed out after ${step.timeoutMs}ms`);
  }
}

class TimeoutError extends Error {}
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Lifecycle hook system.
 *
 * ECC ships static `hooks.json` files; forge has a real, typed hook runtime.
 * Handlers observe events (run/step/tool/eval/learn) and can even VETO an
 * action (returning `{ block: true }` on a `tool:pre` event) or attach data.
 * The engine, CLI, and eval harness all trigger through this.
 */

export type HookPhase =
  | "run:start" | "run:end"
  | "step:start" | "step:end" | "step:retry" | "step:skip"
  | "tool:pre" | "tool:post"
  | "compact" | "budget:exceeded"
  | "eval:start" | "eval:end"
  | "learn:proposed" | "skill:approved";

export interface HookEvent {
  phase: HookPhase;
  runId?: string;
  stepId?: string;
  tool?: string;
  data?: Record<string, unknown>;
  /** Handlers may attach/merge notes here. */
  meta?: Record<string, unknown>;
}

export interface HookDecision {
  /** Veto the action (meaningful for tool:pre). */
  block?: boolean;
  reason?: string;
  /** Shallow-merged into event.meta. */
  meta?: Record<string, unknown>;
}

export type HookHandler = (event: HookEvent) => void | HookDecision | Promise<void | HookDecision>;

interface Registered {
  name: string;
  phases: HookPhase[];
  priority: number;
  handler: HookHandler;
}

export interface TriggerResult {
  event: HookEvent;
  blocked: boolean;
  reason?: string;
  /** Names of handlers that ran. */
  ran: string[];
}

export class Hooks {
  private readonly hooks: Registered[] = [];

  /** Register a handler for one or more phases. Lower priority runs first. */
  on(phases: HookPhase | HookPhase[], name: string, handler: HookHandler, priority = 0): void {
    const list = Array.isArray(phases) ? phases : [phases];
    this.hooks.push({ name, phases: list, priority, handler });
  }

  off(name: string): void {
    const i = this.hooks.findIndex((h) => h.name === name);
    if (i >= 0) this.hooks.splice(i, 1);
  }

  has(phase: HookPhase): boolean {
    return this.hooks.some((h) => h.phases.includes(phase));
  }

  list(phase?: HookPhase): string[] {
    return this.hooks
      .filter((h) => !phase || h.phases.includes(phase))
      .sort((a, b) => a.priority - b.priority)
      .map((h) => h.name);
  }

  /**
   * Run handlers for an event in priority order. Stops at the first `block`.
   * Returns the (possibly meta-mutated) event and the block decision.
   */
  async trigger(event: HookEvent): Promise<TriggerResult> {
    const matching = this.hooks
      .filter((h) => h.phases.includes(event.phase))
      .sort((a, b) => a.priority - b.priority);
    const ran: string[] = [];
    for (const h of matching) {
      const res = await h.handler(event);
      ran.push(h.name);
      if (res && typeof res === "object") {
        if (res.block) {
          return { event, blocked: true, reason: res.reason ?? `blocked by hook '${h.name}'`, ran };
        }
        if (res.meta) event.meta = { ...(event.meta ?? {}), ...res.meta };
      }
    }
    return { event, blocked: false, ran };
  }
}

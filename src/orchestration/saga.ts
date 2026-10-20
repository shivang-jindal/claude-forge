/**
 * Saga pattern: multi-step operations with compensating transactions.
 *
 * If step N fails, every already-completed step runs its `compensate()`
 * in REVERSE order (undo a payment, delete a half-created record, tear down a
 * worktree). This is real rollback orchestration — a capability ECC's prose
 * workflows don't provide.
 */

export interface SagaStep {
  id: string;
  run: () => Promise<unknown> | unknown;
  /** Undo this step. Called only if a LATER step fails. */
  compensate?: () => Promise<void> | void;
}

export interface SagaResult {
  status: "completed" | "compensated" | "failed";
  completedSteps: string[];
  /** Ids that were compensated, in the order compensation ran (reverse). */
  compensatedSteps: string[];
  failedStep?: string;
  error?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runSaga(steps: SagaStep[]): Promise<SagaResult> {
  const completed: SagaStep[] = [];
  for (const step of steps) {
    try {
      await step.run();
      completed.push(step);
    } catch (err) {
      // Roll back completed work in reverse order.
      const compensated: string[] = [];
      let compErr: string | undefined;
      for (let i = completed.length - 1; i >= 0; i--) {
        const s = completed[i];
        if (s.compensate) {
          try {
            await s.compensate();
            compensated.push(s.id);
          } catch (ce) {
            compErr = compErr ?? `compensation of '${s.id}' failed: ${errMsg(ce)}`;
          }
        }
      }
      return {
        status: "compensated",
        completedSteps: completed.map((s) => s.id),
        compensatedSteps: compensated,
        failedStep: step.id,
        error: compErr ?? errMsg(err),
      };
    }
  }
  return { status: "completed", completedSteps: steps.map((s) => s.id), compensatedSteps: [] };
}

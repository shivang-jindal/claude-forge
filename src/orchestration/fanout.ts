/**
 * Bounded-concurrency fan-out.
 *
 * Maps an array through an async worker with a hard cap on in-flight work,
 * preserving input order in the results and isolating per-item errors.
 * This is the primitive behind "one command, many workers."
 */

export interface FanOutOptions {
  concurrency?: number;
  /** If true, a worker rejection is captured in the result instead of throwing. */
  isolateErrors?: boolean;
  /** Called after each item completes (success or failure). */
  onProgress?: (done: number, total: number) => void;
}

export interface FanOutResult<T, R> {
  index: number;
  item: T;
  ok: boolean;
  value?: R;
  error?: string;
}

export async function fanOut<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: FanOutOptions = {},
): Promise<Array<FanOutResult<T, R>>> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const isolate = opts.isolateErrors ?? true;
  const results: Array<FanOutResult<T, R>> = new Array(items.length);
  let nextIndex = 0;
  let done = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { index: i, item: items[i], ok: true, value };
      } catch (err) {
        if (!isolate) throw err;
        results[i] = {
          index: i,
          item: items[i],
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        done++;
        opts.onProgress?.(done, items.length);
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

/** Convenience: fan out and return only the successful values, in order. */
export async function fanOutValues<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  opts: FanOutOptions = {},
): Promise<R[]> {
  const res = await fanOut(items, worker, opts);
  return res.filter((r) => r.ok).map((r) => r.value as R);
}

/**
 * Rate limiting + circuit breaking — reliability primitives ECC doesn't have.
 *
 * - TokenBucket: classic token-bucket limiter (per-model RPM/TPM shaping).
 * - CircuitBreaker: stops hammering a provider that's down, then probes it
 *   back to health. Both accept an injectable clock so they're testable
 *   without real sleeps.
 */

export type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: () => number;

  constructor(capacity: number, refillPerSec: number, now: () => number = Date.now) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.tokens = capacity;
    this.last = now();
  }

  private refill(): void {
    const n = this.now();
    const elapsed = (n - this.last) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = n;
  }

  available(): number {
    this.refill();
    return this.tokens;
  }

  /** Non-blocking take. Returns false if not enough tokens right now. */
  tryRemove(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Wait until n tokens are available (or timeout). Returns success. */
  async waitFor(n = 1, timeoutMs = 10_000, sleep: SleepFn = realSleep): Promise<boolean> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      if (this.tryRemove(n)) return true;
      await sleep(25);
    }
    return this.tryRemove(n);
  }
}

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private failures = 0;
  private currentState: CircuitState = "closed";
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;

  constructor(failureThreshold = 5, resetMs = 60_000, now: () => number = Date.now) {
    this.failureThreshold = failureThreshold;
    this.resetMs = resetMs;
    this.now = now;
  }

  get state(): CircuitState {
    // Time-based transition open → half-open is checked lazily on access.
    if (this.currentState === "open" && this.now() - this.openedAt >= this.resetMs) {
      this.currentState = "half-open";
    }
    return this.currentState;
  }

  /** May a call proceed right now? */
  allow(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "half-open") return true; // let exactly one trial through
    return false; // open
  }

  recordSuccess(): void {
    this.failures = 0;
    this.currentState = "closed";
  }

  recordFailure(): void {
    this.failures += 1;
    const s = this.state;
    if (s === "half-open") {
      // Trial failed — reopen.
      this.currentState = "open";
      this.openedAt = this.now();
    } else if (this.failures >= this.failureThreshold) {
      this.currentState = "open";
      this.openedAt = this.now();
    }
  }

  snapshot(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}

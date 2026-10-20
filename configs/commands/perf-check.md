---
description: Find real performance bottlenecks using measurement, and report the impact of each proposed change.
---

# /perf-check

Performance work without measurement is guesswork. Measure first, every time.

1. **Define the target** — which operation, at what volume, under what
   constraint (latency p95, throughput, memory, cost).
2. **Measure the baseline** with a profiler, a benchmark, or the query plan.
   Record the numbers. Without a baseline there is no "improvement".
3. **Find the dominant cost** — CPU, allocation, I/O wait, lock contention, or
   round-trips. Optimise that one thing.
4. **Change it, re-measure, compare.** Report the delta and the method.
5. **Check the trade-offs** — did memory grow? did complexity get worse? did
   readability suffer for a 2% gain?
6. **Report**: the baseline, the change, the after-number, and whether the
   target was met.

**Common real wins**: N+1 queries, work repeated in a loop, unbounded caches,
serial awaits that could be concurrent, oversized payloads, missing indexes,
locks held across I/O.

**Never** report an improvement you did not measure. If the code is fast
enough for its actual load, say that — that is a useful result.

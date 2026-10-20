---
name: performance
description: Mandatory performance rules — no unbounded work, no N+1 access patterns, measure before optimising.
---

# Performance Rules

- **No query in a loop.** Fetch once, iterate in memory. Use `select_related` /
  `prefetch_related` / a join.
- **No unbounded reads.** Every list endpoint paginates; every file read has a
  size limit; every external response has a timeout.
- **No unbounded memory.** Caches have a size cap and a TTL. Streaming
  collections are processed in batches, not materialised.
- **Indexes on every filter, join, and sort column.** Verify with the query
  plan, not by assuming.
- **Complexity over constants.** O(n²) over O(n) is a bug even when n is
  currently small.
- **Measure before optimising.** No change ships as a "performance
  improvement" without a before/after measurement.
- **No blocking work on the request path** that could be queued, cached, or
  done ahead of time.
- **No synchronous I/O in a hot loop.** Batch it, or move it off the path.
- **Reuse buffers and connections** in hot paths; do not allocate per
  iteration when the size is known.
- **Every background job is idempotent and retry-safe**, because it will be
  retried.

---
name: database
description: Mandatory database rules — safe migrations, indexed access, and no queries in loops.
---

# Database Rules

- **Schema changes are expand/migrate/contract**, deployed in separate steps,
  so old and new application versions can run simultaneously.
- **Destructive changes never share a deploy** with the code change that stops
  using the old column. The old code must keep working.
- **Every migration has a tested `down` path**, or a documented reason it
  cannot be reversed.
- **Backfills run in batches**, outside the request path, idempotent and
  resumable.
- **Every foreign key states `on_delete` explicitly.** `CASCADE` is a
  deliberate decision, not a default.
- **Every filtered, joined, or sorted column is indexed.** Confirm with the
  query plan.
- **No query inside a loop.** One query, then iterate in memory.
- **All SQL is parameterised.** Never built by string concatenation, even with
  an allowlist of column names.
- **Transactions wrap multi-write operations.** `select_for_update` when two
  workers can touch the same row.
- **Writes are idempotent where retries are possible.** Use upserts and
  natural unique keys, not autoincrement ordering.
- **Timezone-aware datetimes everywhere**; no naive local time.
- **Connection pools are sized deliberately** and match the concurrency the
  application actually has.

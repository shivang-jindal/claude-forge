---
name: database-migrations
description: Safe schema change playbook — zero-downtime deploys, expand/contract, backfills, and rollback plans.
---

# Database Migrations

A schema change is a **multi-deploy operation**, not a single statement. The
code and the schema must be compatible at every point in between, because old
and new application instances run simultaneously.

**Expand → Migrate → Contract**
1. **Expand** — add the new column/table/index in a backward-compatible way.
   Nullable column, or with a server default. Old code still works.
2. **Migrate** — deploy code that writes to the new shape and reads from
   whichever shape is present. Backfill existing rows in batches.
3. **Contract** — once the new column is fully populated and no old instance
   remains, enforce the constraint and remove the old shape.

Each phase is a separate deploy. Do not squash them.

**Rules**
- Every migration has a tested `down` path, or an explicit documented reason it
  cannot be reversed.
- A destructive change (drop/rename/narrow) never ships in the same deploy as
  the code change that stops using the old column.
- Adding a `NOT NULL` column to a large table requires a default or a
  staged `CHECK ... NOT VALID` → `VALIDATE CONSTRAINT`.
- Index creation on a large table uses `CREATE INDEX CONCURRENTLY` (Postgres) or
  the online equivalent; a plain `CREATE INDEX` takes a write lock.
- Foreign keys are added `NOT VALID` first, then validated, on large tables.
- Column renames are add → backfill → dual-write → drop, never a bare rename.

**Backfills**
- Run in batches (1k–10k rows) with a pause, so locks and replication lag stay
  bounded.
- Backfills are idempotent and resumable, and record progress.
- Backfills run outside the request path — a migration job, not a deploy step.
- Watch replication lag and lock waits while it runs.

**Rollback**
- Decide the rollback plan *before* the deploy, and write it down.
- Rolling back the code must be possible without rolling back the schema. That
  is exactly why the contract phase is separate.
- Destructive changes are irreversible. Say so out loud before running one.

**Pre-flight**
- [ ] Estimated table size and lock impact known.
- [ ] `down` path exists and was tested on a copy of production-shaped data.
- [ ] Backfill is batched, resumable, and monitored.
- [ ] Code is compatible with both the old and new schema.
- [ ] A rollback was run at least once in staging.

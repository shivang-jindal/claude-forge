---
name: django-patterns
description: Django patterns for models, ORM efficiency, migrations, testing, and deployment hygiene.
---

# Django Patterns

**Models**
- `on_delete=models.CASCADE` is explicit on every `ForeignKey`. `PROTECT` when
  deletion should be blocked, `SET_NULL` only for genuinely optional links.
- `related_name` on every FK to avoid reverse-relation name collisions.
- `db_index=True` on fields you filter, join, or sort by. `Meta.indexes` for
  composite indexes.
- `TextChoices` / `IntegerChoices` for enums — never bare strings for state.
- `models.JSONField` for genuinely schemaless data, not as a dumping ground.
- `UUIDField` as the primary key for anything user-facing or multi-tenant.

**Migrations**
- Every model change ships a migration. Review the generated file.
- Additive-first rollout: add nullable → deploy → backfill → make required.
  Destructive changes are a separate, later deploy.
- `RunPython` data migrations are reversible or explicitly marked `migrations.RunPython.noop`.
- Never edit an applied migration; write a new one.
- `makemigrations --check` in CI to catch model/migration drift.

**ORM efficiency**
- Never query inside a loop. `select_related` for FK/OneToOne, `prefetch_related`
  for reverse FK/M2M.
- `only()` / `defer()` for wide models.
- `.exists()` for booleans, `.iterator()` for large exports.
- `bulk_create` / `bulk_update` / `bulk` operations over per-row saves.
- Aggregate in the database (`annotate` + `Count`) rather than in Python.
- `Q` objects for OR; `F()` expressions for relative updates.

**Views & layers**
- Thin views. Business logic goes in a service module or a model method.
- Class-based views used consistently across a module.
- DRF serializers own validation; views never trust `request.data`.
- Permissions via `permission_classes` or decorators, not convention.

**Correctness**
- `transaction.atomic()` for multi-write operations.
- `select_for_update()` when concurrent workers can touch the same row.
- `USE_TZ = True`; always `timezone.now()`, never `datetime.now()`.
- `settings.py` reads from the environment; no secrets in the repo.

**Testing**
- `pytest-django` with `db` fixture; `django_assert_num_queries` to catch N+1.
- `TestCase` for DB-touching tests (transactional rollback), `SimpleTestCase`
  for pure logic.
- Factories (`factory_boy`) over hand-built fixtures.
- `reverse()` over hardcoded URLs so route changes break one place.

---
name: python-patterns
description: Modern Python patterns — typing, dataclasses/pydantic v2, async, error handling, pytest, performance, and packaging. Use when writing or refactoring Python.
---

# Python Patterns

Expert patterns for modern, type-safe Python (3.10+ unless noted).

## Data modeling
- `@dataclass(frozen=True, slots=True)` for immutable value objects.
- Pydantic **v2** at the boundary: `model_validate`, `model_dump`, `field_validator` — never `.dict()`/`.parse_obj()`.
- `Protocol` for structural typing; `@overload` for multi-shape returns.

## Error handling
- Custom exception hierarchy rooted at one base; `raise NewErr(...) from err`.
- Never bare `except:`; catch `Exception` or a specific type.
- Resources always via `with` / context managers.

## Async
- Never block the loop — offload sync work with `asyncio.to_thread`.
- Always `await` coroutines; a missing `await` is a silent no-op.
- `asyncio.TaskGroup` (3.11+) / structured concurrency; bound fan-out with a `Semaphore`.

## Performance
- Membership on `set`/`dict`, not `list`; generators over big intermediate lists.
- `__slots__` on hot-path classes; hoist invariant lookups out of loops.
- Vectorized pandas (`.loc`, built-ins), never `iterrows()`.

## Testing (pytest)
- Fixtures + `tmp_path` + `monkeypatch` + `parametrize`; happy + edge + error paths.
- No order-dependent tests; no `time.sleep` sync.

## Tooling (`pyproject.toml`)
- ruff + mypy strict; pin dependencies; single source of truth.

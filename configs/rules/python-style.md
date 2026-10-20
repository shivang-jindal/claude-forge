---
name: python-style
description: Always-follow Python style and safety guidelines (3.10+, mypy strict, ruff).
---

# Python Style Rules

- Fully type every public function/method; avoid `Any` in public signatures.
- `@dataclass(frozen=True, slots=True)` for value objects; Pydantic v2 at boundaries.
- No mutable default args (`def f(x, bucket=None)`); compare with `==`, narrow with `isinstance`.
- Never block the event loop; `await` every coroutine; offload sync work with `asyncio.to_thread`.
- Open files/locks/connections with `with`; use `logging` with lazy `%s`, not f-strings or `print`.
- `snake_case` functions/vars, `PascalCase` classes, `UPPER_SNAKE` constants; named constants over magic numbers.
- Run `ruff` and `mypy` before finishing; don't leave lint/type errors behind.

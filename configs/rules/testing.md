---
name: testing
description: Testing requirements — coverage, quality, and isolation.
---

# Testing Rules

- New behavior ships with tests: happy path + ≥1 edge + ≥1 error case.
- Tests assert behavior, not implementation details.
- No order-dependent tests; no shared mutable state between tests.
- Use fixtures / `tmp_path` / `monkeypatch`; no `time.sleep` for sync.
- Respect the coverage floor (default 80%) and keep the suite fast.

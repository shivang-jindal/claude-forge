---
name: e2e
description: Mandatory end-to-end testing rules — reliability, isolation, and no hidden flakiness.
---

# E2E Testing Rules

- **No fixed sleeps.** Wait for a condition. A test that sleeps is a test that
  will be flaky on a slow machine and slow on a fast one.
- **Every test is independent.** It passes alone, in any order, and in
  parallel. No shared mutable state, no ordering dependency.
- **Test data is unique per run** (uuid, timestamp, or a seeded counter that
  cannot collide) and is cleaned up afterwards.
- **Assert on user-visible outcomes**, not on internal implementation details,
  so refactors do not break the suite for no reason.
- **Retries only for documented eventual consistency**, never as a blanket
  flake-hider. A retried test that passes is still a broken test.
- **Set up through the API, assert through the UI** — only the behaviour under
  test goes through the browser.
- **Every failure has one clear reason.** "expected true, got false" is a
  failed test design, not a failed product.
- **E2E covers journeys, not permutations.** Business-rule combinations are
  unit tests.
- **The suite is green twice in a row before it is called done**, and any known
  flake is documented with the exact condition it depends on.

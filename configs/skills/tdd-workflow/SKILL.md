---
name: tdd-workflow
description: Test-driven development loop — red, green, refactor. Use when implementing a well-specified behavior.
---

# TDD Workflow

1. **Specify** — write the interface/behavior down as a failing test (RED).
2. **Run** — confirm it fails for the right reason.
3. **Implement minimally** — make it pass with the simplest code (GREEN). No extra generality.
4. **Refactor** — improve structure with the tests green; run them after every change.
5. **Repeat** — next small behavior.

Rules:
- A test must fail before you write the implementation.
- Never write production code to make a failing test pass without a test that would catch its absence.
- Keep each cycle small enough to finish in minutes.
- Stop and refactor when duplication appears, not before.

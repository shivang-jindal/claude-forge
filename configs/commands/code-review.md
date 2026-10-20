---
description: Review the current changes for correctness, security, and maintainability.
---

# /code-review

Review uncommitted changes (git diff) and report issues by severity.

For each issue: `[SEVERITY] title`, `file:line`, one-sentence risk, concrete fix.
Bands: CRITICAL (must fix) · HIGH (should fix) · MEDIUM (consider) · LOW (nit).

Cover: correctness, security (secrets, injection, unsafe deserialization),
error handling, performance, and tests. Finish with approve / warn / block.

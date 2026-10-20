---
name: git-workflow
description: Commit and branch conventions.
---

# Git Workflow Rules

- Small, focused commits; imperative subject: `Add X`, `Fix Y`, not `Added`.
- Reference an issue/ID when one exists; explain *why* in the body if non-obvious.
- Never commit secrets, `.env`, or generated artifacts.
- Branch per feature/fix; keep branches short-lived and mergeable.
- Run the test suite before opening a PR; describe what changed, why, and how it was tested.

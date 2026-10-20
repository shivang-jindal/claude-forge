---
description: Save the current run state so an interrupted workflow can be resumed instead of restarted.
---

# /checkpoint

Capture a resumable snapshot of work in progress.

1. **Identify the unit of work** — a workflow run, a migration, a long
   refactor. State what "done" means for it.
2. **Record what is complete**, with the exact identifiers needed to continue:
   file paths, applied migration names, created resources, passing test names.
   Not "most of it is done" — the actual list.
3. **Record what remains**, in the order it must be done, and what is blocked.
4. **Store it** where the next session will look for it (`.forge/checkpoints/`
   for workflow runs; the repo's own convention otherwise).
5. **Verify it resumes**: re-open the checkpoint and confirm each recorded item
   is present and each remaining step is unambiguous.

**Rules**
- A checkpoint is written *after* verifying the completed items, not before.
- Record the last command that passed, so the next session does not re-derive it.
- Never record a step as complete that was not actually verified.
- Keep it short. A checkpoint nobody reads is a note in the void.

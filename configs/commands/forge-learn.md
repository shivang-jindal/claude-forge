---
description: Learn reusable patterns from a session log and turn them into skill proposals.
---

# /forge-learn

Mine a session log for repeated behavior worth encoding as a skill.

```
node src/cli.ts learn examples/session-log.jsonl
node src/cli.ts skill list
node src/cli.ts skill approve <id>
```

The loop extracts repeated corrections, self-corrections, lint fix-loops, and
ritual commands, then proposes versioned skills. **Nothing is auto-installed** —
you approve (or reject) each proposal. Rejections are remembered.

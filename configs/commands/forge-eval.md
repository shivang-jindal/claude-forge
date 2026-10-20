---
description: Run an eval over a dataset and report pass@1 / pass@k with regressions.
---

# /forge-eval

Score an agent over a dataset using the eval harness.

```
node src/cli.ts eval evals/feature.dataset.json --agent python-reviewer --trials 3 --graders contains
```

Interpretation:
- **pass@1** — single-shot reliability users actually feel.
- **pass@k** — the ceiling across k trials.
- A **REGRESSION** line means pass@1 dropped more than the threshold vs the last
  stored run for the same agent+dataset. Investigate before merging.

Add `--provider anthropic` (with `ANTHROPIC_API_KEY`) to grade real model output.

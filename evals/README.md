# Eval datasets

These datasets exercise the **eval harness** against the deterministic `mock`
provider. They are **not** a benchmark of model intelligence — a real model
run against `mock` would be pointless. Their job is to prove the wiring is
correct: the harness loads the dataset, fans out over cases, runs the grader,
and computes pass@1 / pass@k.

Point `--provider anthropic|openai|ollama` at a real model with your own
dataset to evaluate real behaviour.

| File | Grader | What it proves |
|---|---|---|
| `feature.dataset.json` | `contains` | The default path: load → fan out → grade → score. |
| `arithmetic-exact.dataset.json` | `exact` | Strict full-string grading (not just "contains"). The mock computes real sums, so a wrong sum fails. |
| `quality.dataset.json` | `similarity` | The Levenshtein/`similarity` grader with its default 0.8 threshold. |

**Adding your own**: a dataset is a JSON array of
`{ id, input, expected }`. `id` must be unique, `input` is what the agent sees,
`expected` is what the grader compares against.

```bash
node src/cli.ts eval my-dataset.json --trials 5 --graders contains
```

See `configs/skills/eval-design/SKILL.md` for how to design a dataset that
actually measures what you care about.

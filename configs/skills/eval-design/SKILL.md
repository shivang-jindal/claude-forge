---
name: eval-design
description: How to design effective evals — datasets, grader selection, pass@k, and regression gates. Use when building or improving an eval suite.
---

# Eval Design

Turn "does it work?" into a number you can track.

## Dataset
- One case per behavior; keep `id` stable so trends are comparable.
- Include happy path, edge cases, and at least one should-fail case.
- Store as JSON: `[{ "id", "input", "expected", "meta"? }]`.

## Grader choice (pick the weakest grader that's still reliable)
- `exact` — output must match exactly (deterministic transforms).
- `contains` — output must include a key token (most common).
- `regex` — structured output (codes, formats).
- `test-command` — run a real test/assertion; exit code decides (strongest).
- `llm-judge` — fuzzy/qualitative against a rubric (use last).

## Trials & pass@k
- Run k>1 trials when output is stochastic; report pass@1 and pass@k.
- pass@1 tells you the single-shot reliability users feel; pass@k the ceiling.

## Gates
- Store each result; compare to the last green baseline.
- Flag a regression when pass@1 drops more than ~0.05.
- Use `checkpoint` mode as a cheap PR gate; `continuous` to watch over time.

## Anti-patterns
- Graders that pass on empty output; tests that assert on wording instead of behavior;
  datasets that change shape every run (breaks trend lines).

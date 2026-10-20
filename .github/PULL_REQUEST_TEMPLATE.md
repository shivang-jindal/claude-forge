## What this changes

<!-- One or two sentences. Link the issue it closes: Closes #123 -->

## Why

<!-- The problem this solves. Skip if it is obvious. -->

## How it was tested

<!-- Not "it works" — the actual commands and their results.

     node --test tests/*.test.ts   → 98 passed, 0 failed
     node src/cli.ts ci            → PASSED
-->

- [ ] `node --test tests/*.test.ts` passes
- [ ] `node src/cli.ts ci` passes
- [ ] New behaviour has a test that fails without this change
- [ ] No runtime dependency was added
- [ ] Native TypeScript only — erasable syntax, `.ts` import extensions
- [ ] `README.md` updated if the public API changed
- [ ] `CHANGELOG.md` updated under `[Unreleased]`

## Notes for the reviewer

<!-- Anything that needs extra attention: trade-offs, edge cases, things you
     deliberately did NOT do. -->

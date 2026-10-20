---
name: verification-loop
description: A disciplined loop that proves work is actually done — tests, type checks, linters, and a self-check before claiming completion.
---

# Verification Loop

Never report a task as complete until you have *run* the check. Saying "this
should work" is not verification; running the command and reading the output is.

**The loop**

1. **State the claim.** "The new endpoint returns 201 with a body." Write what
   must be true.
2. **Find the check that proves it.** A test, a type check, a linter, a
   command, a query. If no check exists, write one first.
3. **Run it.** The whole suite, not just the file you touched.
4. **Read the output.** A green-looking summary is not a green build; check the
   counts and look for skips.
5. **Fix and repeat** until the check passes.
6. **Report the evidence**, not the intention: quote the passing command and
   its result.

**Order of checks (cheapest first)**
1. Does it compile / type-check?
2. Do the unit tests for the touched module pass?
3. Do the lint and format checks pass?
4. Do the integration tests pass?
5. Does the full suite pass?
6. Does the feature work when actually used?

**Rules**
- A skipped test is not a passing test. Report skips.
- Do not weaken a check to make it pass. If a test is wrong, fix the test and
  explain why in the same breath.
- Do not delete a failing test. Fix the cause.
- If a check cannot be run in this environment, say so explicitly instead of
  implying it passed.
- Re-run the full suite after any fix, because one fix can break another test.

**Closing checklist**
- [ ] The change does what the task asked, verified by running it.
- [ ] New behaviour has a test that fails without the change.
- [ ] The full suite passes, with no new skips.
- [ ] Errors, edge cases, and failure modes are handled.
- [ ] The report states what was run, what passed, and what remains unverified.

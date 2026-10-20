---
description: Diagnose and fix a broken build or failing CI pipeline.
---

# /build-fix

Get the build green again, for the right reason.

1. **Read the first error**, not the last. Everything after the first failure
   is usually a cascade.
2. **Reproduce locally** with the exact CI command. If you cannot reproduce,
   say so and work from the CI log only.
3. **State the root cause** in one sentence, with the exact error line as
   evidence. "The test failed" is not a root cause.
4. **Fix minimally.** Change the cause, not the symptom.
5. **Re-run the full build** and the full test suite. Not just the failing file.
6. **Report**: root cause, evidence, the fix, and the command plus its output.

**Never** delete or skip a test, lower a threshold, remove a type check, or pin
a dependency to an old version just to get green. If the fix has to be one of
those, the problem is not understood yet — say so.

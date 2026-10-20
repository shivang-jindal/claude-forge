---
description: Drive a change test-first — write the failing test, make it pass, then refactor.
---

# /tdd

Implement a behaviour with the red-green-refactor loop.

1. **Name the behaviour** in one sentence, as an observable outcome.
2. **Write the test first.** It must fail, and it must fail for the right
   reason — not because of a typo or a missing import.
3. **Run it and read the failure.** Confirm it fails because the behaviour is
   missing. A test that fails for the wrong reason is worse than no test.
4. **Implement the minimum** that makes it pass. No extra parameters, no
   speculative generality, no "while I'm here" changes.
5. **Run the test.** Green.
6. **Refactor** with the test green, re-running after every change.
7. **Run the whole suite** before you stop. The focused test passing is not
   evidence that nothing else broke.

**Report**: the behaviour, the test that proves it, the command you ran, and
its result.

**Never**: write production code first and back-fill the test afterwards; delete
or skip a failing test; change a test to match a wrong implementation.

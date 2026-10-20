---
description: Prove the current work is actually done — run the real checks and report the evidence.
---

# /verify

Verification means running the check and reading the output. It does not mean
reasoning about why it would pass.

1. **List the claims** the change needs to satisfy, one line each.
2. **Map each claim to a check**: a test, a type check, a linter, a command, a
   request against the running app.
3. **Run them** — cheapest first (compile → unit → lint → integration → full
   suite → real usage).
4. **Read the output.** Check the counts. Look for skips, warnings, and
   "0 tests" — a green run that tested nothing is not a pass.
5. **Report as evidence**, not intention:
   - `npm test → 214 passed, 0 failed, 0 skipped`
   - `npm run typecheck → 0 errors`
   - `curl -s localhost:3000/health → 200 {"ok":true}`

**Never** report a step as verified without a command and its result. If a
check could not be run here (no credentials, no service), say exactly that
instead of implying it passed.

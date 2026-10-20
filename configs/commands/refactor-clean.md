---
description: Clean up a messy module without changing behaviour — dead code, duplication, and misleading names.
---

# /refactor-clean

Restructure code while provably preserving behaviour.

1. **Establish the safety net.** The tests must pass *before* you start. If
   they don't, fix that first — otherwise you cannot tell your breakage from
   pre-existing breakage.
2. **Inventory.** List the dead code, the duplicated blocks, the misleading
   names, and the functions doing too much. Prioritise deletions.
3. **Delete** dead code (verify with a repo-wide search, not by reading).
4. **Rename** for accuracy. Do it in a separate commit from structural change.
5. **Extract** duplication only where the blocks are the same *concept* — not
   merely similar-looking code.
6. **Split** long functions along their actual responsibilities.
7. **Re-run the tests after every step.** A green suite is the only proof that
   behaviour is preserved.
8. **Report** each change, why it is safe, and the evidence (search counts,
   call sites, passing tests).

**Never** change behaviour in a refactor. If you find a bug, report it
separately instead of folding it in.

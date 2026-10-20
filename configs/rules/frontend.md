---
name: frontend
description: Mandatory frontend rules — accessible semantics, sane state ownership, and honest loading states.
---

# Frontend Rules

- **Semantic elements first.** `button`, `a`, `label`, `nav`, `main`, `ul`.
  A `div` with an `onClick` is a bug, not a shortcut.
- **Every input has a label**, and validation errors are associated with their
  field (`aria-describedby`) and announced.
- **Keyboard operable and visible focus.** Never `outline: none` without a
  visible replacement.
- **Colour is never the only signal.** Contrast at least 4.5:1 for body text.
- **Server data lives in a cache**, not in component state. Define stale-time
  and refetch behaviour deliberately.
- **Derive state; do not duplicate it.** Two sources of truth will disagree.
- **Every async surface has loading, error, and empty states.** A spinner
  alone is not a state machine.
- **Server state is not written to by hand** — mutations go through the cache
  so the UI and the data cannot drift.
- **Effects are for synchronising with the outside world**, not for deriving
  values.
- **Lists are keyed by stable id**, never by array index.
- **Images have dimensions and `alt` text**; below-the-fold media is lazy.
- **Long lists are virtualised**; the DOM does not hold thousands of nodes.
- **Errors show a message and a way forward**, never a blank screen.

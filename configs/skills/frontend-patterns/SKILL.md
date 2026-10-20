---
name: frontend-patterns
description: Frontend patterns for React and friends — state, data fetching, rendering performance, accessibility, and component boundaries.
---

# Frontend Patterns

**Component boundaries**
- A component renders; it does not fetch, transform, and render. Extract hooks
  for data and pure functions for transformation.
- Keep components small enough to read without scrolling. If a file is 800
  lines, the boundary is in the wrong place.
- Colocate a component with its styles, tests, and story.

**State**
- Server state and UI state are different things. Server data belongs to a
  cache (TanStack Query, SWR, RTK Query) with stale-time and refetch rules —
  not to `useState` in a component.
- Lift state only as high as the closest common consumer. Context is not a
  state manager; a value that changes often does not belong in context.
- Derive, don't duplicate. If a value can be computed from other state, compute
  it — two sources of truth will disagree.
- `useReducer` when state transitions are complex or interdependent.

**Data fetching**
- Every request has loading, error, and empty states. A spinner is not a
  state machine.
- Cancellation on unmount, and a guard against setting state after unmount.
- Mutations invalidate the relevant cache keys; optimistic updates are rolled
  back on failure.
- Pagination and infinite scroll handled deliberately, not by accident.

**Rendering performance**
- `useMemo` / `useCallback` only when the referential identity actually
  matters (a memoised child, a dependency array). They are not free.
- `React.memo` for components that re-render often with stable props.
- Virtualise long lists (1000+ rows), do not render them all.
- Avoid layout thrash: batch reads, then writes.
- Images sized for their display box, lazy-loaded below the fold, with
  `alt` text.

**Accessibility**
- Semantic elements first: `button`, `a`, `label`, `nav`, `main`. `div` with a
  click handler is a bug waiting to happen.
- Every input has a `<label>`; errors are associated via `aria-describedby`.
- Visible focus; never `outline: none` without a replacement.
- Keyboard reachable and operable; modals trap focus and close on Escape.
- Colour contrast at least 4.5:1, and colour is never the only signal.

**Error handling**
- Error boundaries around route/section boundaries, not around every leaf.
- Errors show a useful message and a way forward, never a blank screen.
- `Suspense` fallback that matches the final layout to avoid a jump.

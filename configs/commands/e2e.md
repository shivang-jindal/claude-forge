---
description: Design and run reliable end-to-end tests for the critical user journeys.
---

# /e2e

Build or repair an end-to-end suite for the critical journeys.

1. **Pick the journeys.** List the 3–5 flows that would hurt most if broken
   (signup, checkout, the core loop). Everything else belongs in unit tests.
2. **Map each journey to its steps** and mark which need the UI and which can
   be set up through the API. Set up through the API; only the behaviour under
   test goes through the UI.
3. **Define the fixtures.** Each test creates its own data, uniquely named per
   run, and cleans it up. No shared state, no ordering dependencies.
4. **Write the assertions** on user-visible outcomes. One clear failure reason
   per assertion.
5. **Replace every fixed sleep** with a condition wait (element visible, API
   response received, state observed).
6. **Run the suite twice in a row and in parallel.** A suite that only passes
   once is flaky, and flaky suites get ignored.
7. **Report** the journeys covered, the runtime, and any known flake with the
   specific condition it depends on.

**Never** add a blanket retry to hide flakiness — find the race instead.

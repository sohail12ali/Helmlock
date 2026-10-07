# /verify: explore scope (bug bash)

Unscripted exploration of a deployed change on a test environment: several short charters, each poking one area from one angle; only findings that reproduce become bugs. Use after the slice is deployed for testing and before sign-off, or when a screen "feels wrong" and no test says why.

## Prepare

- The deployed build matches the branch (stale output, SKILL.md). Base URL and login come from the person; never ask for a secret in chat.
- **Shared environments are read-only** except for test data you create yourself. Never edit or cancel data you did not create.
- One data set per charter, so one charter's changes do not show up as another's bug.
- Read the spec's ACs and `git diff --stat` of the branch to aim the charters.

## Charters

Write 5 to 10, each one sentence: **one area · one angle · start page**. Angles:

| Angle | Pokes at |
|-------|----------|
| First-time user | Labels, empty states, no prior setup |
| Numbers and copy | Totals, counts, dates and time zones agree across screens |
| Edge input | Empty, very long, leading spaces, unicode, quotes and percent signs, negative and zero |
| State | Reload, back button, two tabs on the same record, session timeout mid-form |
| Error paths | Declined payment, missing item, missing address, double click on submit |

Note each oddity with what you expected, what you saw, the steps and a screenshot.

## Triage before calling anything a bug

Place each note in one bucket: **explorer mistake** (a missed click, lazy-loaded content) · **environment** (a job not run, missing config) · **by design** (the spec or code says it is intended) · **test data** (the record lacks a field) · **candidate**.

A candidate is a **bug only when it reproduces a second time** from its written steps in a fresh session. Then `hl bug add {T} "..." --severity {level}` and a `TC-E-*` row in the test cases. Did not reproduce: reject it with the reason.

## Report

Confirmed bugs (id, steps, screenshot) · unconfirmed risks worth a look · rejected notes, grouped by bucket · areas no charter reached.

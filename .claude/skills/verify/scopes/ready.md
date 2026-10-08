# /verify: ready scope

Pre-release audit before merge: run unit, integration, e2e (if UI is in scope) and review, then a dedicated security and performance pass using [review.md](review.md) (Security and Performance) across the whole ticket diff, not just the last slice.

Ready only when all of these hold:
- Every acceptance criterion traced to a passing test case or a reviewed code path; P0 cases pass.
- Review verdict Pass.
- All blockers resolved; none waived to get green (`hl blockers {T}` exits 0).
- Migrations repeatable where possible, with rollback notes for anything destructive.
- The build is clean in every touched project (its own build skill).

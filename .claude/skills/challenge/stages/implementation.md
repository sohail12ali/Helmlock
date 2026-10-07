# Stage: implementation

`/challenge {T} implementation [slice]` (slice = `S1`, `S2`...). Run after a slice is built, before `/verify {T} review`. Run again after a significant `/fix` on the same slice.

## Inputs

- The slice (the whole ticket when no slice is given): its row in `{T}-plan.md` Slices plus Design, and its tasks from `hl ticket show {T} --json`.
- `{T}-spec.md`: the `AC-n` and `BR-n` the slice covers.
- `test-cases/{T}-test-cases.md`, if present.
- The code scope, in the owning project repo: the branch diff against the project's base (`git diff {base}...HEAD --name-only`, base from the project's `CLAUDE.md`).

## Steps

1. Walk the five lenses (rules.md, Implementation column) over the changed files, then the implementation kinds (`plan-drift` to `over-built`). Layer checks follow the owning project's own rules. Record each finding (rules.md, Recording findings).
2. Confirmed defects: `hl bug add {T} "..." --severity {level}`.
3. Focus on intent versus reality and plan traceability; do not repeat the `/verify {T} review` checklist. Executable checks and merge sign-off stay with `/verify`.

## Acceptance criteria (plus the shared ones in rules.md)

- Changed files in scope read (or an explicit skip with the reason).
- Every finding traced to a task (`S1-T2`), an `AC-n` or a `BR-n`.
- No code edits: findings only.
- `security-risk` findings flagged for the `/verify` review.

Next: `/verify {T} review` · `/fix {T}` · `/fix {T} --revise`.

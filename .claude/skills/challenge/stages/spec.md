# Stage: spec

One pre-freeze pass over `{T}-spec.md`: gap analysis, overlap with existing features, red-team and (size L) a pre-mortem. Run on M and L tickets after `/spec {T} draft`; run again after a `/spec {T} refine` that changes rules or scope. `/spec {T} freeze` will not pass while `hl blockers {T}` reports anything open. S tickets skip this stage.

Inputs: `{T}-spec.md` (all sections, especially Summary, Scope and non-goals, Business rules, Acceptance criteria, Data touched), the open records (`hl context {T} --json`), the size, plus the codebase and prior tickets (`hl search`).

## A. Gaps

One gap record per missing piece; skip gaps already open. Walk each category:

- **stakeholders:** roles in the code or data the spec does not mention; affected users missing from Problem and users.
- **rules:** quantities, thresholds, ordering, state transitions implied by ACs but not stated as `BR-n`.
- **edge-cases:** concurrency, network or partial failure, idempotency, empty or over-limit input; compare with similar features and past investigations.
- **non-functional:** performance, security, audit, accessibility stated without a number or a role.
- **data:** lifecycle (create, update, archive) unspecified, `UNVERIFIED` rows in Data touched.
- **integrations:** external systems the code touches that the spec does not address.
- **ux:** error messages, offline or flaky network, accessibility.
- **compliance:** retention, personal data scope, regulatory logging.
- **cross-cutting:** feature flags, backfill, rollback.

Every gap carries a direction (fill, defer, or convert to a question):

```
hl gap add {T} "{missing piece}; direction: {fill|defer|question}" --category {category}
hl question add {T} "{question}" --blocking     # for every gap that blocks the freeze
```

## B. Overlap with existing features

For each BR, compare against similar entry points in the owning projects, existing components that write the same data, and prior specs in the area (`hl search`).

Classify each interaction: **overlap** (an existing feature already does some of it: reuse or extend) · **conflict** (breaks a contract an existing feature relies on: schema, role, state machine) · **reuse** (a component usable as it is) · **isolation** (shared terms, distinct flows: state the boundary).

- Each **conflict**: a blocking question **and** a gap with `--category cross-cutting`.
- Each **overlap** or **reuse**: a minor gap `--category critique-spec` naming the existing component, so `/spec {T} refine` can add it to Data touched or Sources.
- No overlap at all: say so in the report.

## C. Red-team

Walk the five lenses (rules.md, Spec column), then every spec section against the spec kinds (rules.md) and the AC smells in `.claude/skills/spec/techniques.md`. Zero findings is allowed, but every section is considered. Append each finding at the end of the section it concerns:

```text
⚠ [{kind}] {section or BR-n/AC-n}: {one-sentence issue}, resolution: open
```

Record each marker as a finding (rules.md, Recording findings); markers and records match one to one. Do not propose rewrites.

## D. Pre-mortem (size L only)

"It is three months after release and this ticket failed: why?" List 3 to 5 concrete failure stories (wrong data, a broken flow, an integration down, a rollback impossible). Each plausible story not covered by a BR, AC or non-goal becomes a finding of kind `pre-mortem` (critical or major).

## Acceptance criteria (plus the shared ones in rules.md)

- Every blocking gap has a blocking question.
- The `hl blockers {T}` result is reported (it must exit 0 before freeze).
- Every conflict yields a blocking question and a gap.
- Every `⚠` line has a kind and a pointer; markers and records match one to one.
- Only `⚠` lines added to the spec: rule, AC and scope text untouched.
- Size L: the pre-mortem ran.

Next: `/shape {T}` for open questions, then `/spec {T} refine`.

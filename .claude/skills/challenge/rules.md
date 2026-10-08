# Challenge: shared critique rules

Stated once for every `/challenge` stage; stage files carry only their own steps.

## Core principle

**Find, don't fix.** Never silently rewrite the artifacts under critique. Findings go only to records (and to `⚠` markers in the spec). Repair is a separate role:

| Stage | Repair commands |
|-------|-----------------|
| Spec | `/shape {T}`, `/spec {T} refine` |
| Plan | `/plan {T} {mode}`, `/fix {T} --revise`, the planner |
| Implementation | `/fix {T}` (fixable), `/fix {T} --revise` (blocker) |

## Review lenses

Every pass, at every stage, reviews through all five lenses, one at a time, in this order, so no lens is skipped because an earlier one found plenty. Each lens ends with findings or an explicit `{lens}: clear, checked {what}`. Prefix each finding with its lens: `[security] ...`.

| Lens | Spec: ask | Plan: ask | Implementation: ask |
|------|-----------|-----------|---------------------|
| **security** | Which roles may do this, and is a wrong role rejected by a rule? Personal or payment data in scope? Audit trail needed? | Auth on every new endpoint or command? Secrets only in config (names, never values)? Least-privilege data access? Audit fields in the schema? | String-built queries or unvalidated input? Missing auth or role check? Secrets, tokens or connection strings in code or logs? Personal data in logs? |
| **architecture** | Does the boundary match the owning projects? Overlap or conflict with an existing feature (spec stage, part B)? | Layer boundaries per the project's own rules? Cross-system links as references, not hard couplings? Scales with data volume (indexes, set-based work)? Circular dependency? | Code in the layer the plan put it? New coupling, or a duplicate of an existing service? Row-by-row loops where a set-based query fits? |
| **resilience** | Every edge case from the `/shape` diagnostic frame placed as a BR, AC, non-goal or question? | Transaction and rollback per slice? Idempotent retries? Concurrency on shared records? Migration and rollback named? | Errors handled and rolled back? Null and empty paths? Double submit and retry safe? A clear error for the user, not a crash? |
| **maintainability** | ACs testable and single-behaviour? Terms defined once? | Slices vertical and testable? Tests named per AC? Estimate covers test data and environment work? Query or N+1 risk named? | Matches the surrounding naming and idiom? Dead code, magic numbers, copy-paste? Hot-path cost? Tests cover the AC? |
| **lean** | Any requirement speculative (no user, report or rule asks for it)? Could an existing screen or report cover it? | A new structure, service, layer, interface or dependency where an existing one fits? Config for a value that never changes? | Dead code, an interface with one implementation, a factory with one product, a pass-through wrapper, hand-written code a standard library already provides, a duplicate helper, unused config, a new dependency? Tag each `delete` · `reuse` · `builtin` · `platform` · `yagni` · `shrink` and name the replacement |

The **lean** lens looks only for what can be removed or replaced; correctness, security and speed stay with the other four. Before a `delete`, search for the symbol everywhere (code, config, registrations, string or reflection use).

## Recording findings

There is no separate critique file: findings are records, so `hl blockers {T}` and `hl context {T}` see them.

| Finding | Command |
|---------|---------|
| **critical** (blocks the next gate: freeze, build or sign-off) | `hl question add {T} "[{lens}] {kind}: {issue} ({pointer})" --blocking --option "{fix}" --option "accept: {why}"` |
| **major** or **minor** | `hl gap add {T} "[{lens}] {severity} {kind}: {issue} ({pointer})" --category critique-{stage}` |
| a confirmed defect in built code | `hl bug add {T} "{issue} ({path}:{line})" --severity {critical|high|medium|low}` |

- The pointer is grep-able: a section name, `BR-2`, `AC-3`, `S1-T2` or `path:line`.
- A critical finding is closed only when a person answers its question: fixed (name the command) or accepted (with the reason). Never answer it yourself.
- A resolved gap or bug is noted with `hl ticket comment {T} "{G or B id}: resolved by {command}"`.
- Never edit record TOML by hand.

### Severity

| Level | Meaning | Gate behaviour |
|-------|---------|----------------|
| **critical** | Blocks the next lifecycle gate (freeze, build, verify sign-off) | Must be fixed or explicitly accepted by a person before proceeding |
| **major** | Should be fixed before proceeding; risk of rework | Report prominently; suggest the repair command |
| **minor** | Can wait; a backlog note | Log only |

`security-risk` and `operational-risk` findings are always at least **major**.

## Kinds: spec

| Kind | Signal |
|------|--------|
| `ambiguity` | Vague modifiers, undefined terms |
| `contradiction` | Sections that conflict with each other or with the current state |
| `untestable` | An AC without an observable outcome |
| `unstated-assumption` | Inferred preconditions not written down |
| `unrealistic-constraint` | A non-functional requirement that the infrastructure cannot meet |
| `spof` | A single external dependency with no fallback |
| `scope-creep` | Work not traceable to the intent |
| `nfr-unmeasurable` | A non-functional requirement with no way to measure it |
| `pre-mortem` | A plausible failure story not covered by a BR, AC or non-goal (L) |

## Kinds: plan

| Kind | Signal |
|------|--------|
| `traceability` | An AC with no task, a task with no AC, or a slice not tied to ACs (`hl validate` warnings) |
| `scope-drift` | Plan work not in the frozen spec |
| `contradiction` | Spec AC versus plan Design versus task conflict |
| `sequencing-risk` | Slice order not riskiest first, hidden dependencies, layer phases instead of vertical slices |
| `effort-unrealistic` | Task total more than 10% over the Final upper bound without reason; missing test data or env tasks |
| `untestable` | A slice not testable end to end; an AC with no test level |
| `layer-violation` | A boundary break against the project's architecture rules |
| `rollback-gap` | A schema or contract change with no rollback note |
| `critical-path` | A bottleneck understated; an unknown without a spike task (L) |
| `schema-incomplete` | A new or altered structure without a schema sketch, or uncited fields |
| `schema-unapproved` | A schema change whose Approval is not `approved`: always **critical** |
| `rules-unmapped` | A `BR-n` not cited on an enforcing task or design element |
| `impact-gap` | A runtime or schema ticket with an empty Impact, or high-severity callers left out |
| `state-flow-gap` | A state field written with no transition row, a code without its meaning, or a transition no `BR-n` allows |
| `role-overlap` | The plan changes a rule, AC or scope (that is the analyst), or the spec carries schema design (that is the planner) |

## Kinds: implementation

| Kind | Signal |
|------|--------|
| `plan-drift` | Code differs from the task's ACs or the plan's Design contract |
| `incomplete-slice` | Done tasks missing deliverables |
| `spec-gap` | A spec `AC-n` or `BR-n` behaviour absent in code |
| `error-handling` | Failure paths missing where an AC requires them |
| `test-gap` | An AC without a test case or a test hook |
| `security-risk` | Obvious injection, secrets, auth bypass |
| `operational-risk` | Transactions, idempotency, concurrency |
| `over-built` | A `[lean]` finding: code that can be deleted or replaced by something already there |

## Shared acceptance criteria

- All five lenses reported: findings, or `{lens}: clear, checked {what}`.
- Every in-scope artifact or file considered, or an explicit "missing, skipped" with the reason.
- Every finding has a severity, a kind and a grep-able pointer.
- No silent edits to the artifacts under critique.
- Findings written through `hl`, never by hand.
- Every critical finding is a blocking question.

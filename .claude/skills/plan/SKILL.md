---
name: plan
description: Owns a ticket's living plan (the how). Impact, design with schema changes approved by a person, state transitions, vertical slices with tasks, and the estimate with re-forecast. Use when the spec is frozen, when scope changes, or to size or re-forecast a ticket.
---

# /plan

```text
/plan {T} [mode]      # mode = impact | design | slice | estimate; none = next needed by size
```

**Reads:** `hl context {T} --json` (size, stage), `{T}-spec.md`, `hl ticket show {T} --json` (tasks), product code and data definitions (read-only) · **Writes:** `{T}-plan.md`; tasks, questions and decisions through `hl`

## Steps

Paths are relative to the ticket folder. Read [techniques.md](techniques.md) before `slice` or `estimate`.

1. Pick the mode:

   | Mode | Does | Writes |
   |------|------|--------|
   | `impact` | Blast radius: systems, data, callers, jobs, config, release and operations | plan Impact |
   | `design` | Data and schema changes, contracts, screens, state transitions, diagrams | plan Design |
   | `slice` | Vertical slices riskiest first, tasks per slice, AC to test level | plan Slices, Test strategy; tasks via `hl task add` |
   | `estimate` | Before build: size tasks and write the Final. With actuals: re-forecast in place | plan Estimate |

   **No mode:** the first step of the size path whose section is empty or stale:

   | Size | Path |
   |------|------|
   | **S** | `slice` (one slice), `estimate`; `design` first when a schema or a state field is touched |
   | **M** | `impact`, `design`, `slice`, `estimate` |
   | **L** | `impact`, `design` (with diagrams), `slice` (a `spike` task per unknown), `estimate` |

   No size: `/spec {T} triage` first. Ticket not in `plan` (spec not frozen): stop and say so. All sections current: report done.
2. **Any mode:** plan missing: render [templates/plan.md](templates/plan.md) (`{T}`, `{TIMESTAMP}`) and fill Size and approach. Never overwrite an existing plan; edit sections in place.
3. **impact:** for each item in the spec's Data touched and each entry point found: read its definition and search the owning projects for callers (APIs, jobs, reports, other apps). One Impact row per system, data item (new, alter, read), caller, config key (names only), release or operations item, each with severity and evidence; no callers: "none found (searched: ...)". Docs-only ticket: `n/a, docs only`.
4. **design:** fill Change footprint first (counts of data structures, contracts, state fields, screens). Every new or altered data structure: a before and after table plus a schema sketch (fields, types, nullability, defaults, keys, indexes), backfill and rollback. Every component that enforces a `BR-n` gets a Rules enforced row. Every state field written gets a State transitions table plus a `stateDiagram-v2`, codes with meanings. Contracts and screens each cite their `AC-n` or `BR-n`; layer shapes follow the project's own rules (`/project-layout`). Map build order; a circular dependency is critical. Then Schema approval.
5. **slice:** cut `S1...Sn` per techniques.md (Vertical slicing; S has one slice) and fill Slices (goal, ACs, risk, order, depends). Add tasks, one layer each:
   ```
   hl task add {T} "{title}" --slice S1 --layer db|api|ui|test|env|spike|docs --ac AC-1 [--ac AC-2] --estimate 2
   ```
   Test-data and environment work become named `test` or `env` tasks; L adds one `spike` per unknown, ordered first. On a re-run, never drop a done task. Fill Test strategy (each AC to unit, integration, e2e or manual). Then `hl validate {T}` and clear every "AC with no task" or "task with no AC" warning.
6. **estimate:** read the tasks (`hl ticket show {T} --json`).
   - **No actuals yet:** size each task per techniques.md (Estimating) and write Estimate.
   - **Actuals exist:** forecast per techniques.md (Forecasting) and update Estimate in place.
   - Either way append one line under *Revisions*. The last row of Estimate is plain `Final`.
7. Open unknowns: `hl question add {T} "..."`. Design decisions: `hl decision add {T} "..." --chosen ... --why ... [--rejected ...]`.
8. **M and L, after estimate:** `/challenge {T} plan` in a fresh agent, then Plan approval.

### Schema approval

Any schema change (a new or altered persistent data structure: table, field, index, stored document shape) stops the plan after `design` until a person approves it: every size, every mode, attended or not. It is never assumed.

1. **Ground the before** from the real definition (schema file, migration or the live definition, read-only). Cite it. Never from memory. No definition found: `UNVERIFIED`, said on the approval screen. For an altered structure that may be large, ask once before a read-only size query; declined: "volume: not checked". Large data or a backfill: a Risks row on how the release avoids a long lock.
2. Show, in chat, per structure: the before and after table, the volume, the rules it enforces and its state transitions.
3. Log it: `hl question add {T} "Approve schema change for {name}" --blocking --option "approve as shown" --option "change it"`.
4. A person answers (`hl question answer`); never answer it yourself. Approved: set Design **Approval** to `approved {date} by {person} ({Q})`. A requested change goes back into `design`, then is shown again.
5. Unattended run: `hl ticket block {T} --by "schema approval" --next "answer {Q}"` and stop. No `slice` while any approval is pending.

### Plan approval (M and L)

After `estimate` and a clear plan challenge: `hl question add {T} "Approve plan for build" --blocking --option "approve" --option "change it"`. Show the plan summary (slices, Final hours and range, risks). Build waits until a person answers; the builder's `hl ticket move {T} build` exits 2 until then. S skips this.

## Rules

- **Never invent** a field, structure, component or endpoint: cite a definition or a code path; else mark `UNVERIFIED` and open a question. Data definitions are read-only here.
- **A circular dependency** (design order or task order) is critical; resolve before build.
- **Task total more than 10% over the Final upper bound:** flag it in the report and Risks; re-slice or `/fix {T} --revise` scope. Never accept it silently.
- **Never quote delivery dates.** Days at 8 hours are indicative only.
- **Evidence per estimate row** (task ids, AC, Impact row); never invented hours.
- **One plan, edited in place;** no separate estimate or forecast file. Tasks change only through `hl task add` and `hl task set`. Never write `status:`, `stage:` or `phase:` frontmatter.
- A rule, AC or scope change found while planning goes to the analyst (`/spec {T} refine`); never edit the spec here.

## Output

The report shape in `AGENTS.md`: mode, sections written, slices and tasks (count, total estimate), Final hours with range and confidence, `UNVERIFIED` flags, validate warnings, the 10% flag, approvals pending. Next: the size path's next mode; after `estimate`, `/challenge {T} plan` and Plan approval (M and L) or the builder `{T} S1` (S). Mid-build, `/plan {T} estimate` re-forecasts.

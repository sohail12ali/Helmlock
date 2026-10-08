# Stage: plan

Run after `/plan {T} estimate` on M and L tickets, before plan approval and build (S tickets skip it). Run again after `/fix {T} --revise` or a replan that changes scope, slices, tasks or order.

## Inputs

- `{T}-spec.md`: `BR-n`, `AC-n`, Scope and non-goals, Data touched.
- `{T}-plan.md`: Impact (required when runtime or schema is in scope; else note the skip), Design (a schema sketch for every new or altered structure, and its Approval line), Slices, Test strategy, Estimate, Risks and spikes.
- Tasks: `hl ticket show {T} --json`.
- `hl validate {T}`: the AC-with-no-task and task-with-no-AC warnings.

## Steps

1. Walk the five lenses (rules.md, Plan column), then the plan kinds (`traceability` to `role-overlap`) for anything the lenses missed. Layer checks follow the owning project's architecture rules (its `CLAUDE.md` and skills). Record each finding (rules.md, Recording findings) with pointers like `plan Slices S2`, `S1-T3`, `AC-4`.
2. A schema change whose Approval line is not `approved` is always a critical `schema-unapproved` finding.
3. No iteration log: the records are the history.

## Acceptance criteria (plus the shared ones in rules.md)

- No edits to the spec, the plan or the tasks.
- Impact presence checked whenever runtime or schema is in scope.

**Gate:** plan approval and build proceed only with no open critical finding (`hl blockers {T}` exits 0). Next: plan approval (M and L), then the builder `{T} S1`, when clear; else `/fix {T} --revise`, the planner or `/shape {T}`.

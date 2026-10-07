---
type: plan
ticket: {T}
created: {TIMESTAMP}
tags: [ticket/{T}, artifact/plan]
---

# Plan: {T}

> Living plan. Edited in place by `/plan {T} impact|design|slice|estimate`. Requirements: [[{T}-spec]] · tasks: `tasks.toml` (through `hl task add` and `hl task set`). History is git plus decision records.

## Size and approach

**Size:** {S|M|L} · **Projects:** _list_ · **Approach:** _one paragraph: how the change is built and why this way_

## Impact

_Every row: severity (high, medium, low) plus evidence. S tickets: "n/a, S" or one line._

| Area | Item | Change | Severity | Evidence |
|------|------|--------|----------|----------|
| System or repo | _project id_ | code or config | | _path_ |
| Data | _structure name_ | new, alter or read | | _definition path_ |
| Caller or consumer | _API, job, report, other app_ | how affected | | _path or search_ |
| Config key | _name only, never a secret value_ | add or update | | _file_ |
| Release or operations | _migration, rollback, backfill, downtime_ | Y or N | | |

Callers searched: _repos and paths_. None found: say so.

## Design

### Change footprint

| Data structures new / altered | Contracts new / altered | State fields | Endpoints or commands | Screens |
|-------------------------------|-------------------------|--------------|-----------------------|---------|
| _n / n_ | _n / n_ | _n_ | _n_ | _n_ |

### Schema

_Every new or altered persistent structure. Existing structures: touched fields only. Grounded in the real definition; unknown: `UNVERIFIED` plus a question._

**Approval:** _pending | approved {date} by {person} (Q-n)_ (no slice while any change is pending; n/a when there is no schema change)

| Structure | Field | Before | After | Null | Default | Rule | Source |
|-----------|-------|--------|-------|------|---------|------|--------|
| _name_ | _field_ | _type, or none when new_ | _type, or unchanged, or dropped_ | Y/N | | BR-_n_ | _path or UNVERIFIED_ |

```text
schema sketch: fields, types, nullability, defaults, keys, indexes
```

_Existing records: backfill or default for new required fields · rollback: how the change is undone._

### Rules enforced

_One row per component that enforces a `BR-n`._

| Component | New or alter | Enforces | Reads | Writes | State change | Errors and transactions |
|-----------|--------------|----------|-------|--------|--------------|-------------------------|
| _name_ | alter | BR-_n_: _rule in words_ | | | _from, to, or none_ | _how failures surface and roll back_ |

### State transitions

_Every state field the ticket writes. Codes with meanings: `7 (Picked)`, never a bare `7`. Source cited._

| Field | From | To | Set by | Allowed when (BR-n) |
|-------|------|----|--------|---------------------|

```mermaid
stateDiagram-v2
  %% Released --> Picked: component (BR-n)   one line per transition row above
```

### Contracts

| Endpoint or command | Request | Response and errors | ACs |
|---------------------|---------|---------------------|-----|

### Screens

| Screen | Behaviour | Test hooks | ACs |
|--------|-----------|------------|-----|

### Diagrams

_L: required; M: when ordering is not obvious. Mermaid in this file or links into `architecture/`._

## Slices

_Vertical, riskiest first; each shippable and testable end to end. Tasks live in `tasks.toml` (`S1-T1`...)._

| Slice | Goal | ACs covered | Risk | Order | Depends |
|-------|------|-------------|------|-------|---------|
| S1 | _thin end-to-end cut_ | AC-1, AC-2 | high, medium or low | 1 | _none, or S1-T2 after S1-T1_ |

## Test strategy

| AC | Test level | Notes |
|----|------------|-------|
| AC-1 | unit, integration, e2e or manual | _case family; designed by `/verify {T} cases`_ |

## Estimate

_`/plan {T} estimate`. Keep the `Hours` column and the plain `Final` row._

| Line | Hours | Lower | Upper | Evidence |
|------|------:|------:|------:|----------|
| Feature dev (sum of task M) | | | | task ids |
| Test and env overhead | | | | _test and env task ids_ |
| QC (derived ×{factor} + support {h}) | | | | QC formula |
| Risk reserve (+{%}) | | | | basis or confidence |
| Final | | | | |

**Confidence:** {Low|Medium|High} · Days at 8h: {F/8}, indicative only, no dates.

Revisions:
- {date}: {estimate | forecast}: Final {h} [{lo} to {hi}], {why it moved}

## Risks and spikes

| ID | Risk | Mitigation or spike task | Effect |
|----|------|--------------------------|--------|
| R1 | | _S1-T1 (spike)_ | _+X% upper, or blocks S2_ |

## Decisions

Source of truth: decision records (`hl context {T}`). This section is not a copy.

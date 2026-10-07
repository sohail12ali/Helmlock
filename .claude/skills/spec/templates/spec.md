---
type: spec
ticket: {T}
created: {TIMESTAMP}
tags: [ticket/{T}, artifact/spec]
---

# Spec: {T}

> Living spec. Edited in place by `/spec {T} draft|refine`; frozen by `/spec {T} freeze`, which moves the ticket to `plan`. History is git plus decision records.

## Summary

**Stakeholder (one line):** _outcome wanted_

_One paragraph: who is affected, what changes, why it matters._

## Problem and users

- _Current behaviour or gap, with source_
- _Users and roles affected_

## Current state and feasibility

_How it works today, from the code; not the design of the change (that is the plan's job)._

- **Flow today:** _entry point, components, data, cited_
- **Statuses today:** _the state field and the values in play, with meanings: `7 (Picked)`_
- **Constraints:** _what the current code, data or integrations force on us_
- **Verdict:** _feasible · feasible with {constraint} · not feasible without {X}_ (_evidence_)

## Scope and non-goals

### In scope
- _deliverable_

### Non-goals
- _excluded item, and why_

## Business rules

- **BR-1:** _atomic rule in one sentence_

## Acceptance criteria

- **AC-1** (BR-1): **Given** _precondition_ **When** _action_ **Then** _observable outcome_

## Examples

| Rule | Example | Expected |
|------|---------|----------|
| BR-1 | _concrete case_ | _outcome_ |

## Data touched

_Existing data the behaviour reads or writes today, and data needs stated in words ("we must record who overrode the limit"). No new fields or schema: the planner designs those._

| Object | Kind | Read or write | Source |
|--------|------|---------------|--------|
| _name_ | table, file, API, config | R or W | _definition path or code path_ |

## Open questions

Source of truth: the question, gap and decision records (`hl context {T}` and `hl blockers {T}`). Not copied here.

## Sources

- _path, commit or ticket_

## Original request

> _original request, kept unedited_

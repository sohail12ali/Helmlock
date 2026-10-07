---
ticket: {T}
type: test-cases
slice: {slice | all}
related: ["[[{T}-spec]]", "[[{T}-plan]]"]
tags: [ticket/{T}, artifact/test-cases]
created: {YYYY-MM-DD}
---

# Test cases: {T}{ · slice}

**Ticket:** {T} · **Slice:** {slice | all} · **Written by:** `/verify {T} cases` · **Date:** {YYYY-MM-DD}

> This file is the test **design** (what to test and the expected result). Test code lives in the project repo; its layout and commands come from the project layer.

## Traceability matrix

Every `AC-n` in `{T}-spec.md` maps to at least one case, and every case cites its AC.

| AC | Criterion (short) | Slice | Test level (plan Test strategy) | Case ids | Covered? |
|----|-------------------|-------|---------------------------------|----------|----------|
| AC-{n} | {criterion} | S{n} | unit, integration or e2e | TC-U-001, TC-I-001 | yes, or gap |

## Unit tests

Isolated logic, doubles at the boundaries.

| ID | AC | Unit under test | Scenario | Expected result | Type | Priority | Test data |
|----|----|-----------------|----------|-----------------|------|----------|-----------|
| TC-U-001 | AC-{n} | `{Method}` | {happy path} | {expected} | positive | P0 | {ref} |
| TC-U-002 | AC-{n} | `{Method}` | {invalid input} | {error, no state change} | negative | P0 | {ref} |
| TC-U-003 | AC-{n} | `{Method}` | {boundary value} | {expected at the threshold} | boundary | P1 | {ref} |

## Integration tests

Real boundaries (API to service to data store). Isolated test data or rollback.

| ID | AC | Flow | Scenario | Expected result | Type | Priority | Setup and cleanup |
|----|----|------|----------|-----------------|------|----------|-------------------|
| TC-I-001 | AC-{n} | API, service, data | {happy path} | {stored and correct response} | positive | P0 | seed: ... / cleanup: ... |
| TC-I-002 | AC-{n} | API, service | {validation rejects} | {error response, nothing stored} | negative | P0 | seed: ... |

## End-to-end tests

Full user workflow. Steps use stable test hooks.

| ID | AC | Preconditions | Steps | Expected result | Priority |
|----|----|---------------|-------|-----------------|----------|
| TC-E-001 | AC-{n} | {signed in, data seeded} | 1. ... 2. ... 3. ... | {AC met, UI state} | P0 |

## Negative, boundary and edge cases

| ID | AC | Category | Condition | Expected handling |
|----|----|----------|-----------|-------------------|
| TC-N-001 | AC-{n} | negative | missing required field | rejected with a clear message; no state change |
| TC-B-001 | AC-{n} | boundary | exactly at the threshold (equal, max, zero) | documented behaviour at the edge |
| TC-X-001 | AC-{n} | edge | concurrency, race or timeout | handled; no corruption |

## Test data

| Scenario | Seed data | Source | Cleanup |
|----------|-----------|--------|---------|
| {happy path} | {records or fixtures} | {script in tests/ or factory} | rollback, or delete what was created |

## Preconditions

- [ ] Test environment reachable and on the branch's build
- [ ] Seed data loaded
- [ ] Test hooks present on every interactive control in scope (e2e)

## Summary

| Category | Count | P0 | P1 | P2 |
|----------|-------|----|----|----|
| Unit | {N} | | | |
| Integration | {N} | | | |
| End-to-end | {N} | | | |
| Negative, boundary, edge | {N} | | | |
| **Total** | **{N}** | | | |

**Coverage:** {X} of {Y} acceptance criteria mapped ({Z}%; gaps listed in the matrix).

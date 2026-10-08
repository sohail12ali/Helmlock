# /verify: cases scope

`/verify {T} cases [slice]` designs the traceable test-case artifact (unit, integration, e2e, negative, boundary, edge) from the spec's acceptance criteria. Run once the plan has slices, before or alongside the other scopes: they verify against its case ids, and the verifier uses it as its Phase B test plan. Omit `slice` for every AC.

**Design, don't execute.** This scope runs no tests.

## Steps

1. **Load context** from the ticket folder: `{T}-spec.md` Acceptance criteria (`AC-n`, grouped under `US-n` when present), Business rules and Examples (edge cases); `{T}-plan.md` Slices (which ACs the slice covers), Test strategy (AC to test level) and Design (data, API and UI surfaces).
2. **Derive cases per AC:** at least one positive case per `AC-n`, at the level Test strategy names, plus negative, boundary and edge cases where the AC implies validation, money, stock, permissions, concurrency or thresholds. Level by surface:
   - logic inside one unit: unit (`TC-U-*`)
   - API to service to data: integration (`TC-I-*`)
   - a user-facing workflow: e2e (`TC-E-*`)
   - a risk class (validation, limits, race): negative, boundary, edge (`TC-N-*`, `TC-B-*`, `TC-X-*`)
3. **Traceability matrix:** map every `AC-n` to case ids, and every case cites its `AC-n`. An AC with no case is a gap, shown in the matrix and the report, never dropped.
4. **Test data:** seed and cleanup per scenario; link reusable scripts in the ticket's `tests/` folder rather than inlining them. Development data only, repeatable, never destructive to shared environments.
5. **Write the artifact** from `.claude/skills/verify/templates/test-cases.md`.

## Case ids

`TC-{level}-{NNN}`: `U` unit · `I` integration · `E` e2e · `N` negative · `B` boundary · `X` edge. Numbered within the level (`TC-U-001`). Ids are stable: on revision append, never renumber (builder and verifier cite them).

Each row carries its `AC-n` · scenario · expected result · type (positive, negative, boundary, edge) · priority (P0, P1, P2) · test data. Unit rows name the method under test as `{Method}_{Scenario}_{Expected}` unless the project's convention differs. E2E steps reference stable test hooks (ids or accessibility labels).

Risk-weighted depth: permissions, money and stock always get negative and boundary cases. Read-only display gets lighter coverage; keep e2e minimal and deterministic.

## Output

`test-cases/{T}-test-cases.md` (or `{T}-test-cases-{slice}.md`); the folder is created when the first file is written. Frontmatter per the template, with no `status:`.

Done when:
- Every AC maps to at least one case (gaps flagged).
- Negative and boundary cases exist for validation, money, stock, permission and threshold logic.
- Test data and cleanup are specified per scenario.
- Priorities are set (P0 = must pass before merge).
- Summary counts and AC coverage are filled.

Result table: file · cases (U · I · E · N/B/X · total) · AC coverage (mapped of total, gap ids) · priority split. Next: `/verify {T} {scope}`.

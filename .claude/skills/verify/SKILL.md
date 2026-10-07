---
name: verify
description: Verifies an implementation against its acceptance criteria through unit, integration, end-to-end, review, exploratory or pre-release checks, and designs the test cases. Use when a slice is built, before merge, or to write the test-case plan from the ACs.
---

# /verify

```text
/verify {T} [scope]          # scope default: all
/verify {T} cases [slice]    # design the test-case artifact
```

**Reads:** `{T}-spec.md` ACs, `{T}-plan.md` Test strategy, `hl ticket show {T} --json`, `test-cases/{T}-test-cases.md`, the changed code · **Writes:** `test-cases/{T}-test-cases.md` (`cases`), `test-cases/{T}-test-report-{date}.md`, bug records through `hl bug add`

## Steps

1. Pick the scope and read only its file:

   | Scope | Checks | Detail |
   |-------|--------|--------|
   | `unit` | Isolated logic with test doubles, validating ACs | [scopes/unit.md](scopes/unit.md) |
   | `integration` | Component interactions with real dependencies | [scopes/integration.md](scopes/integration.md) |
   | `e2e` | Full user workflows (when UI is in scope) | [scopes/e2e.md](scopes/e2e.md) |
   | `review` | Code review by changed surface, severity-graded | [scopes/review.md](scopes/review.md) |
   | `explore` | Exploratory charters on a test environment (on request) | [scopes/explore.md](scopes/explore.md) |
   | `ready` | Pre-release: all of the above plus security and performance | [scopes/ready.md](scopes/ready.md) |
   | `cases` | Test-case design from the spec's `AC-n`; no execution | [scopes/cases.md](scopes/cases.md) |
   | `all` | unit, integration, e2e, review, in sequence | |

2. **Project first.** Read the owning project's `CLAUDE.md`; find its test skills with `hl skill find "test {project}"`. Test homes, frameworks and commands come from the project layer, never from memory.
3. **Test plan input:** unit, integration and e2e verify against the case ids `TC-U`, `TC-I`, `TC-E`, `TC-N`, `TC-B`, `TC-X` in `test-cases/{T}-test-cases.md`. Absent or stale against the current ACs: run `/verify {T} cases` first.
4. Run the scope, then classify each failure (Failures below): fixable or blocker. Hand fixables to `/fix {T}` and re-run the failed checks.
5. Work through the checklist:

   ```
   Verification: {T}, scope: {scope}
   - [ ] Every spec AC-n in scope traced to code or tests
   - [ ] Build of every touched project (the project's own build skill)
   - [ ] Tests in scope executed, with commands and output
   - [ ] Review surfaces covered (data, API, UI, security as they apply)
   - [ ] Each failure classified; fixables handed to /fix and re-run
   - [ ] Dated report written
   ```

## Rules

### How this check fails

1. **Avoiding the check:** you read the code, narrate what you *would* test, write PASS and move on. Reading a file is not running a test.
2. **Seduced by the first 80%:** a clean build, a green suite or a screen that renders reads as done, while half the buttons do nothing, state vanishes on refresh, or the boundary case throws. The value of this pass is the last 20%.
3. **Checking stale output:** an old build, an old deploy or old data gives a PASS for code you never ran. Rebuild or redeploy, and confirm the version under test, before trusting any result.

**Bug fixes prove base versus branch.** Run the same check on the base branch (it fails, showing the bug) and on this branch (it passes). Both go in the report.

**The re-run clause.** Every PASS carries the command and its real output. The caller may re-run any command; a PASS with no output, or output that does not match a re-run, rejects the whole report. A skipped check says skipped and why; never infer a result.

**Where results go.** Each run, retests included, writes a dated report `test-cases/{T}-test-report-{YYYY-MM-DD}.md`. Each confirmed defect becomes `hl bug add {T} "..." --severity {level}`; a fixed and retested bug gets `hl ticket comment {T} "{B id} verified: {command}"`.

### Failures: fixable or blocker

| Fixable: `/fix {T}` (at most 3 files), then re-run the failed checks | Blocker: report with a mitigation; `/fix {T} --revise` to replan |
|---------|---------|
| Typos, null checks, lint within policy | Spec versus implementation conflict |
| A missing test hook when the AC is clear | An architecture or contract change that needs product sign-off |
| An assertion mismatch after an intended behaviour fix | A CI change only to make unrelated failures green |
| A broken artifact link | Scope creep or missing requirements |

Never weaken CI or checks to pass. All blockers are resolved before merge. Hand-off depth: `.claude/skills/kickoff/orchestration-rules.md`.

## Output

The report shape in `AGENTS.md`. Result row: Scope · Tests (total, passing, coverage) · Issues (fixable fixed, blocking) · Blockers · Verdict: Ready, Needs Review or Blocked. A verifier run ends with its Disposition (`ready_to_close`, `needs_fix`, `blocked`, `needs_human`).

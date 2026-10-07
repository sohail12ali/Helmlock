---
name: close
description: Close a verified ticket. Runs the closure gates in order (blockers, layout and trace, release notes, closure digest, close approval for M and L) and moves the ticket to done. Use when the verifier says ready_to_close or a person asks to close a ticket.
---

# /close

```text
/close {T}
```

**Reads:** `hl context {T} --json`, `hl ticket show {T} --json`, `hl blockers {T}`, `hl validate {T}`, the spec, plan, test cases and decision records · **Writes:** `{T}-digest.md`, `{T}-release-notes.md` (when it ships to users), the close approval question and the move to `done` through `hl`

## Steps

Gates run in order; stop at the first failure with a clear reason and the command that fixes it.

### Gate 1: Readiness

- `hl blockers {T}` exits 0: no open blocking question, bug or gap.
- Every task is `done` (`hl ticket show {T} --json`).
- The last verify report is green and the verifier's disposition was `ready_to_close`.

On failure, list the open items and suggest `/verify {T} ready`, `/fix {T}` or `/fix {T} --revise`.

### Gate 2: Layout and trace

1. `hl validate {T}` exits 0 (layout, naming, no stage frontmatter, AC to task trace).
2. Completeness by size: the spec has Summary, `BR-n` and Given/When/Then `AC-n`; the plan has the sections its size needs (S: Slices and Estimate; M and L: Impact, Design, Slices, Test strategy, Estimate), and Estimate has a `Final` row.
3. Trace: every `BR-n` has an AC; every `AC-n` is in a slice, has a task and (once test cases exist) a `TC-*`. Report each gap with its fix (add the case or task, or de-scope with a decision record).

### Gate 3: Release notes (only when the ticket ships to users)

`{T}-release-notes.md` from [templates/release-notes.md](templates/release-notes.md) has Overview, Changes, Deployment notes and Affected projects. Missing parts: ask the person (numbered questions, each with a recommendation). Internal-only tickets: "n/a, internal".

### Gate 4: Closure digest

Write `{T}-digest.md` from [templates/closure.md](templates/closure.md): about 400 words, a fixed shape, `(none)` for an empty section.

- **Outcome:** what shipped and what it does for the user, in two or three sentences.
- **Decisions:** each decision record that shaped the result, with its reason and what was rejected (`D-003-sa: chose X over Y because Z`).
- **Key files and links:** `[[{T}-spec]]`, `[[{T}-plan]]`, the test cases, and the main code paths per project.
- **Caveats:** known limits, accepted findings, `shortcut:` markers left behind, risks for the next person.
- **Follow-ups:** follow-up tickets and open todos (`hl todo list --json`), by id.

Facts only, each traceable to a record or a file; no process narration, no agent or skill names. The digest is what stays visible after the ticket is archived.

### Gate 5: Close approval (M and L only)

`hl question add {T} "Approve close of {T}" --blocking --option "approve" --option "reopen: {why}"`, showing the digest summary. Stop and wait: a person answers it; never answer it yourself. S skips this gate.

### Gate 6: Done

`hl ticket close {T}`: checks the digest (sections, size) and moves to `done`. Exit 1: fix the digest it names. Exit 2: a gate is still open; read the message, report it, stop. Then `hl ticket release {T}`.

## Rules

- Writes only inside the ticket folder and through `hl`. Never touches product code.
- Idempotent: an already-done ticket reports "already closed" with the date and exits; the digest is updated in place, never duplicated.
- Never mark done with an open blocker, a failing validate or (M and L) an unanswered close approval.
- Moving drafts aside and archiving are separate, later steps; this skill does not move or delete files.

## Output

The report shape in `AGENTS.md`: gates passed, the digest path and word count, the release notes status, the new stage. Next: the deployer `{T}` when the person wants to publish; the Stop hook will remind about `/log-work`.

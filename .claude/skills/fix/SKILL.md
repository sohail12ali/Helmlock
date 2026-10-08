---
name: fix
description: Diagnoses and patches build, runtime, logic or data defects at the root cause, or revises a ticket's spec, plan and tasks in place when scope or design changes. Use when the verifier hands off a fixable, for targeted defects, or for feedback on ticket artifacts.
---

# /fix

```text
/fix {B-id} [type] [scope] ["description"]   # fix a recorded bug
/fix {T} ["symptom"]                         # a defect in the ticket in context
/fix {T} --revise ["feedback"]               # revise artifacts or code for changed requirements
/fix                                         # ask for the issue or the feedback
```

**Reads:** the symptom or feedback, `hl context {T} --json`, the owning project's rules · **Writes:** project code (defect); `{T}-spec.md` and `{T}-plan.md` in place and tasks through `hl task add` and `hl task set` (revise); task status through `/progress`

## Steps

1. Pick the mode: `--revise` or feedback-style input is Revise; else Defect.

   | Parameter | Values | Notes |
   |-----------|--------|-------|
   | type | `auto` (default), `build`, `runtime`, `logic`, `data` | `auto` classifies from the symptom |
   | scope | `ui`, `api`, `data`, `files` | biases the search; omit if unknown |
   | description | free text | logs, stack trace, steps, project path, or feedback |

### Defect mode (default)

1. With `auto`, classify as build, runtime, logic or data from the symptom.
2. Resolve the owning project (`/project-layout`), read its `CLAUDE.md` and pin the working directory to its root.
3. Reproduce first; a defect you cannot reproduce is reported as such, not patched blind.
4. Fix the root cause: before editing a shared function, find every caller and patch once where they all pass through (`AGENTS.md`, Keep solutions simple). Minimal diffs; never disable security broadly or change public contracts outside the ticket's scope.
5. Prove it with the project's own build and the focused test (`/project-layout run {skill}`); for a bug, the check fails on the base branch and passes on this one.

Hand-off scope: 1 to 3 files, at most 2 layers deep.

### Revise mode

1. Load the current artifacts (`hl context {T} --json`). Clarify ambiguous feedback with numbered questions, each with a recommendation; ask for the feedback if none was given.
2. Classify the change: requirements · scope · data · contract · UI · design · flow · slice · implementation.
3. Edit the affected artifacts in place; no version files or revision notes:
   - requirements, scope or rules: `{T}-spec.md` through `/spec {T} refine`. A frozen spec reopens: `hl ticket move {T} spec` first, and a decision record.
   - impact, design, slices or estimate: the matching `{T}-plan.md` section (`/plan {T} {mode}`) plus `hl decision add`.
   - tasks: `hl task add` for new work, `hl task set` for status; never drop a done task, never hand-edit `tasks.toml`.
4. Feedback that targets built code rather than the plan: edit the project repo directly (Defect mode rules apply).
5. Keep existing work unless the person asks to replace it.
6. `hl validate {T}` after every revision.
7. Scope changed: `/plan {T} slice` then `/plan {T} estimate` (or the planner for a full replan); M and L: `/challenge {T} plan` again, and plan approval again.

### After any fix

- Update artifacts only when behaviour or contracts actually change and the ticket's scope allows it.
- A fixed task: `/progress {T} task {id} done {hours}`; a fixed bug: `hl ticket comment {T} "{B id} fixed: {cause}, {files}"`.

## Rules

### PR babysitting boundary

`/fix` is **scoped** repair inside a ticket (a build break, a logic bug, revise feedback, verifier fixables of at most 3 files). A PR-wide loop (conflicts, review comments, CI green) is out of scope unless the person ties a comment to one defect. When doing PR triage:

- Resolve merge conflicts only when the intent is clear; stop and ask if base and branch intents conflict.
- Address review comments (including bots) only when valid; say why when declining.
- Fix CI failures caused by this change; never edit workflows or unrelated code to force green. A failure that looks unrelated: merge or rebase the base first, then check again.
- Never force-push, rewrite history or change CI definitions without the person's approval.

## Output

The report shape in `AGENTS.md`.

- Defect: cause, fix, files touched, remaining risks, the commands that prove it.
- Revise: sections changed · impact · validate result · next step.

Next: `/verify {T}` (for example `unit`), not an open-ended PR loop.

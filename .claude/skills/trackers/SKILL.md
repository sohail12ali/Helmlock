---
name: trackers
description: Per-ticket records through the hl CLI for questions, bugs, todos and gaps, plus a harvest of shortcut markers into todos. Use when asked to list open questions, add a bug, capture a todo, see what blocks a ticket, or record a gap found in review.
---

# /trackers

```text
/trackers {kind} {verb} [args]     # kind = question | bug | todo | gap
/trackers blockers {T}
/trackers shortcuts [{T}] [project]
```

**Reads:** `hl context {T} --json`, `hl blockers {T}`, `hl todo list` · **Writes:** records through `hl` only (one TOML file per record, created by the CLI)

## Steps

1. Pick the kind and run its verb:

   | Kind | Ids | Add | Other verbs |
   |------|-----|-----|-------------|
   | question | `Q-003-sa` | `hl question add {T} "..." [--blocking] [--option "A" --option "B"]` | `hl question answer {Q} "..."` |
   | bug | `B-002-sa` | `hl bug add {T} "{title}" --severity {critical|high|medium|low}` | fixed or verified: `hl ticket comment {T} "{B} ..."` |
   | todo | `TD-007-sa` | `hl todo add "..." [--ticket {T}] [--due {date}] [--priority {p}]` | `hl todo done {TD}` · `hl todo list --json` |
   | gap | `G-001-sa` | `hl gap add {T} "..." --category {category}` | resolved: `hl ticket comment {T} "{G} resolved: ..."` |

2. Open records for a ticket: `hl context {T} --json` (all open) and `hl blockers {T}` (what blocks a gate; exit non-zero while any is open).
3. Read the kind's rules below before adding.

## Rules

- **Records change only through `hl`.** Never hand-edit record TOML, counters, ids or dates; the CLI assigns them. Tidy the wording, then pass one clean sentence.
- **Questions:** decisions that need an audit trail, at any stage. One assumption per question · 2 to 5 `--option`s only when the choices are knowable (add `Other` last), never padded · say your recommendation and why in the question text · `--blocking` only when a gate must wait for the answer (freeze, schema approval, plan or close approval, a critical finding). Interactive rounds: `/shape`. Agents never answer an approval question; a person does.
- **Bugs:** defects found after build: test runs, review, acceptance, production checks.

  | Severity | Meaning | Ship gate |
  |----------|---------|-----------|
  | critical | blocks a core flow | must be fixed and verified |
  | high | a major feature is broken | must be fixed before ship |
  | medium (default) | visible, a workaround exists | fix before ship |
  | low | cosmetic or an edge case | nice to fix |

- **Todos:** stray thoughts, chores, follow-ups; they never block. If one blocks a release, turn it into a bug or a question. No `--ticket` makes it a general todo. The owner is the current person from the roster; never guessed.
- **Gaps:** missing pieces in a spec or plan (stakeholders, rules, edge cases, non-functional needs, data, integrations, UX, compliance, cross-cutting; `critique-{stage}` for challenge findings). Each gap names its direction: fill, defer or turn into a question.

### Shortcut harvest

Collects the `shortcut:` markers that `AGENTS.md` (Keep solutions simple) asks for, so a deferral cannot quietly become permanent:

1. In the project root: `git grep -nE "(//|--|#|/\*) ?shortcut:"` (tracked files only, so build output is skipped).
2. For each hit not already a todo (`hl todo list --json`): `hl todo add "shortcut: {path}:{line}, {limit}; upgrade: {trigger}" [--ticket {T}]`.
3. A marker that names no upgrade trigger gets `upgrade: no trigger` and `--priority high`; those are the ones that rot.
4. Report `{N} markers, {M} new todos, {K} without a trigger`; none: `no shortcut markers`.

## Output

The CLI result (the new id, the list, or the `blockers` exit status with the open items), then the next command: usually `/shape {T}` for open questions or `/fix {T}` for open bugs.

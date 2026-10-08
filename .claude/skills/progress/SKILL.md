---
name: progress
description: Ticket and board status, one task's build context, and task or ticket status changes, as a thin wrapper over the hl CLI. Use when asked "where are we?" or "what is in flight?", before starting a task, or after finishing, blocking or unblocking one.
---

# /progress

```text
/progress                                        # board: my tickets in flight (read-only)
/progress {T}                                    # ticket snapshot (read-only)
/progress {T} task {id}                          # task context (read-only), id = S1-T1
/progress {T} task {id} start|done|block|unblock [hours | "reason"]
/progress {T} block "{by}" "{next}" | unblock    # flag or clear the ticket
```

**Reads:** `hl context`, `hl ticket show {T} --json`, `hl ticket list`, `hl blockers {T}`, `{T}-plan.md`, `{T}-spec.md` · **Writes:** task and ticket status through `hl` (status modes only)

## Steps

1. Pick the mode:

   | Mode | Commands |
   |------|----------|
   | board | `hl ticket list --mine --json` (add `--stage {stage}` to filter), `hl context --session` |
   | snapshot | `hl context {T} --json`, `hl ticket show {T} --json`, `hl blockers {T}` |
   | task context | `hl ticket show {T} --json`, then the row for `{id}` |
   | start | `hl task set {T} {id} --status doing` |
   | done | `hl task set {T} {id} --status done --actual {hours}` |
   | block or unblock a task | `hl task set {T} {id} --status blocked` plus `hl ticket comment {T} "{id} blocked: {reason}"` · `hl task set {T} {id} --status todo` |
   | block or unblock the ticket | `hl ticket block {T} --by "{who or what}" --next "{next action}"` · `hl ticket unblock {T}` |

2. **Board:** one row per ticket: id, title, stage, size, blocked (by, next), open questions. Flag tickets waiting on a person (approvals, blocking questions) first.
3. **Snapshot:** done and total tasks, estimate versus actual by slice and layer, blocked tasks with reasons, open blockers, the next task (the first `todo` whose dependencies in the plan's Slices are done, riskiest slice first). Variance trending over, or more than 10% past the plan's `Final` upper bound: recommend `/plan {T} estimate` to re-forecast.
4. **Task context:** no code generation. Show together: the task row (title, slice, ACs, layer, estimate, status); its slice row and depends from `{T}-plan.md` Slices plus the Design parts it touches (schema, contract, screen); its `AC-n` and the `BR-n` they trace to from `{T}-spec.md`.
5. **Done:** record the real hours with `--actual`. Report actual versus estimate and the variance.

## Rules

- Task and ticket status change only through `hl`; never edit `tasks.toml` or `ticket.toml`.
- A blocked task or ticket always names a reason; a blocked ticket names `--by` and `--next`.
- A task whose dependencies are not done: warn before `start`; go ahead only with a stated reason.
- Stage moves belong to the role that owns the lane (`AGENTS.md`, Board contract); this skill does not move tickets.

## Output

The report shape in `AGENTS.md`. Snapshot row: Tasks done/total · Hours estimate/actual · Slices · Blocked · Blockers · Next task. Done: actual versus estimate and the variance. Next: the builder `{T} {slice}`, `/plan {T} estimate` (re-forecast) or `/verify {T}` when a slice is complete.

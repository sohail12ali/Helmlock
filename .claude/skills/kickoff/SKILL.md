---
name: kickoff
description: End-to-end ticket delivery. Creates the ticket if needed, then runs analyst, planner, builder and verifier stage by stage, one agent per project when a ticket spans several. Use when a ticket should go from idea or requirements to verified in one run.
---

# /kickoff

```text
/kickoff {T} [mode]       # mode = staged | full | plan-only | build-to-verify
/kickoff "{idea}"         # no ticket yet: draft and create it first
```

**Reads:** `hl context {T} --json` (size, stage, blockers), `{T}-plan.md` Slices, `hl ticket show {T} --json` (tasks) · **Writes:** the ticket (`hl ticket new`, `hl ticket claim`), whatever each role agent writes

## Steps

1. **Entry.**
   - No ticket: `/ticket-draft` turns the idea into a draft; when the person says create it, `hl ticket new "{title}" --project {id} --size {S|M|L} --goal "{one line}"` scaffolds `ticket.toml` (stage `backlog`) and returns the id. Never invent an id.
   - Ticket exists: `hl context {T} --json`. Then `hl ticket claim {T}`; exit 1 means someone else holds it: stop and report, never retry.
2. **Mode** (`{T}` from context when omitted, else ask once):

   | Mode | Behaviour |
   |------|----------|
   | `staged` (default) | continue when clear; pause only on blockers or an interrupt |
   | `full` | same chain, terse hand-offs (`/do` uses this for a whole ticket) |
   | `plan-only` | stop after the planner; no builder |
   | `build-to-verify` | skip spec and planning; builder then verifier |

3. **Size.** Read `size` from the context; missing: the analyst runs `/spec {T} triage` first. **S** skips both challenges and plans one slice. **M and L** run both challenges as gates, and a person approves the plan before build.
4. **Dispatch agents, not skills.** Chain: **analyst -> planner -> builder -> verifier**; the fixer any time for verifier fixables; the deployer only when the person asks to publish. Advance a stage by **launching its role agent** with the ticket, the slice and a DONE check, then read the result. Never run a stage's skills yourself; each agent owns its step order. Call a skill directly only when no role owns it (`/progress`, `/close`) or the person named one. Without a host agent tool, launch with `hl run "{task}" --agent {role} --ticket {T}`.
5. Run each stage's tasks in waves (Waves inside a stage below), advancing per Advancing.
   - **Analyst and planner talk through the person, in order.** The analyst asks *what and why*, the planner *how*, each at the size's depth (`/shape` question depth). Relay an agent's question round to the person word for word, wait, and resume the **same** agent with the answers; never answer for the person. A planner question that is really a rule or scope change goes back to the analyst (`/spec {T} refine`), then planning resumes.
   - **Schema approval** (`/plan` Schema approval) is shown to the person before the planner slices: every mode, every size.
   - **Fresh-eyes critique (M and L).** `/challenge {T} spec` and `/challenge {T} plan` run as **their own task in a new agent** launched between stages. That agent gets only the ticket id, the stage and the DONE check, never the drafting agent's context. Findings go back to the analyst or the planner; then the challenge runs again in another fresh agent.
   - **Plan approval (M and L).** After the plan challenge is clear, the planner asks for approval; build waits until a person answers it.
6. **Continuation.** `hl blockers {T}` exits non-zero, or a CLARIFY item needs a product decision: stop at the affected gate. None: do not idle between stages; run through build and verify (unless `plan-only`).
7. **Closure.** Verifier disposition `ready_to_close`: `/close {T}` (M and L wait for the person's close approval). Then `hl ticket release {T}`.

### Waves inside a stage

Same orchestration as `/do` Step 3 (task list, `after:`, waves, ledger, re-checked DONE), with two differences:

1. **Stages are the outer sequence and not negotiable.** Stage *n* completes before *n+1*. Waves run inside a stage, never across one.
2. **Kickoff reads the task list; it does not invent one.** After the planner, lift slices and their order from `{T}-plan.md` Slices and their tasks from `hl ticket show {T} --json`. No slices or no tasks: a planning gap, send it back; do not improvise.

| Stage | Tasks |
|-------|-------|
| spec (analyst) | always one |
| plan (planner) | always one: one plan covering every project, slices tagged by project |
| build (builder) | one per slice or per project, riskiest slice first; slices with no cross dependency share a wave |
| verify (verifier) | one per project or test surface, usually one wave |

A one-task stage is just an agent launch, no ledger. **Cap:** at most 6 tasks per wave.

### Multi-project tickets

Two or more projects is the ordinary wave: one task per project, dispatched together in one message.

- Project set: the plan's Impact, then the ticket's project, then `hl where`.
- Kickoff owns the cross-project contract (API shape, data structures, config keys) and **settles it before the wave**; a project that needs it waits for the next wave.
- Each child: pinned working directory at its project root, its `CLAUDE.md` first, its own branch (ASK per project), its own build, no edits outside its project.
- Hand-off depth and spawn thresholds: [orchestration-rules.md](orchestration-rules.md).

### Advancing

- A task is done only when kickoff **re-checks its DONE**.
- A stage completes when every task is done **and** the stage gate passes (`hl ticket move` exits 0).
- **The ticket moves once per stage, never per task**, by the role agent that owns the lane.
- A verifier-fixable failure re-enters as a **new task in the current stage** for the fixer or the builder; no new stage, no move backwards.
- A failed task blocks its dependents; unrelated tasks finish. Never advance with a queued or failed task in the stage.

## Rules

### Hard stops

- Open blocking questions, bugs or gaps (`hl blockers {T}`), or CLARIFY items.
- A schema change without a person's approval: no slice, no build.
- M and L: no plan approval, no build; no close approval, no `done`.
- A "not feasible" or trade-off verdict from the analyst.
- Git: one ticket branch per project, cut only with approval (`/project-layout` Git).
- Any `hl` verb exiting 2: read the gate message and stop at that gate.

## Output

The report shape in `AGENTS.md`: one agent row per stage that ran, with what the stage produced. Two or more projects: say whether they ran in parallel. Name any task not done and its blocker.

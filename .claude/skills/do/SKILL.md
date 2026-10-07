---
name: do
description: Dispatcher for any free-form request. Routes it to the owning role agent or skill across all layers and loops until the goal is verified; add --gated (or say "step by step") to approve every step. Use when unsure which command fits, for remote runs, or to drive work step by step.
---

# /do

```text
/do {request}              # autonomous: stops only at the ACT/ASK boundary
/do --gated {request}      # every step waits for APPROVED (also "my way", "step by step")
```

**Reads:** `hl context`, `hl blockers {T}`, `hl skill find` results · **Writes:** whatever the dispatched agent or skill writes

Gates, ACT and ASK, board and report shape: `AGENTS.md`. This file is the route and the loop only.

## Steps

Read [dispatch-reference.md](dispatch-reference.md) when a routing tie, decomposition, multi-project fan-out or the loop driver is not obvious.

### Step 0: Observe (at most 3 reads)

Ticket known: `hl context {T} --json` (stage, size, blocked, open questions, next) and `hl blockers {T}`; an open blocker goes to Step 1. No ticket: `hl context --session`. Print `STATE:` in one line.

### Step 1: Clarify

Blocking unknowns: `/shape` (interactive) or one batched list of questions with a recommendation each (remote), then stop. A low-confidence route counts as one. Otherwise state at most 3 assumptions and go.

### Step 2: Route (first match)

| Request | Target |
|---|---|
| an explicit slash command typed | that skill |
| a rough idea with no ticket | `/ticket-draft` |
| a ticket with no stage named, or "end to end" | `/kickoff {T}` |
| requirements, intent, sizing | analyst `[{T}]` |
| the planning stage | planner `[{T}]` |
| one planning step: impact, design, slice, estimate | `/plan {T} {mode}` |
| implement, code, change a feature | builder `[{T}] [{slice}]` |
| test, review, merge-ready | verifier `[{T}] [{scope}]` |
| bug, broken behaviour, revise an artifact | fixer `[{T}]` |
| publish, deploy, stage | deployer `[{T}]` |
| build or test existing code, no change | `/project-layout run {skill}` |
| critique | `/challenge {T} {stage}` |
| questions, bugs, todos, gaps | `/trackers` |
| "where are we" | `/progress {T}` |
| read-only where, why, trace | answer directly (grep, read, `hl search`); 2 or 3 read-only agents in one message if broad |
| anything else | `hl skill find "{request}"` across all layers |

A ticket plus a stage verb ("plan T-014-sa") goes to that role agent, not `/kickoff`. Pass agents the ticket, the slice and an observable DONE check; never pre-compose their skill chain. `hl skill find` returns several matches, or one name in several layers: show each with its layer and description and ask which; never pick one silently.

### Step 3: Plan (only when it pays)

Decompose only when the goal needs 2 or more different agents, projects or stages; more than 8 tasks is a ticket, so use `/kickoff`. Write the list before dispatching:

```
{id}  {agent}  {what} -> DONE: {check}  [after: {ids}]
```

A **wave** is every task whose `after:` is satisfied, dispatched in **one message**. Two or more projects: one agent per project in the same message. Children never decompose. Print the ledger at each wave start and end, with the states `queued`, `running`, `done`, `blocked`, `failed`:

```
WAVE 2/3
done     T1  analyst   spec frozen
running  T3  builder   API: new field
queued   T5  verifier  cross-project acceptance   after T3,T4
```

### Step 4: Execute

Loop `DEFINE DONE -> ACT -> OBSERVE -> EVALUATE` per task or wave. Before each dispatch print one line: `-> {target}: {what this step does}`.

- An agent's "done" is evidence, not proof; re-check its DONE before marking it done.
- A failure blocks its dependents: retry once with a different tactic, then the fixer or an ASK; independent tasks keep running.
- Recurring or watch work: `/loop`, never a sleep loop.

### Step 5: Finish

Report. Do not write the work log per step: the Stop hook reminds the person once per session (`/log-work`).

## Rules

### Gated mode (`--gated`)

Same steps; the person releases each one. Interactive only, never remote or unattended.

- Every step proposes its increment and DONE check, then stops for `APPROVED` · `REVISE {text}` · `SKIP {reason}` · `STOP`. Agents are proposed and launched only after `APPROVED`.
- A decomposed plan is approved **once**; then each wave gets a thin go or no-go. A multi-project fan-out always gets its own gate.
- No autonomous retry: a failure comes back as a gate.
- Delivery work: gate each planning step (`/spec` freeze, then `/plan` modes by size); no build until `/challenge {T} plan` passes or is skipped with a reason.

```
GATE {n}: {name}
-> builder: {proposed slice}
DONE: {observable check}
APPROVED / REVISE / SKIP / STOP
```

### Both modes

- A schema change always stops for a person's approval after `/plan {T} design`; autonomous runs block the ticket (`hl ticket block`) and wait.
- Build, test and publish commands come from the project layer (`/project-layout`), never from memory.
- Split mixed requests: "fix and push" means ACT the fix, ASK the push.
- Exit code 2 from any `hl` verb is a gate: report it, never retry blindly.

## Output

The report shape in `AGENTS.md`. Name any decomposed task not done and its blocker; add a `Gates:` line when a gate was skipped or revised.

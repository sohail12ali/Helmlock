# /do: dispatch reference

Detail for [SKILL.md](SKILL.md), loaded only when routing, decomposition, fan-out or the loop is not obvious.

## Routing tie-breakers

- An explicit slash command: that skill, no re-classification.
- A ticket with no stage named: `/kickoff`. A ticket plus a stage verb ("verify T-014-sa"): that role agent with the ticket.
- **Compile versus write:** building or running existing code goes to `/project-layout run`; writing or changing code goes to the builder.
- **Publish versus compile:** publish, deploy and stage go to the deployer (it routes through the project's own skills).
- One planning mode on a ticket: `/plan {T} {mode}`. The whole planning stage: the planner.
- Feature-shaped with no other signal: `/kickoff`.
- Low confidence: ASK with 2 choices and a recommendation.
- A skill name found in several layers (system, workspace, project): list each with its layer and description, recommend one, and ask. A remembered preference for that name may be used.

Role agents own their step order (`.claude/agents/`). Work inline only when it is one file on one surface. Sending a message to a running agent beats a fresh spawn.

## Orchestration

Shared with `/kickoff`, which differs twice: a wave never spans a stage boundary, and tasks come from `tasks.toml` and the plan's Slices instead of the request.

- **Decompose** splits the *goal* into tasks with different owners; **spawn** (`.claude/skills/kickoff/orchestration-rules.md`) splits *one task* too big for one agent. A decomposed task may be spawned; a spawned child never decomposes.
- **A good task:** one owner · one observable DONE ("the API returns the new field", not "API updated") · carries the *decision* a dependency produced, never "see T3's output" · names its project in multi-project work.
- **Waves:** a linear chain is waves of one. Do not pad a wave with a ready task whose other dependency is risky. If one task in a wave fails, verify the survivors before deciding; never discard completed work.
- **Re-plan** only when a task returns something the plan assumed away (a missing data structure, a contract that does not exist, a repo outside the workspace). Keep done tasks, rewrite the unstarted tail, say in one line what changed.

| Stop when | Action |
|---|---|
| every task is done and the goal check passes | finish and report |
| a task fails twice | fixer or ASK, naming the blocked tasks |
| a task needs a product decision | ASK; other branches keep running |
| more than 8 tasks after a re-plan | stop; propose `/kickoff` |

## Multi-project fan-out

Project set, first hit wins: the plan's Impact, then the ticket's project, then the folders `hl where` reports.

- One child per project, all agent launches in one message. Brief: the project root (pinned working directory), the ticket, the slice, the cross-project contract and its own DONE check.
- **Child:** works only inside its project root, after reading that project's `CLAUDE.md`.
- **Parent:** owns the shared contract (API shape, data structures, config keys), merges results and checks the cross-project result. DONE is the cross-project check, not the last child returning.
- **Pipeline, not fan-out:** if project B cannot compile until project A ships a contract, settle the contract first.
- Without a host agent tool (for example a headless Cursor run), launch each child with `hl run "{task}" --agent {role} --ticket {T}`.

## Loop driver

- Up to 3 varied tactics per task. Record each failed approach and its lesson in one line with `hl ticket comment {T} "tried: ... lesson: ..."`; never status or retest notes (those are bugs and test reports).

| Condition | End |
|---|---|
| goal achieved and verified | finish and report |
| 3 failed attempts | ASK: stuck |
| context above 80% | record open questions with `hl question add`, `STATUS: in progress`, suggest a fresh session |
| hard stop | abort with the deferred list |
| hand-off depth above 2 | escalate to the person |

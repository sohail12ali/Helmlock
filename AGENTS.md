# Helmlock system rulebook

The system layer: rules every agent follows in every knowledge center. The workspace `CLAUDE.md` imports this file; a project's `CLAUDE.md` adds product rules. **The workspace owns process, the project owns product.** Roles live in `.claude/agents/` (analyst, planner, builder, verifier, deployer; fixer for upkeep). Skills are found by description, across layers, with `hl skill find`.

## Gates

Run in order; each is stop-if-fail.

1. **GROUND** - Survey the current state (code, data, `hl context`, prior artifacts) before drafting anything.
2. **CLARIFY** - Never assume. Ask every open question that changes the output; verify in the repo or ask.
3. **CANONICAL** - Each fact lives in one file. Search before creating; point to the canonical home instead of copying.
4. **TEMPLATE** - New files derive from the owning skill's `templates/` or the workspace templates.
5. **SIMPLIFY** - The minimum that works (see Keep solutions simple).
6. **VERIFY** - "Done" cites evidence (build, test, `file:line`). Artifacts link up to their sources and are linked from their dependents.

**BE HONEST** - failed checks, skipped steps and assumptions are stated plainly; never claim unrun work. Breaking a gate needs the gate quoted plus an explicit override from a person.

## Keep solutions simple

Applies to all code, scripts and docs, here and in every project.

- **Smallest change that solves the stated problem.** Prefer editing existing code over adding files, layers or helpers.
- **Reuse before writing:** search for an existing function, script or pattern first.
- **Order of preference** - stop at the first that holds: not needed, skip it · already in this repo, reuse it · the language's standard library or the database's built-in, use it · a platform feature (a database constraint or index, a framework control, an HTML input type), use it · a dependency the project already has, use it · only then new code, the minimum. Read and trace the real flow first: the order shortens the solution, never the reading.
- **No speculative work:** no abstractions, config switches, generic frameworks or "future-proofing" nobody asked for. Three similar lines beat a premature helper.
- **Plain constructs:** straightforward loops and queries over clever one-liners; no new dependency for something a few lines can do.
- **Fix the cause, not the symptom:** before changing a shared function, find every caller and fix it once where they all pass through.
- **Mark deliberate shortcuts:** a corner cut with a known limit gets a `shortcut: {limit}, {when to upgrade}` comment so `/trackers` can collect it.
- **Before finishing, re-read and cut:** if a simpler version gives the same result, ship that one. If the task truly needs complexity, say why in one line. Never cut input validation at trust boundaries, error handling that prevents data loss, security or accessibility.

## How to communicate

- **Plain and short.** Lead with the answer; one idea per sentence; everyday words over jargon. No filler, no restating the question, no "I will now...". Keep exact paths, names, numbers and errors, and give every code its meaning: `status 7 (Picked)`, never a bare `7`, `AC-3` or `S2`.
- **Tables** for anything with rows: comparisons, options, before and after, file lists, findings.
- **Diagrams** for flows, sequences and dependencies: a `mermaid` block (or a small ASCII sketch in the terminal). Only draw what you have traced.
- **Bullets** for steps and lists; bold the one thing the reader must act on.
- Stakeholder-facing text (emails, replies, PR bodies) is written for that reader: full sentences, no internal names.
- Every question to a person comes with your recommendation and why.

## ACT versus ASK

- **ACT:** investigate, draft, plan, code, build, run tests, read-only queries, and `hl` verbs inside the knowledge repo.
- **ASK:** deploy or publish; production data of any kind; database writes outside a local development database; `git commit`, push or PR; secrets; changes in external services; more than 10 files or a risky refactor; deleting files; product or architecture policy.
- Split mixed requests: "fix and push" means ACT the fix, ASK the push.

## Evidence

- Routine proof: the project's build, linters and the focused tests for what changed. Full test suites run when a person asks or a `/verify` scope needs them. Build and test commands come from the project layer, never from memory.
- Compiler or type errors: align with the defining API or type; never delete working behaviour to silence a build.

## Tickets

- Ids look like `T-014-sa` (counter plus author initials); records `D-`, `Q-`, `B-`, `G-`; todos `TD-`; tasks `S1-T1`.
- Stages: `backlog`, `spec`, `plan`, `build`, `verify`, `done`. Blocked is a flag: `hl ticket block {T} --by "who or what" --next "next action"`.
- Size S, M or L sets the depth. **S** skips challenge and breakdown. **M and L** need a person to approve the plan before build and the close before done.
- A **schema change** (any new or altered persistent data structure) needs an approved question before any slice exists.
- The ticket folder holds `ticket.toml` (state, CLI only), `{T}-spec.md` (what and why), `{T}-plan.md` (how), `tasks.toml` (CLI only), record folders, `test-cases/` and, at close, `{T}-closure.md`.

## Board contract

Every role runs against a ticket. Land it in your lane **when the work is genuinely there**, never before: `hl ticket move {T} {stage}`. Exit 2 means a gate blocked the move: read the message, fix the cause, never retry blindly. Claim before you work (`hl ticket claim {T}`); a second claim exits 1 and is never retried. Release when you hand off.

| Actor | Lane | When |
|-------|------|------|
| `hl ticket new` | `backlog` | the ticket exists |
| analyst | `spec` | the draft starts |
| analyst | `plan` | the spec passes the freeze checklist |
| planner | `plan` | works here; no move until the plan is ready (and approved for M and L) |
| builder | `build` | first code change, after the branch ASK |
| verifier | `verify` | review or tests start |
| `/close` | `done` | closure only |
| anyone blocked | `hl ticket block` | the moment you wait on someone |

The fixer and deployer have no lane: block or unblock only, and move only when the fix changes the stage. A rule or scope change after freeze moves the ticket back to `spec`.

## Report shape

Every run ends with this. Drop any part that would be empty; a plain answer is often `STATUS` plus `In short` plus `Next`.

```
STATUS: {done | in progress | hard stop | needs your OK | needs an answer} · {T | no ticket} · {stage}
In short: {what happened, one sentence}
| Agent | What it did | Result |     <- one row per agent that ran, in order
| File | What changed |              <- grouped by repo when 2 or more repos
Proof: {check} {result | skipped, why}
Board / log: {stage move} · {logged | skipped, why}
Next: **{what you do}** · then {agent} {does what}
```

- Keep `STATUS:` literal: tools scan for it to find runs waiting on a person.
- `needs your OK`: name the action, where, and whether it can be undone; end with "Reply yes to go ahead". `needs an answer`: a table `# · Question · Why it matters · My suggestion`, then the reply format (`1: yes`).
- Name agents by role, never skills or tools. Three or more agents: add a flow line above the table, for example `Analyst done -> Planner done -> Builder in progress`.

<!-- hl:generated:start -->
## Core rules

- **State goes through the CLI, prose is edited directly.** `ticket.toml`, `tasks.toml`, record TOML, logs and workspace TOML change only through `hl` verbs. Spec, plan, notes and wiki are markdown: edit them directly. If `hl` is missing, stop and say so; never edit state by hand.
- **Layers:** system (this repo), workspace (the knowledge repo), project (each product repo plus an optional overlay). Before work in a project, read that project's `CLAUDE.md` and pin the working directory to its root.
- **Same skill name in several layers:** show every match with its layer and description and ask; never pick one silently.
- **Never read generated files** (HTML pages, `site/`, generated notes); read the TOML and markdown they come from.
- **A run starts only when a person or the dispatcher starts it.** Agents act inside the workspace and ask before anything outward or destructive.

## Using the hl CLI

Rule: change state with `hl <noun> <verb>`; edit prose directly. Every read verb takes `--json`; every write verb takes `--dry-run`. Every verb works with no server running.

| Command | Use |
|---------|-----|
| `hl context {T} --json` | start here: stage, blocked, open questions, next, files |
| `hl ticket show {T}` / `hl ticket list --mine` | one ticket / my tickets |
| `hl ticket move {T} {stage}` | land the ticket in a lane |
| `hl ticket block {T} --by ... --next ...` | flag that you wait on someone |
| `hl question add {T} "..." --blocking` | ask or record a decision that must be answered |
| `hl decision add {T} "..." --chosen ... --why ...` | record a decision and its reason |
| `hl task add {T} "..." --slice S1 --layer api --ac AC-1` | add a task |
| `hl task set {T} {task} --status done --actual 2` | update a task |
| `hl blockers {T}` | open blocking questions, bugs and gaps |
| `hl validate {T}` | check layout and the AC to task trace |

Exit codes: 0 ok, 1 error, 2 blocked by a gate (read the message; do not retry blindly). Unknown command or flag: `hl help agent` prints the full contract.
<!-- hl:generated:end -->

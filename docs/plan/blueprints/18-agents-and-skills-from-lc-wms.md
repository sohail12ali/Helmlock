# Blueprint 18: agents and skills, starting from lc-wms (draft)

Your lc-wms config is the refined set (37 skills, 6 agents); control-center is its older ancestor (39 skills, 7 agents). This is the lite selection: what stays in the **system** layer, what moves to the **workspace** or **project** layer as examples, what merges, what is dropped. Cards: F117 (base set), F5a, F16, F15.

## Agents (system layer): the six from lc-wms

| Agent | Role | Calls | Stage |
|---|---|---|---|
| analyst | what and why, never design | ticket-draft, spec (triage, draft, refine, freeze), shape for L, challenge spec | requirements |
| planner | how, never code | plan (impact, design, slice, estimate), challenge plan, validate; a schema approval is a hard stop | planning |
| builder | code one slice | create-branch (ask), progress, project-layout run | build |
| verifier | review first, then tests | challenge implementation, verify cases and scopes | verify |
| fixer | one to three file fixes and upkeep | fix, fix --revise, evolve, close | any |
| deployer | publish and stage (generic skeleton) | project-layout run, plus workspace release skills | release |

- Agent file shape: **Scope / Never / Steps / Rules / Hand-off**, linted. Output is the shared Report shape with a literal `STATUS:` line.
- No orchestrator agent: the `do` and `kickoff` skills orchestrate (lc-wms dropped the control-center harness agent on purpose).
- **Take from control-center:** least-privilege `tools:` and `model:` frontmatter (planner has no shell, deployer cannot write files) and the verifier's `Disposition: ready_to_close | needs_fix | blocked | needs_human`.

## System skills (14) after merging

| Skill | What it does | Notes |
|---|---|---|
| do | Route a free-text request, loop until done, `--gated` mode | The route table is data in the workspace layer |
| kickoff | Drive the phases; absorbs prepare-ticket | Modes: staged, full, plan-only, build-to-verify; size S skips challenges |
| ticket-draft | Turn an idea into a lightweight draft | Use the generic control-center version; the tracker-coupled bits move to the workspace |
| spec | Triage, draft, refine, freeze requirements | One living file with a Decisions table; trim the stored-procedure wording |
| shape | Question rounds, confidence gate; absorbs clarify | For large tickets |
| plan | Impact, design, slice, estimate | Schema and stored-procedure design and the WMS layer table move to the project layer; add the "fewest tasks, qualifying boundary" rule from control-center |
| challenge | Five-lens red-team in three stages | Replaces four control-center challenge skills and the router |
| progress | Task status wrapper | |
| verify | Test cases and readiness | The .NET unit, integration and e2e scopes move to the project layer |
| fix | Root cause and minimal patch, or `--revise` | |
| trackers | Questions, bugs, todos, gaps, critique | One skill over the CLI verbs |
| close | Closure gates; merges close-ticket, close-work and validate-artifacts | Gate order from control-center, release-notes gate from lc-wms |
| log-work | One-line work log, with a summary mode | Absorbs work-summary; key tables move to the workspace (Blueprint 14) |
| project-layout | Repo routing and `run {id}`; absorbs invoke-project-skill | The registry moves to workspace.toml |

Optional extras: evolve (harness maintenance, lint and papercuts), trace-context (a thin one-call digest, which becomes `hl context`), the caveman toggle (terse output), a trimmed ticket-CLI contract (from kanban or console).

## Workspace-layer examples (team, domain, integration)

| Skill or file | Why it is not system |
|---|---|
| projexa | Tracker sync (Projexa-specific) |
| create-branch | Your team's git model and branch bases |
| add-workspace-repo | Clones and registers repos, ShopLC-specific |
| log-work key tables | WLC and AMS ticket keys, team billing |
| ticket-draft persist notes | Coupled to the tracker |
| investigate | Production-support loop; use the generic control-center classify-with-proof as the system candidate |
| tech-select | Researched technology picks with approval and a decision log; trim |
| standup | Cross-ticket digest, cheap |
| archify | Optional HTML diagrams via an external tool |

## Project-layer examples (product specific)

database-operations, graph, plan design (schema and stored procedures), the WMS layer table, verify .NET scopes, generate-e2e-tests, ams-create-order, ams-web-create-order, migrate, new-carrier-integration, prepare-release-email, prepare-release-sql, stage-release, sync-slcdcripts-mirror, update-shipping-algorithm.

## Merged or dropped

| Item | Verdict |
|---|---|
| prepare-ticket | Merged into kickoff |
| requirements, analyze, clarify (control-center) | Merged into spec and shape |
| challenge-requirements, -plan, -implementation, criticize, challenge-standards | Merged into challenge |
| breakdown-tasks, analyze-components, replan, estimate | Dropped; keep only the task-boundary rule and the PERT idea |
| handoff, reconcile | Merged into agent Hand-off lines and close |
| questions, bugs, todos | Merged into trackers |
| work-summary | Merged into log-work |
| validate-artifacts | A verb called by plan and close |
| consolidate, template, progress-tracker | Dropped or merged |
| Name clash: evolve (lc-wms is harness upkeep, control-center amends a frozen artifact), kickoff (lc-wms orchestrates, control-center scaffolds) | Use the lc-wms meanings; the control-center evolve becomes `spec refine` and `fix --revise` |

## The skill format contract (keep, with the lint)

- Frontmatter: `name` equals the folder name; `description` is 40 to 300 characters and contains a "Use when" clause.
- Body: `# /name`, a usage block, one `Reads / Writes` line, then exactly `## Steps`, `## Rules`, `## Output`. No version footer. Target at most 150 lines.
- Siblings linked from Steps as "Read X when Y": `reference.md`, `{mode}.md`, `techniques.md`, `templates/`, `evals/*.json`, `scripts/`.
- A folder of scripts with no SKILL.md is whitelisted as not-a-skill.
- Hooks to keep: SessionStart context digest, Stop (reminder to log work), PostToolUse layout validation.

## Always-on rules to keep verbatim from the lc-wms CLAUDE.md

The six gates in order (ground, clarify, canonical, template, simplify, verify); the BE HONEST sentence; "keep solutions simple" with its order of preference and `shortcut:` markers; "how to communicate" (plain and short, tables, diagrams); ACT versus ASK lists; evidence; the board contract with lanes parametrised per workspace; the Report shape with a literal `STATUS:` line. The terse "caveman" voice stays only in `do` lite, with exceptions for security, irreversible steps, ask gates and test failures. Repos, commit initials, special tickets and tracker rows move to the workspace layer.

## The chain, as lc-wms runs it

ticket-draft, then tracker create, prepare-ticket, create-branch, `kickoff`. Requirements (analyst): spec triage, shape for L, draft, refine, challenge spec for M and L in a fresh agent, freeze. Planning (planner): impact, design with the schema approval stop, slice, estimate, validate, challenge plan. Build (builder): branch (ask), progress per task. Verify (verifier): challenge implementation, review, test cases, tests. Close and release: close, deployer (workspace release skills), log-work.

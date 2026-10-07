# Paperclip README: what it adds to the gap analysis (iteration 12)

Source: the GitHub README (fetched and checked against the local copy; the content matches). Verdicts: **Have**, **Added** (new card or option), **Later**, **Skip**.

## How Paperclip describes itself

"The app people use to manage AI agents for work": a control plane that orchestrates agents into a company. Four pillars:

| Pillar | Covers | Our position |
|---|---|---|
| Agentic Task Manager | Tasks, approvals and review gates, proactive agent coworkers, routines, verifying output from diffs and tests | Have (tickets, gates, verify); gates widened in F96 |
| Org Chart for Agents | Roles, permissions, delegation, governance, scoped secrets, connection permissions, responsible-user identities | Roles and permissions Have (F5a, F14); connections Added (F98); org chart Skip |
| Agent Employee Training | Skill Studio, evals, learning loops, quality metrics, performance reviews, version history, team templates | Skill tests F69; quality loop Added (F99); version history is git; templates F71 |
| Agentic OS | Any model and agent, sandboxing, MCP, SSO and RBAC, cost controls, privacy, traces | Provider layer F72; MCP F41; costs F78; SSO and RBAC Skip |

## Feature by feature

| Paperclip feature | Plan | Verdict |
|---|---|---|
| Bring your own agent (any runtime) | Runtime adapters F5c, F41 | Have |
| Goal alignment, goal-aware execution | F7b goal link | Added F94: goal chain in the context digest |
| Heartbeats: agents wake for assigned work, follow-ups, schedules | F5c, F65 | Added F97: manual first, runner plugin later |
| Cost control and budgets | F78 | Have |
| Multi-organization | Separate knowledge repos | Skip |
| Task threads: conversation, plans, blockers, files, run history | Comments verb only | Added F95: thread and runs on the ticket page |
| Governance and review gates, hire approvals, pause or stop work | F14, F5g, F46 | Added F96 (gate types, plan approval); kill switch added to F65 |
| Org chart | Roster only | Skip |
| Mobile ready | F68, F82 | Have |
| Apps and connections: Allowed, Ask first, Off per action | F14, F41 | Added F98 |
| Shared agents with personal accounts; responsible-user attribution | F93, F70 | Added: agents use the person's own account; audit records on-behalf-of |
| Skills and Skill Studio: test with saved inputs, version history, restore | F69 | Have (light); history from git |
| Scheduled routines (cron, webhook, API) | F18 | Later |
| Artifacts and feedback: preview, anchored comments | F2b, F29 | Anchored comments Added as F100 (optional) |
| Ready-made teams | F71 | Added: starter packs at onboarding |
| Agent chat and chat or email connectors (Telegram, Slack, Discord) | F4, F11 | Have; Telegram is core for us |
| Plugins with out-of-process workers and capability gates | F40 to F48 | Have |
| Secrets and storage | F9b | Have by reference |
| Activity and events | F70 | Have; on-behalf-of added |
| Company portability with secret scrubbing | F71 | Have as packs |
| Atomic task checkout | F7d | Have |
| Runtime skill injection | F91 | Have |
| Governance with rollback, revisioned config | git | Have via git history |
| Test-drive: isolated temporary instance | F1b | Added: `hl try` |
| "Just ask your agent to install Paperclip" | F1a | Added: agent-led setup |
| Observability: opt-in OpenTelemetry, Sentry, anonymous telemetry | none | Skip (no telemetry) |
| Docker deployment, Tailscale remote access | open question | Later |
| Roadmap done: deep planning with plan approvals, enforced outcomes, self-healing runs, multi-harness teams, company search | F96, F65, F5c, F2e | Covered |
| Roadmap planned: Work Queues, Maximizer, Self-organization, Organizational Learning, Desktop app, bring your own ticket system | F7e, F99 | Later or Skip |

## What Paperclip says it is not (useful non-goals for us)

Not just a chatbot, not an agent framework, not just a workflow builder, not a prompt manager, not limited to one agent, not only for code. Adopting the same stance for Helmlock is an open question (assumed, to confirm).

## Biggest takeaway

Paperclip's promise is "add a task, an agent works until it is done, you review". For Helmlock that is the unattended-runs card (F97): worth keeping as a plugin slot, not v1. It only makes sense after supervision (F65), budgets (F78), gates (F96) and the identity rule (F98) exist.

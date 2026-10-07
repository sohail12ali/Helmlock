# Paperclip, seen running (iteration 19)

Explored your local instance at `127.0.0.1:3100/NOB` in read-only mode: dashboard, agents (instructions, skills, runtime, tools, permissions, runs), skills, connectors, tasks and a task thread, inbox, runs, costs, routines, projects, artifacts. Nothing was created or changed. The instance had one company, four agents, eight tasks and about 84 million tokens of usage, all on a Claude subscription.

## What I saw, and what we can use

| Area | What it does there | Use for us | Plan |
|---|---|---|---|
| **Agent as a named employee** | Name, role, title, reports-to, an adapter (Claude Code), model, thinking effort, execution engine (Claude CLI or ACP), run policy, a "Test your agent" check, "Run with provider trace" | Names and roles for our six agents; a test check before the first run | F5a, F63 |
| **Instructions as files** | Each agent has an `AGENTS.md` entry file plus extra files, with Read, Edit and Raw views and revisions | Same shape as our agent files in `.claude/agents`; revisions come from git | F15 |
| **Per-agent skills** | An organisation skill library with "Enabled for N agents"; each agent toggles its own skills; "Applied on next run"; a skills store; skill folders | Per-agent skill lists in the agent file (F132) | F132 |
| **Bundled skills** | `paperclip` (API protocol), `paperclip-board` (manage everything through chat), `paperclip-converting-plans-to-tasks` (decide if delegation is needed, owners and real dependencies), `paperclip-create-agent` (governance-aware hiring), `para-memory-files` (file-based PARA memory), `first-task` (guide the first task) | Our plan skill already slices; the board skill is our assistant managing tickets by verbs; PARA (Projects, Areas, Resources, Archive) matches `projects/`, `shared/`, `archive/` | F118, F115 |
| **Tools and context cost** | "Installed apps load tools into context on every run. Permitted-only apps add no context cost." Tool profiles and policies decide the effective allow list | Strong support for CLI-first (F57): MCP tools cost context every turn; a CLI costs nothing until called | F57 |
| **Trust presets** | Standard and Low-trust review; flags for creating agents, importing skills, assigning tasks | Low-trust preset for runs from Telegram and imported text | F66 |
| **Connections** | 39 connectors across three catalogs; AI accounts (Anthropic, OpenAI, OpenRouter, Grok); "My Claude subscription" connected by the board; "responsible user's connection"; custom MCP | Connections per person: subscription login or API key; the responsible person's connection runs the task | F98, F72 |
| **Task thread** | Description, activity rows ("5m 9s, 22 tools"), documents with revisions, agent comments, a composer to message the assignee with an agent and model picker | The ticket page Thread and Runs tabs | F95 |
| **Properties panel** | Status, assignee, project, labels; relationships (parent, blocked by, blocking, subtasks); execution roles (reviewers, approvers, monitor, watchdog); originating, started, created | Add reviewers, approvers, monitor and watchdog to tickets; relationships already planned | F96, mockup 3 |
| **Interaction cards** | The agent asks the human a structured question as a card with options; a card can be withdrawn; answering resumes the work | Agent questions as cards on the ticket (F133), also as Telegram buttons | F133 |
| **Task list** | A tree (parent and child), status icons, a "Recovery needed" badge, list and board views, filters, sort, group | A tree view of tickets and slices | F7f |
| **New task** | One line: describe it, pick the project, the assignee and the model, send | A one-line quick add in the console and the assistant | F118 |
| **Runs** | A list with trigger chip (Automation, Assignment, On demand), tokens and the first line of the result; a detail with status, inspect, re-run, "on behalf of Board", duration, tasks touched | Run records with trigger, tokens and result line (F95) | F95, F134 |
| **Costs** | Inference spend, 84.0M tokens, per agent in and out tokens, "0 api, 38 subscription" billing types, by project, a finance ledger | Track tokens even when the dollar cost is zero; billing type per call | F78 |
| **Dashboard** | Agent cards with the live or last task, four stat cards, run activity, tasks by status, success rate, recent activity | Already in our overview mockup; add the live agent cards | F84 |
| **Onboarding** | A seeded first task, "Paperclip onboarding", assigned to the chief-of-staff agent, which asks questions with cards | Onboarding as the first ticket, led by an agent | F1a |
| **Agent instructions style** | "Lead with the answer. Never narrate tool calls. Terse. Simple English (ASD-STE100)." | Chat hygiene rules for our assistant persona | F11f |

## What not to copy, and a warning

**Wasted wake-ups.** The runs page shows dozens of "Automation" runs of 27k to 130k tokens each, with results such as "Nothing new came in. The comment that woke me is a word-for-word copy of my own." The agent's own comment woke it again, repeatedly. Across four agents that adds up to 84 million tokens (billed as subscription, so $0.00, but still quota and time). Lessons: a wake caused by the agent's own comment or an unchanged state must do nothing; one active run per ticket; per-agent token caps; show tokens and trigger on every run. This is F134.

**Status writes that fail.** One run reported `401 Empty bearer token`: the agent could not write its status and the task sat at "in progress" when it should have read "in review". Later runs say "verified by re-reading it after". Lesson: after a state write the agent re-reads it, and a failed write becomes a visible blocked state, never a silent mismatch (F65, F57).

Also skipped: the org chart, multi-company switching, the connector catalog, Postgres, and the permissions extension.

## Does it overlap with Helmlock?

Partly. Paperclip is an agent-management control plane (who works, with what, at what cost). Helmlock is a delivery and knowledge system (tickets, specs, shared knowledge, files in git, Obsidian). They could coexist: Helmlock tickets and knowledge as the source of truth, an agent runner such as Paperclip (or Claude Code or Cursor directly) doing the runs. That is an open question in the plan.

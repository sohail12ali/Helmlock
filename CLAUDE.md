# Helmlock

Project is in the **idea stage**. No code yet. The goal right now is to shape the idea with the user, then decide what to build and how.

## Working style

- The user dictates by voice, so expect rough, run-on phrasing. Interpret intent and confirm anything ambiguous.
- Do not jump to implementation. Capture and refine the idea first.
- Keep replies short. Put the detail in the plan HTML.
- Every question to the user comes with my recommendation and why. Never ask without one.

## Planning workflow

Use the `/plan-board` skill (`.claude/skills/plan-board/SKILL.md`). The plan lives as small source files in `docs/plan/` and is built into `docs/plan.html`. Start with `python .claude/skills/plan-board/build.py --status`, edit only the source files you need, rebuild, never read or edit `docs/plan.html`. Update after every meaningful exchange; never start a fresh plan.

## Decided design rules

- Names: the system is `helmlock`, knowledge repos are `<product>-knowledge`, the CLI is `hl`. Windows first; nothing Windows-only in the core. Non-goals: not an agent framework, not just a chatbot, not a prompt manager, not multi-tenant, not a hosted service. Remote access is Telegram only; the console binds 127.0.0.1 (reach it over Tailscale), no login.
- Two independent repos: a delivery repo (skills, agents, console, generic templates) and a knowledge repo (workspace root: artifacts, logs, wiki, workspace config). The delivery repo must not hold any information about any knowledge repo. The knowledge repo picks the delivery repo and the projects; the console is told the workspace at launch.
- Stack (F0a decided 2026-10-07): TypeScript everywhere (Node 24, pnpm workspace with core, cli, server, ui; shared Zod schemas; Hono; React 19, Vite, Tailwind 4, shadcn/ui). A full rewrite of earlier Python is accepted. Dependencies are allowed if maintained over time (rules: F147). Python is only an optional plugin language, run as a separate process. Agents never read the UI code in daily work (Blueprint 23).
- Core plus plugins, modelled on deepseek-harness "everything is a plugin" (copy the mechanism, not the ceremony; F40 decided 2026-10-07: plugin container; mechanics open: F101 to F108): a kernel of about 500 lines (context tree, service registry with requires, scoped effects with dispose, events). Everything else is a plugin that provides a service; the file layer, verb registry and approval gate are required built-ins. CLI, agent pack, runtime, assistant, voice, channels, ticket model, workflow (statuses) and views are replaceable plugins. Built-ins ship in the delivery repo; the knowledge repo's `workspace.toml` enables and configures them and may declare its own plugin folders (F43). Packs are TOML, markdown and templates; code plugins are TypeScript; other languages run as a separate process. The core never names a stage, agent, model or channel.
- Formats: Markdown for prose, TOML for structure (written only by verbs), JSONL for history, generated HTML for humans. JSON and YAML only where a host requires them. Agents never author HTML or CSS.
- Files only, no database: everything is plain files in git so teams can share the knowledge base. A ticket is one folder (`ticket.toml` plus markdown). Records that people edit together are one file each. Any index is a generated file. The knowledge repo is also an Obsidian vault; a verb writes markdown notes from the TOML, and those notes are what Obsidian graphs. The default workflow pack is backlog, spec, plan, build, verify, done; blocked is a flag. A closed ticket gets a short digest. Archive and delete are verbs with a dry run, never a timer.
- Three layers of CLAUDE.md, skills and agents: system (delivery repo), workspace (knowledge repo), project (each project, optional overlay in the knowledge repo). The workspace owns process, the project owns product. The dispatcher finds skills across layers with `hl skill find`: paths come from the `.code-workspace` folders, and `workspace.toml` maps folders to layers. If a skill name exists in several layers, all are shown with their layer and description; nothing is picked silently.
- Agents and skills start from the lc-wms config (refined by you): six agents (analyst, planner, builder, verifier, fixer, deployer) and fourteen system skills. Skills are thin except spec and challenge. Agents act inside the workspace and ask before anything outward or destructive. A run starts only when a person or the dispatcher starts it. Domain skills live in the workspace and project layers (Blueprint 18). Repos are found from the VS Code workspace file (`Name.code-workspace`, started from `Name.code-workspace.template`). Opening that file loads the knowledge repo, the delivery system, and the project folders in VS Code, Cursor, Antigravity, or any editor that reads it. A gitignored `.env` in the delivery repo names only the default knowledge workspace. Only `hl init` and `hl project add` write the workspace file (dry run, confirm). `hl where` prints what was resolved. Every CLI verb works with no server running; Telegram needs `hl serve`. Core, CLI and server run from source with no build; the UI is built once locally.
- Work log: one TOML file per person per day in the knowledge repo, as in lc-wms and control-center. The author is read from the roster, never guessed.
- UI: control-center style with a resizable shell (drag to resize, collapse) and phone, tablet, and desktop widths. Tailwind 4 and shadcn/ui. A light and a dark palette only; the console follows the system setting, with a toggle. Ticket pages are written to files and also served live. Every screen gets a wireframe, including a phone width, before it is built (mockups live in the plan).
- Assistant: one OpenAI-compatible layer. Chat, search, and verbs with confirmation. Telegram long-polls with an allowlist. Voice in v1 is a mic button in the console, then a refine step. Clipboard and screenshots ask first and never run from Telegram.
- Cursor CLI integration is required alongside Claude Code (F31 decided). One harness source generates both hosts' config; skills and agents stay in `.claude/` with portable frontmatter; `AGENTS.md` is the canonical rulebook and `CLAUDE.md` imports it (Blueprint 21).
- Claude Code is the host: rules in `CLAUDE.md`, skills in `.claude/skills`, agents in `.claude/agents`.
- One delivery center, many knowledge centers (Blueprint 22). Each knowledge center is its own repo and its own `.code-workspace`; opening that file loads its projects, console, and system. A console serves one knowledge center at a time (F138). A knowledge center starts from a versioned base template and keeps growing it, tracked in `template.toml`; upgrades are dry-run and never overwrite local growth; sharing is an explicit `hl template promote` patch, never automatic (F139, F142).
- A project is the unit of knowledge: `projects/<id>/` holds `project.toml`, a hub note, a wiki, `nodes/` (the project graph) and an optional overlay (F143). The graph is typed markdown nodes with outgoing edges only; inverses, index and lint are generated, and agents mark missing facts `UNVERIFIED`.
- v1 scope (Blueprint 25): agents run on Claude Code and Cursor; onboarding is CLI-only; the lite workflow only. Chats, usage, transcripts and audio stay on the machine (gitignored). Agents may not edit knowledge-repo state files directly; product repos are unrestricted.
- Token cost is a constraint: agents read compact source files (TOML, markdown, JSONL); HTML is generated for humans and never read by agents.

## Git

- Repo initialized in this directory.
- A hook blocks edits on `main`/`master`; work on a feature branch (currently `setup/initial`).
- Commit only when the user asks.

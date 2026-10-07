<p align="center"><img src="docs/assets/helmlock-icon.svg" width="96" alt="Helmlock icon: a padlock with a ship's helm as its keyhole"></p>

# Helmlock

Helmlock is a delivery system for teams that work with coding agents (Claude Code and the Cursor CLI).
Tickets, decisions, work logs and the project wiki live as plain files (TOML, Markdown, JSONL) in a git repo you own: the knowledge repo.
One CLI, `hl`, is the only writer of state; agents, people, the web console and a Telegram bot all go through it.
This repo is the delivery repo: the CLI, the plugins, the agents and skills, the console and the templates. It holds nothing about any knowledge repo.
Every `hl` verb works with no server running; `hl serve` adds the console, agent runs from the browser, the assistant and Telegram.

## Requirements

- Node 24.11 or newer (code runs through Node type stripping; no build step for the CLI)
- pnpm 9 (`corepack enable pnpm`)
- git
- Optional: ripgrep (`rg`, faster `hl search`), Claude Code (`claude`) and/or the Cursor CLI (`cursor-agent`) for agent runs

## Install

```sh
git clone <this repo> helmlock
cd helmlock
pnpm install --frozen-lockfile        # install scripts are disabled in .npmrc (F147)
git config core.hooksPath .githooks   # pre-commit: Biome and hl harness lint
node packages/cli/bin/hl.ts doctor    # checks node, pnpm, git, rg, claude, cursor agent
```

## Start a knowledge center

```sh
node packages/cli/bin/hl.ts init ../acme --name Acme --author "Sam Abbott" --initials sa --email sam@example.com
cd ../acme
./hl where          # hl.cmd on Windows cmd; both launchers point back at this delivery repo
./hl doctor
```

`hl init` writes the base template, your roster entry, the launchers `hl` and `hl.cmd`, generates the Claude Code and Cursor config from `harness/harness.toml`, makes the first commit and sets `core.hooksPath` to `.githooks` (the pre-commit hook runs `hl validate` on the ticket folders you staged and `hl harness sync --check`). In a fresh clone, `hl doctor --repair` sets the hooks path again.

Open `Acme.code-workspace` in VS Code, Cursor or any editor that reads it: it loads the knowledge repo, this delivery repo (folder `system`) and your project folders (`hl project add <folder>`).

## Daily use

```sh
./hl ticket new "Gift card redemption" --size M
./hl ticket list
./hl run "Write the spec for T-001-sa" --ticket T-001-sa --agent analyst     # headless Claude Code, plan mode by default
./hl run "Build slice 1" --ticket T-001-sa --runtime cursor --mode auto-review
./hl serve --open   # console on http://127.0.0.1:4317 (localhost only)
```

`hl run` modes climb a ladder: `plan` (read only), `ask` (every gated tool asks a person), `auto-review` (edits allowed, the rest asks), `force` (terminal only). Run records go to `runs/<id>.json` (gitignored). Agents never edit state files directly; a protected-path check after each run fails a run that tried.

## The knowledge repo

```
Acme/
  workspace.toml                 plugins and settings shared by the team (written by hl config set)
  workspace.local.toml           per-machine settings (gitignored)
  people.toml                    the roster; author.local names who is at this keyboard (gitignored)
  Acme.code-workspace.template   committed; Acme.code-workspace is your own copy
  artifacts/T-001-sa/            one folder per ticket: ticket.toml, spec, plan, tasks, records
  projects/<id>/                 project.toml, hub note, wiki, nodes/ (the project graph), optional overlay
  shared/                        knowledge for every project, found through shared/INDEX.md
  logs/  activity/  todos/       work log (TOML per person per day), verb history (JSONL), todos
  archive/                       closed work
  harness/                       workspace rules for agents; host config is generated from harness.toml
  .githooks/pre-commit           hl validate + hl harness sync --check
  hl, hl.cmd                     launchers
```

The repo is also an Obsidian vault. Generated HTML is for people only; agents read the TOML, Markdown and JSONL.

## Connect a model (assistant)

The assistant speaks the OpenAI chat-completions API. Add a provider and models to the `providers` plugin row in `workspace.toml` (or `workspace.local.toml` for a personal key), or use Settings > Models in the console:

```toml
[[plugin]]
id = "providers"

[plugin.config]
default_model = "openrouter/anthropic/claude-sonnet-4.5"
providers = [{ id = "openrouter", preset = "openrouter", key_env = "OPENROUTER_API_KEY" }]
models = [{ id = "openrouter/anthropic/claude-sonnet-4.5", context_window = 200000, tool_calls = true }]
```

Presets: `openai`, `openrouter`, `ollama`, `lmstudio`, `llamacpp`, `vllm`, `custom`. Keys are never stored: `key_env` names the environment variable that holds the key. Settings > Models has a Test connection button.

## Connect Telegram

1. Create a bot with BotFather and put its token in an environment variable, by default `HL_TELEGRAM_TOKEN`.
2. Allow your numeric Telegram user id (per machine): `./hl config set telegram allowed_user_ids "12345678"` (comma-separated for several; stored as a TOML array). Empty means nobody (fail-closed).
3. Restart `./hl serve`. The bot long-polls (no public URL). Commands: `/status`, `/new`, `/use`, `/run`, `/stop`, `/todo`, `/ticket`, `/help`; other text goes to the assistant in low-trust mode. Runs started from Telegram are plan mode only.

## Develop

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e
pnpm --filter @helmlock/ui test && pnpm --filter @helmlock/ui build
node packages/cli/bin/hl.ts harness lint
```

CI (`.github/workflows/ci.yml`) runs the same on Windows and Ubuntu. Dependencies and the reason for each: `docs/dependencies.md`.

## Read more

- Verbs: [docs/build/m1-verbs.md](docs/build/m1-verbs.md)
- As built: [26 milestone 1](docs/plan/blueprints/26-milestone-1-as-built.md), [27 read-only console](docs/plan/blueprints/27-read-only-console-as-built.md), [28 writable console](docs/plan/blueprints/28-writable-console-as-built.md), [29 agents and chat](docs/plan/blueprints/29-agents-and-chat-as-built.md)
- Claude Code and Cursor: [21](docs/plan/blueprints/21-claude-code-and-cursor-cli.md)

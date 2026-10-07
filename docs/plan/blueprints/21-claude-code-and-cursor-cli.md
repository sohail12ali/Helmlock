# Blueprint 21: Claude Code and Cursor CLI from one source (draft)

Requirement from you: Cursor CLI integration is a must, like the Claude Code integration. Cards: F135 (one source, generated config), F136 (Cursor as an agent runtime), F137 (approvals and hooks), F31 (decided: both). Evidence: Cursor's current docs (summarised) and a check of the installed `cursor-agent` 2026.07.23 plus both of your repos, which already drive it.

## What the Cursor CLI offers

| Area | Facts |
|---|---|
| Command | `agent` (older name `cursor-agent`). Interactive by default; `-p` or `--print` runs headless |
| Output | `--output-format text`, `json` or `stream-json` (events: system, assistant, tool_call, result); `--stream-partial-output` for deltas |
| Modes | agent (default), `--mode plan`, `--mode ask`; `--plan`. **`--mode default` is rejected** (allowed choices are plan and ask) |
| Writes | Print mode can change files; `--force` or `--yolo` allows commands unless denied; `--auto-review` is a middle rung |
| Sessions | `--resume [chatId]`, `--continue`, `agent ls`, `agent resume`, `agent create-chat` |
| Directories | `--workspace <dir>`, `--add-dir`, `--worktree` |
| Sandbox | `--sandbox enabled|disabled`; **on Windows `enabled` fails**, use `disabled` |
| Auth | `agent login`, or `CURSOR_API_KEY` or `--api-key` |
| Trust and MCP | `--trust`; `--approve-mcps`; `agent mcp list|enable|disable|login|list-tools` |
| Models | `--model <id>`; `agent models` |
| Cost | Reports tokens, not dollars; no budget flag |

## Config surfaces, side by side

| Concern | Claude Code | Cursor CLI | Our single source |
|---|---|---|---|
| Always-on rules | `CLAUDE.md` | `AGENTS.md` (nested files apply per folder) and `.cursor/rules/*.mdc` (always, auto, agent-requested, manual). Cursor docs do not mention `CLAUDE.md` | `AGENTS.md` is canonical; `CLAUDE.md` is one line that imports it (`@AGENTS.md`) |
| Skills | `.claude/skills/*/SKILL.md` | Reads `.agents/skills`, `.cursor/skills` and, for compatibility, `.claude/skills`; the CLI loads `.claude/skills` and `.claude/agents` only when its third-party extensibility setting is on | Keep skills in `.claude/skills` with portable frontmatter (`name`, `description`) |
| Agents | `.claude/agents/*.md` (`tools`, `model` allowed) | Parses the same files; a Claude `model: sonnet` may not be a valid Cursor id | Portable frontmatter only; host keys added by the generator |
| Hooks | `.claude/settings.json` (SessionStart, PreToolUse, PostToolUse, Stop) | `.cursor/hooks.json`, version 1: `sessionStart`, `beforeShellExecution`, `afterFileEdit`, `stop`, `preToolUse`, and more; JSON on stdin; exit 2 blocks; the CLI also loads Claude-format hooks | `harness.toml` hooks, one script with `--host claude|cursor` |
| Permissions | `permissions.allow/deny` in settings.json | `.cursor/cli.json` and `~/.cursor/cli-config.json`: `Shell()`, `Read()`, `Write()`, `WebFetch()`, `Mcp()`; deny wins | `harness.toml` permissions |
| MCP | `.mcp.json` | `.cursor/mcp.json` | `harness.toml` mcp servers, including env such as `CONSOLE_REPO_ROOT` |
| Ignore | Read deny rules | `.cursorignore` and Read deny | `harness.toml` ignore globs (`archive/`, `_work/`, vendor) |

## The source and what it generates

```
harness/
  harness.toml        permissions, hooks, MCP servers, ignore globs, run modes
  rules/*.md          fragments assembled into AGENTS.md
.claude/skills/  .claude/agents/      canonical skills and agents (portable frontmatter)
AGENTS.md  CLAUDE.md                  rulebook; CLAUDE.md = "@AGENTS.md"

generated, each stamped GENERATED with a hash:
.claude/settings.json   .mcp.json
.cursor/hooks.json (v1)   .cursor/mcp.json   .cursor/cli.json   .cursor/rules/*.mdc   .cursorignore
the AGENTS.md snippet between markers
```

`hl harness sync` regenerates them; `hl harness sync --check` fails in pre-commit and lint when a generated file was edited by hand or is stale. This is control-center's `setup_editor` marker idea, widened.

## Cursor as an agent runtime (F136)

```
agent -p "<prompt>" --output-format stream-json --trust \
      --workspace <cwd> [--add-dir <dir> ...] --model <id> \
      [--mode plan|ask | --auto-review | --force] [--resume <chat-id>] [--stream-partial-output]
      --sandbox disabled          # Windows
```

| Concern | Design |
|---|---|
| Modes | A ladder: plan, ask, auto-review, force. Never pass `default`. A test checks every configured mode against `agent --help` |
| Spawn | Resolve the binary with `shutil.which` (a `.CMD` shim on Windows); new process group; cwd is the repo or a ticket worktree; env minus a strip list |
| Newlines | A `.cmd` re-exec truncates the prompt at its first newline: fold or strip newlines, or pass the prompt by file (lc-wms `_cmdline_safe`) |
| Stream | One shared normalizer: `system/init` gives the session id; `assistant` blocks; `tool_call` started and completed; `result`; camelCase `usage.inputTokens`; non-JSON lines as text; a 1 MiB line cap |
| Resume | Store the session id from init; pass `--resume` next turn; re-read it from the transcript after a restart |
| Safety | A watchdog (suspect at 10 minutes, kill at 30), linger kill shortly after `result`, tree kill, an output cap; failure classes that are not Claude-specific |
| MCP | `--approve-mcps` so a headless run can use the console MCP server |
| Cost | Tokens only; no dollars. Record billing type unknown |
| Records | A run record per run (id, host, cwd, mode, model, session id, trigger, tokens, result line) in the ticket |

| Claude Code runtime | Cursor runtime |
|---|---|
| One stream-json process with stdin as a JSON-lines channel, so steering and interrupt work | One process per turn, resumed; no steering |
| `--permission-mode`, `--agent`, `--settings`, `--append-system-prompt`, `--add-dir` | `--mode`, `--auto-review`, `--force`, `--workspace`, `--add-dir`, `--sandbox` |
| Permission card through a PreToolUse hook that parks until answered | A card would need a Cursor preToolUse hook (to verify that headless mode honours it) |
| Cost in dollars | Tokens |

## Approvals and hooks (F137)

- One script per hook with `--host claude|cursor`, switching the JSON envelope (lc-wms pattern; its scripts already do this).
- Mapping: SessionStart is `sessionStart`; Stop is `stop`; PostToolUse on Edit or Write is `afterFileEdit`; PreToolUse on shell is `beforeShellExecution` with `permission: allow|deny|ask` or exit 2.
- **Double firing:** the Cursor CLI loads both `.cursor/hooks.json` and `.claude/settings.json`, so the same hook can run twice. The generator emits each hook to one place per host and marks it, so the script can ignore a second call.
- A "permission needed" card for Cursor comes from a preToolUse hook. Not tested headless: verify first.

## Problems found in your two repos (fix by building one adapter)

| Problem | Where | Fix |
|---|---|---|
| Write mode unusable: the ladder passes `--mode default`, which Cursor rejects | control-center | Use the ladder above |
| `tool_call` events fall through; camelCase usage ignored, so tokens read 0 | control-center | Shared normalizer (lc-wms has it) |
| Prompt truncated at the first newline through the `.CMD` shim | control-center (likely) | Newline guard |
| No `--workspace`, `--add-dir`, `--sandbox disabled`, `--approve-mcps`, `--stream-partial-output` | control-center | Add the flags |
| A dead hooks file: `.cursor/hooks/hooks.json` is not where the CLI looks | lc-wms | Generate `.cursor/hooks.json` (v1) |
| Docs say Cursor has no hooks; the installed CLI has preToolUse and beforeShellExecution | lc-wms | Update; verify headless |
| `mcp.json`, `.mcp.json` and the template disagree on servers | lc-wms | One source |
| README points to deleted `CURSOR.md` and `.cursor/rules` | control-center | Generated docs |
| `CONSOLE_REPO_ROOT` forwarded only in `.mcp.json` | both | One MCP definition with env |
| Two diverged forks of the console: control-center has the watchdog, linger and tree kill, failure classes, worktrees; lc-wms has the mode ladder, `--add-dir`, partial streaming, tool_call parsing, run records | both | One adapter with the best of each |

## Order of work

1. Fix the three control-center problems that block writes, tokens and prompts.
2. Port lc-wms's mode ladder, `--add-dir` and newline guard.
3. Build the generator (`harness.toml` to both hosts) and `--check`.
4. Add approvals through the Cursor hook after verifying headless behaviour.

## To verify before relying on it

- Whether print mode honours hooks and `Read`/`Shell` deny rules from `.cursor/cli.json`.
- That the third-party extensibility setting is on, so Cursor reads `.claude/skills` and `.claude/agents`.
- Whether `agent` or `cursor-agent` is the right binary name on your machine.

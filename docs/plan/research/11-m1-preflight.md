# Milestone 1 pre-flight checks (2026-10-07)

Measured on the user's machine: Windows 11, Claude Code 2.1.289, Cursor agent 2026.07.23-e383d2b, Node 24.11.0. Raw outputs are in the session scratchpad (`preflight/`).

| Check | Result | What Helmlock does |
|---|---|---|
| Claude Code `--add-dir B`: skills from B | Loaded | Nothing extra needed for skills. |
| Claude Code `--add-dir B`: B's `CLAUDE.md` | **Not loaded**, unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` | The knowledge `CLAUDE.md` imports the system rulebook with `@<delivery>/AGENTS.md` (works when started by hand), and `hl run` sets the variable. |
| Cursor reads `.claude/skills` | Yes | Skills stay in `.claude/skills` only. |
| Cursor headless respects `.cursor/cli.json` deny | **No**: a denied `Write(state/**)` was written, with or without `--force` | Enforcement lives in Helmlock: plan/ask modes by default, a post-run check of protected state paths, verbs as the only writers of TOML. Cursor config is best effort. |
| Cursor headless fires `.cursor/hooks.json` (sessionStart, afterFileEdit) | **No** | The same as above; `hl validate` also runs in pre-commit and CI. |
| Cursor spawn from Node | Works: `cmd.exe /d /s /c "<quoted agent.cmd> -p --output-format stream-json --trust --sandbox disabled --workspace <cwd>"`, `windowsVerbatimArguments`, prompt on stdin; a two-line prompt arrives whole | Recipe used by the cursor adapter. |
| Claude spawn from Node | Works: `claude.exe` directly (no cmd), prompt on stdin, `-p --output-format stream-json --verbose` | Recipe used by the claude adapter. |
| `taskkill /PID n /T /F` | Exit code 1 (conhost cannot be terminated) but the whole tree is gone | Do not treat exit 1 as failure; verify the tree is gone. |

Stream fields seen:
- **Claude:** `system:init`, `assistant`, `rate_limit_event`, `system:post_turn_summary`, `result`. Usage has `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, plus `total_cost_usd`.
- **Cursor:** `system:init`, `user`, `thinking` (delta, completed), `tool_call` (started, completed), `assistant`, `result`. Usage has `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and no cost.

## Smoke-test findings (after integration)

| Finding | What Helmlock does |
|---|---|
| Claude Code ignores `permissions.allow` in `.claude/settings.json` until the folder is trusted interactively; deny rules still apply | The claude adapter passes `--allowedTools Bash(hl:*),...` on the command line; `hl run` puts the knowledge repo on PATH so `hl` resolves |
| Claude Code rejects `Write(path)` deny rules; `Edit(path)` covers every file-editing tool | The generator emits only `Edit(path)` for Claude |
| An agent can report "edit worked" when it was denied | Trust the files and `hl validate`, not the agent's summary |
| The Cursor CLI on Windows runs its PowerShell-shaped hook line through bash when Git Bash is the shell; a failing `beforeShellExecution` hook blocks every command | That Cursor hook is opt-in (`[cursor] shell_hook = true`); the post-run protected-path check catches direct state edits (verified: run fails with `protected-path-write`) |
| A workspace `harness.toml` with an empty deny list switched the post-run protection off | Protected paths are now the built-in list plus every layer's deny list |
| The user's global hook blocks edits on `main`; a new knowledge repo starts on `main` | Agents work on a branch in the knowledge repo, or the user relaxes that hook for knowledge repos |

End-to-end agent run (Claude Code, analyst agent, spec skill): claimed the ticket, moved it to spec, wrote the spec, recorded a question with `hl question add`, and logged one work-log line when the Stop hook reminded it. `hl validate` found nothing.

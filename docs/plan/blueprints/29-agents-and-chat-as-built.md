# Blueprint 29: Agents and chat as built (2026-10-07)

Built on `m4/agents-chat` by four parallel agents after a wave 0 that froze the contracts (services: approval queue, run manager, providers, assistant; HTTP routes in `api.ts` "Milestone 4").

| Part | Where | What it does |
|---|---|---|
| Approval queue | `packages/plugins/approval-queue` | Cards in memory plus a local log (`approvals/`), fail-closed after `approval_timeout_sec` (default 300), allow once / allow for this chat or run / deny, local-only cards refused from Telegram, events for the console and Telegram |
| Run manager | `packages/plugins/runtimes/run-manager.ts` | Runs started from the server: one per ticket, identical starts within 10 s coalesce, `force` refused, buffered events with replay, silence notices at 5 and 15 minutes, cancel with tree kill, the same run record as `hl run` |
| Claude approval bridge | `harness/hooks/pretool.ts --server`, `POST /api/v1/hooks/pretooluse` | Server-started Claude runs get a per-run settings file with a PreToolUse hook; gated tools wait for a person; `hl` commands pass without a card; commands that reach the approvals API, the hook token or dump the environment are refused (a guard against an agent approving itself, not a sandbox) |
| Providers | `packages/plugins/providers` | OpenAI-compatible chat completions, seven presets, compat switches, streaming with split tool calls, stable error codes and retries, local usage log, test connection |
| Assistant | `packages/plugins/assistant`, `assistant/persona/` | Chats as local JSONL, persona and house style, read tools run directly, write tools (console verbs) wait for an approval card, up to six tool rounds, low-trust mode for Telegram, context-window trimming |
| Telegram | `packages/plugins/telegram` | Long polling inside `hl serve`, fail-closed allowlist, chat with edit-in-place answers, `/status /new /use /stop /todo /ticket /help`, approval buttons, notifications |
| Console | `packages/ui/src/features/{agents,approvals,chat}` | Start a run, live transcript, cancel; approval cards on Overview, in runs, in chat and as a top-bar badge; chat panel with model picker and mic button; Test connection under Settings > Models |

## Verified

- Unit tests (all packages, with a 60 s per-test timeout), 64 UI tests, typecheck, Biome, UI build, 8-step end-to-end test.
- Live in the browser: started a builder run (Claude Haiku, ask mode) from the Agents page; its `git status` call raised an approval card with a countdown and a top-bar badge; "Allow once" let it run; the run finished with tokens and cost. The chat panel shows "No model configured" with the Settings link.
- Not verified live: the assistant against a real model (no local server was running and no key is configured), Telegram against the real Bot API (no bot token yet).

## Found and fixed during integration

- Claude Code loads skills but not agents from `--add-dir` folders, so `--agent builder` failed in a knowledge repo. `hl harness sync` now writes stamped copies of the system agents into the knowledge repo's `.claude/agents/` (tracked by `--check`, skipped by lint).
- Tests that wait could hang the whole suite; every test now has a 60 s timeout, UI tests 20 s.

## Not yet

A run does not record which Telegram chat started it (`/stop` reaches only runs it saw); allowed Telegram ids are a comma-separated string; no warning event for the context window; images in the assistant, the dictation refiner and clipboard tools come later (B25).

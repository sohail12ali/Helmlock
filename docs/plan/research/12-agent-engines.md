# Agent engines and the agent experience: four repos compared (2026-10-08)

The user's ask: the "Agents and chat" page (type a task, pick an agent and a ticket from drop-downs, watch a raw transcript) feels bad. Use both CLI agents (Claude Code, Cursor, Codex, as Paperclip does) and any OpenAI-compatible model with our own harness (as deepseek-harness does). Study all four repos and propose something new.

## Paperclip (CLI agents)
| Take | Skip |
|---|---|
| The ticket is the conversation: assigning wakes the agent, a comment wakes it again (`issue-assignment-wakeup.ts`, `issue-comment-wakeup.ts`) | Companies, org chart, hiring approvals, monthly budgets |
| One resumable CLI session per (agent, ticket); invalidated when cwd or instructions change; fresh-session retry (`agent_task_sessions.ts`, `claude-local/src/server/execute.ts`) | Timer heartbeats and the 30k-line orchestrator |
| Small adapter contract: `execute`, `testEnvironment`, `sessionCodec`, a stdout parser into one `TranscriptEntry` union (`adapter-utils/src/types.ts`) | Polling logs by byte offset (push over SSE instead) |
| A fresh session gets the full brief, a resumed one only the delta (new comments) | Remote sandboxes, ACP, quota probes, chat connectors |
| Tool calls folded into accordions, a final row with tokens and cost (`RunTranscriptView.tsx`) | |

## deepseek-harness (model engine)
| Take | Skip |
|---|---|
| The session is an append-only event log; model history is rebuilt from it | Cordis bundles, session-format migrations, zstd, SQLite |
| allow / ask / deny in a pre-execute hook; fail-closed approvals with an audit log; permission presets | run_code, workflows, agent teams, PTY, LSP, browser use |
| Read-before-edit and stale-file checks; literal unique-match `edit`, atomic writes | Token-meter replay; DeepSeek wire extensions |
| Compaction ladder: prune tool output, summarise at 80%, compact and retry on context errors; spill large output | |
| Provider retry policy per attempt; repeat-call reminder; per-tool timeouts | |
| AGENTS.md and CLAUDE.md read with a byte budget; skills loaded on demand by a `skill` tool | |
| Cache-stable prompts (append, never rewrite the system prompt); `todo_write` and `exit_plan_mode` as events | |

## lc-wms (dispatcher and roles)
| Take | Skip |
|---|---|
| Route the request to a role agent; the person does not pick skills | Regex-scraping `STATUS:` out of prose |
| A plan of tasks with a DONE check each, run in waves, shown as a ledger | Separate chat and run systems ("the chat tab does not know what a ticket is") |
| One "advance" per lane | Agents moving their own cards as a side effect |
| Gated mode: approved, revise, skip, stop | Hand-written TOML recipes per lane |
| One normalised event vocabulary, seq-numbered SSE with resume | |

## control-center (your console)
| Take | Skip |
|---|---|
| Transports as data with capabilities shown in the UI (steerable vs queue-only) | Four entry points (its own audit says so) |
| Steer, queue and interrupt as distinct gestures | A separate assistant chat renderer |
| Fail-closed approval broker feeding a "Needs you" inbox | Results that land only if the agent remembers to comment |
| A durable run record with watchdog, failure classes and per-class retry; a worktree per ticketed run with a diff stat | A vague default prompt ("propose next"); no concurrency cap |

## The common lesson
All four struggle where chat and runs are separate things, and where the outcome of a run is prose. The new design (Blueprint 33) puts every run on a ticket thread, gives both engines one event vocabulary and one timeline, and ends every run with a structured outcome.

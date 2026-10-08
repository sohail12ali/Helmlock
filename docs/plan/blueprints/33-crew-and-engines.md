# Blueprint 33: Crew and engines, a new agent experience (proposal, 2026-10-08)

Replaces the "Agents and chat" page (a task box, agent and ticket drop-downs, a raw transcript). Grounded in research 12 (Paperclip, deepseek-harness, lc-wms, control-center). Status: **proposal, awaiting the user's decision** (cards F152 to F157).

## The idea in one line
You never "start an agent". You move work forward on a ticket, and the crew does it. Every run lives on a ticket thread, every engine looks the same in the UI, and every run ends with a structured outcome.

## Two engines behind one contract
| | CLI engines | Model engine ("Helmlock loop") |
|---|---|---|
| What | Claude Code, Cursor CLI, Codex (later) | Our own agent loop over any OpenAI-compatible model: OpenRouter, LM Studio, DeepSeek, OpenAI |
| Learned from | Paperclip adapters, our runtimes plugin | deepseek-harness |
| Inside | Spawn the CLI, parse its stream, resume its session id | Turn and step loop, our tools, the session event log, compaction |
| Tools | The CLI's own, with our hooks (PreToolUse approvals, protected paths) | read, grep, glob, edit (read-before-edit), shell (ask), `hl` verbs, todo, skill, ask_user, finish |
| Approvals | PreToolUse hook to the approval queue (today) | pre-execute allow, ask or deny, to the same queue |
| Instructions | The host loads AGENTS.md, CLAUDE.md, agents and skills | The loop loads AGENTS.md and the role's agent file within a byte budget; skills on demand |

One contract for both (a runtime plugin each): `test()` (installed, signed in, model reachable), `start(brief, session?)` returning an event stream, `steer(text)` when capable, `stop()`, and `capabilities` (resume, steer, approve, models). Both emit **one event vocabulary** (session, text, thinking, tool start and result, diff, todo, plan, approval, usage, outcome, error), persisted as `runs/<id>.events.jsonl`, so one timeline renders both.

Every run ends with an **outcome**: the agent calls `hl run report --outcome done|review|blocked|needs-input --summary ... --next ...` (a tool in the model engine). The run manager writes it to the ticket as a comment and an activity line, and the UI offers the suggested next step. No regex on prose; a run that ends without a report is marked "no outcome" and shown as such.

## Three surfaces, one object (the run)
1. **Ticket thread**, where work happens (mockup 15). Comments, agent turns and run cards in one thread. A **Next step** button derived from the stage and the role map ("Spec: Analyst writes the spec, on Claude Code"). Mention a role in a comment (`@builder take slice 2`) to hand work to it. The composer talks to whoever is on the ticket: steer a live run when the engine can, otherwise queue the message and resume the same session.
2. **Crew**, replacing "Agents and chat" (mockup 16). Six role cards: engine and model chips, what each is doing now ("building T-014, 3 min, 2 files changed"), its queue, and a Needs you count. A card opens the role's settings (engine, model, permission preset, test) and its history. Drag a ticket onto a role to hand it over.
3. **Assistant** (Ctrl+K or the side panel). The model engine with no ticket. It routes plain requests ("build T-014 with Claude") by proposing a **plan card**: steps with role, engine and a DONE check (the lc-wms ledger, as data). Approve, revise or skip; approved steps start runs that appear on their ticket threads. Same chat component as the ticket thread.

## The run as a timeline, not a transcript
- Grouped steps: "Read 6 files", "Edited api.ts +12 -3" (opens the diff), "Ran tests: 42 passed".
- A side rail: todos, plan, files changed, tokens and cost.
- Gestures by capability: Steer (only if the engine can), Queue, Stop.
- Approvals inline with a diff preview; they also collect in Needs you (Inbox, Telegram).
- The outcome card at the end, with the next step as a button.

## Sessions and isolation
- One session per (role, ticket), resumed on the next hand-off; reset when cwd or the role's instructions change (Paperclip).
- Build runs work in a git worktree per ticket and project, with a diff stat and a Merge button; other roles work in place.
- A concurrency cap (default 2 live runs); more wait in a queue.

## Engine per role
Settings > Crew: each role gets a default engine and model (for example analyst on an OpenRouter model, builder on Claude Code, verifier on Cursor). Any hand-off can override it. If an engine fails its test, the role card says so before you start.

## Build order (if approved)
1. Engine contract, event vocabulary and `hl run report`; adapt Claude and Cursor; the outcome written to the ticket.
2. Ticket thread with Next step, mentions, steer or queue, and the run timeline.
3. Crew page and role settings; remove the old Agents and chat page.
4. Model engine (the Helmlock loop) with tools, approvals, compaction and sessions.
5. Assistant routing with plan cards; worktrees with Merge; the concurrency cap.

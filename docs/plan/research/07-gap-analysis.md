# Gap analysis: Paperclip and deepseek-harness against our plan (iteration 8)

Verdicts: **Have** (already in the plan), **Added** (new card), **Later** (worth it, not v1), **Skip** (heavy or off-topic). Status of their features comes from their own roadmaps and docs, not from running them.

## Paperclip: what it does better

1. Atomic checkout, and never retry a conflict. Ownership is explicit. (Have: F7d)
2. Status as a contract: `blocked` needs a named owner and next action. (Added: F64)
3. Bounded recovery: one automatic continuation, then a person decides. (Added: F65)
4. Pre-dispatch gate: missing config blocks a run with a named reason. (Added: F63)
5. An inbox that derives from state, with per-user read state that resurfaces on new activity. (Added: F67)
6. Portable markdown company package with a "not included" report and secret scrubbing. (Added: F71)
7. Cost events with `reported` versus `unpriced` and budgets at 80% and 100%. (Added: F78)
8. An honest feature map: every feature marked shipped, experimental or planned, with gotchas. (Practice to copy in docs)
9. A design system: one status vocabulary, monospace ids, no toast for visible state. (Added: F68)
10. One-command isolated test drive. (Later: sample workspace in onboarding, F1b)

## Paperclip: feature inventory against the plan

| Area | Paperclip | Our plan | Verdict |
|---|---|---|---|
| Onboarding | CLI `onboard --yes`, web wizard, `run`, `test-drive` | F1a, F1b, F27 | Have; test-drive Later |
| Agents and adapters | 10+ CLI adapters, generic process and http, instruction and config revisions | F5c, F41 | Have; revisions come free from git |
| Tasks | Single assignee, checkout, blockers, parent/child, comments, documents, steering queue | F7a to F7d | Have; blocked fields Added; steering queue Skip |
| Goals and projects | Goal hierarchy, project workspaces, worktrees | F3c, F7b | Added goal link option; worktrees Later |
| Routines | Cron, webhook, API triggers, concurrency and catch-up policy | F18 | Later (policy notes added) |
| Budgets and costs | Cost events, budgets, daily caps | none | Added F78 |
| Approvals | Board approvals, plan confirmations, low-trust presets | F5d, F14 | Have; low-trust Added F66 |
| Activity and audit | `activity_log`, runs, timeline | F6, event bus | Added F70 |
| Dashboard | Counts, stale tasks, spend, live runs | F10b | Have |
| Inbox and notifications | Mine, Recent, Unread, All, Blocked; archive | none | Added F67 |
| Search | Company-wide, ranked, evaluated | F2e | Have (basic); ranking rubric Later |
| Documents | Versioned documents, anchored comments, artifacts library | F2b, git | Have via git; anchored comments Skip |
| Skills | Library, Skill Studio with test inputs, version history | F15, F16 | Have; testing Added F69 |
| Plugins | Out-of-process workers, capability-gated RPC, UI slots | F40 to F48 | Have; capabilities Added to F48 |
| Connectors and MCP | Catalog, per-action Allow / Ask / Off | F14, F41 | Per-tool tri-state Added to F14; MCP client Added to F41 |
| Secrets | Encrypted master key, versions, audit | F9b | Have by reference; vault Skip |
| Auth | Local trusted or authenticated, invites, roles | none | Skip (local console, git for sharing) |
| Import and export | `agentcompanies/v1` packages | F42 | Added F71 |
| CLI | About 30 families, `--json`, profiles | F55, F56 | Have; headless run Added |
| Health and backups | `doctor --repair`, backups | F63 | Added; backups are git |
| Evals | Skill Studio tests, promptfoo, E2E | F69 | Light version Added |
| Mobile | Responsive, bottom nav, not installable | F68 | Added as option |
| Knowledge base | LLM wiki plugin (raw and wiki folders) | F2b, F52 | Have |
| Daily work log | **Not provided** (audit only) | F6 | Our advantage |
| Files-only mode | **Not provided** (Postgres required) | decided | Our advantage |
| OpenAI-compatible assistant | **Not provided** | F11 | Our advantage |

Skip as heavy or off-topic: multi-company tenancy, SSO and RBAC, org chart and hiring approvals, sandbox providers, release channels, telemetry, Slack and Teams stacks.

## deepseek-harness: what it does better

1. **Provider/model split with config-driven routes**, re-read per request with no restart. (Added: F11a, Blueprint 12)
2. Catalog defaults with sparse overrides; typos refused at load. (In Blueprint 12)
3. Declarative compat switches, each documented with what it fixes. (In Blueprint 12)
4. Stable error codes, exactly one terminal stream chunk, retry as a logged policy. (Added: F75)
5. Credentials by reference with a fixed lookup order. (In Blueprint 12, F9b)
6. Event-sourced log where "model-visible means logged". (Have: F11e)
7. One permission preset sets sandbox and approval together, fail-closed. (Have: F14)
8. Compaction with per-model policies. (Added: F74, simplified)
9. `--dump-config` shows the merged result. (Added to F56: `hl config show`)
10. Documentation discipline: generated config reference, "Known limitations" in every package. (Added to F44)

## deepseek-harness: feature inventory against the plan

| Area | deepseek-harness | Our plan | Verdict |
|---|---|---|---|
| Any LLM through one layer | `providers` map, 3 protocols, ~45 catalog providers | F11a, F72 | Added, with local presets it lacks |
| Model discovery | `GET /models`, candidates only | F11c, F73 | Added with a real connection test |
| Sessions | JSONL log, resume, fork, archive, search | F11e | Have; fork Later |
| Tools | shell, files, web, todo, ask-user, run-code | F5c, F13 | Have via verbs; web tools Later |
| Permissions and sandbox | Presets, approvals, OS sandboxes | F14 | Have; OS sandbox Skip on Windows |
| Skills | `SKILL.md`, lazy catalog | F15, F30 | Have |
| Subagents | Spawn, fork, ACP, Codex, Claude Code | F5c | Later |
| Schedule and jobs | Cron, interval, background jobs | F18 | Later |
| Goals and plans | `/goal` auto-continue, reviewed plan mode | F5g | Plan approval via freeze and challenge; goal loop Later |
| Webhooks | GitHub PR-ready overlay | F4, F41 | Later |
| Hooks bridge | Claude Code and Codex hooks | F59 | Have (Claude Code hooks directly) |
| MCP | Client (stdio, HTTP) | F41 | Added as option |
| SDK and ACP | Headless profiles | F56 | Headless run Added |
| Web client | 53 UI features: model picker, approvals, file tree, diff cards, browser sidebar, themes, i18n | F10, F34, F68 | UI ideas in the Mockups section |
| Voice | Experimental local speech-to-text | F12 | Have |
| Usage tracking | Tokens, speed, time to first token, cache hits; no currency | F78 | Added |
| Local servers | **No Ollama or LM Studio docs, presets or keyless support** | F72, F73 | Our opportunity |
| Failover | **None** (retry within a route only) | F76 | Optional |
| Tool-less models | **No flag, no fallback** | F77 | Added |

Skip as heavy: the Cordis framework, 328 packages, bilingual docs gates, session-format migrations, Electron desktop, native sandboxes, telemetry.

# Blueprint 30: v1 complete (2026-10-07)

Milestone 5 closed the v1 scope on `m5/v1-complete` with three parallel agents.

| Part | What it does |
|---|---|
| Notes and index (`packages/plugins/notes`) | `hl notes build`: Obsidian hub notes for tickets, records and projects with wikilinks, built locally (not in git, F52, B24). `hl index build`: `shared/INDEX.md`, one line per document (F116) |
| Lifecycle (`packages/plugins/lifecycle`) | `hl ticket close` checks the closure digest (`<T>-digest.md`: Outcome, Decisions, Key files and links, Caveats, Follow-ups; at most ~450 words) and moves to done through the workflow; `ticket archive` (closed only: digest copied to `shared/digests/`, sha256 manifest, moved to `archive/YYYY-MM/`), `ticket restore` (verifies the manifest), `retention suggest` (nothing deletes itself, F127). Archived ticket ids are never issued again |
| Console | Inbox with Unread / All / Archived and local read/archive state that resurfaces on new activity (F67); Knowledge page (index, projects, digests, skills); first-run setup wizard (author, model via `provider add` + test connection, Telegram, first ticket, agents, trust); list settings |
| Repo hygiene | CI on Windows and Ubuntu (frozen lockfile, scripts off), weekly audit, Dependabot, README, `docs/dependencies.md` for every package; pre-commit hooks for the delivery repo and for knowledge repos (`hl init` installs it; `hl doctor --repair` fixes it) |
| Gaps closed | Run origin (Telegram `/run` read-only, `/stop` by origin), Telegram allowed ids as a list, `ticket new` activity entity, assistant context-window notice, live updates reconnect with backoff |

## Verified

- 305 unit tests (301 pass, 4 live tests skipped), 83 UI tests, 8-step end-to-end test, typecheck, Biome, `harness lint`, `harness sync --check`.
- Live in the browser against the demo repo: Inbox with three derived items, Knowledge index after `hl index build`, setup wizard with the preset list; `ticket close` refused a two-stage jump through the workflow gate.

## Later (by decision, B25)

Purge with tombstones, template upgrade and promote, the project knowledge graph and viewer, the OpenAI-style agent tool loop, dictation refiner, clipboard and screenshots, try mode, daily token caps, extra workflow and template packs.

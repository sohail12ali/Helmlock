# Blueprint 25: Second review, decisions worth changing (2026-10-07)

All 181 decisions were reread, this time asking "would I still pick this?" rather than "does it contradict?". **All accepted and applied on 2026-10-07.**

## Changes I recommend

| # | Change | Cards | Why |
|---|---|---|---|
| A | Deny agent edits only on **knowledge-repo state paths** (tickets, records, logs, workspace TOML), not on `**/*.toml` and `**/*.jsonl` everywhere | F59, F57 | As written, the rule also blocks the builder from editing `pyproject.toml`, `Cargo.toml` or test fixtures in product repos. |
| B | **Chats, usage, run transcripts and audio stay on the machine** (gitignored). Records, work logs and activity are committed. Compaction then only touches local files | F11e, F78, F95, F129, F70 | Assistant chats are personal and noisy in a team repo, and gzip files in git cannot be diffed or merged. |
| C | Per-machine settings go in **`workspace.local.toml`** (gitignored), not a separate per-machine JSON | F9b, F103, F49 | F103 already defines that layer. Two per-machine files in two formats is one too many. |
| D | **Onboarding in v1 is CLI-only** (`hl init` asks what it needs). The web wizard comes with the writable console | F1a, F19 | The console after milestone 1 is read-only (F19), so a web wizard has nowhere to run until later. |
| E | **Ticket moves do not write the work log.** They go to the activity log. The work log comes from people and from the Stop hook | F6b, F93 | The work log is a timesheet for people (F93). A line per stage move fills it with noise. |
| F | **Plan approval before build applies to M and L only** | F96, F5e | Small tickets already skip challenge and breakdown (F5e). A human gate on every S ticket costs more than it catches. |
| G | **The SQL forward and rollback rules move to the software-delivery pack**, not the system ticket model | F113, F141 | The delivery repo is generic (Blueprint 18). SQL conventions are domain rules from lc-wms. |
| H | **Ship only the lite workflow (6 lanes) in v1.** The lc-wms 7-lane pack comes later | F46, F5b | v1 has no release lane, and a second pack doubles validator and board testing. |
| I | **Record ids (D-, Q-, B-) use the same author suffix as tickets** (D-003-sa) | F62, F61 | One file per record solves file merges, but two branches can still both create D-003. |
| J | Wording: a code plugin exports `apply(ctx, config)`, not `register(core)` | F42, F101 | F101 decided the form; the F42 label still has the old name. |

## Scope: mark v1 against later (no decision changes)

v1 is "your 11 features", but the saved decisions cover far more. I recommend keeping these decisions as the design and **building them after v1**:

- Voice beyond the mic button: the dictation refiner and robust recognition (F119, F121)
- Clipboard, screenshots and OCR in the assistant (F118 clipboard and screenshot, F122)
- Template three-way upgrade, promote, and the research and client packs (F139 upgrade, F142, F141 extra packs)
- Purge with tombstones (F128). Archive stays in v1.
- Chat checkpoints and usage roll-ups (F129)
- The project knowledge graph and its viewer (F140, F149 graph)
- The OpenAI-compatible agent tool loop (F5c). Claude Code and Cursor run agents in v1; the provider layer serves the assistant.
- Try mode (F1b try), the daily token cap (F134), execution roles beyond reviewer and approver (F96)

## A risk to measure in milestone 1

- **CLI start time.** Every `hl` call boots the plugin kernel, and `hl validate` runs after every agent edit (F59). Budget: under 300 ms for `hl validate` on one file. If it is slower, mount plugins lazily per verb (F107 already allows dormant plugins).

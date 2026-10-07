# Blueprint 28: Writable console as built (2026-10-07)

Built on `m3/writable` by three parallel agents after a wave 0 that froze the write contract (`packages/core/src/contracts/api.ts`, "Milestone 3") and added a shared UI write helper.

## One write path

The console writes by calling verbs: `POST /api/v1/verbs/<noun>/<verb>` with `{input, dry_run}` runs `runtime.run()`, the same registry path as the CLI (F13a). So every console write gets the guards, gates, activity line, static page refresh and stale-write check that `hl` gets. Writes are serialised in the server process.

Protection: localhost bind and Host check (milestone 2), plus `Content-Type: application/json`, the header `X-Helmlock-Request: 1`, a same-origin check, and an allow-list of 22 console verbs. `run`, `init`, `serve` and `harness sync` stay in the terminal. Results map to 200 (ok), 409 (code 2, gate or guard, and stale writes), 400/422 (errors); failures can carry `data` (gate reasons, findings).

## What the console can do

- Tickets: one-line new ticket (key `c`), drag between lanes (a blocked move snaps back and shows the reasons with their fixes), move/stage menu as the keyboard alternative, claim/release, block/unblock, edit title/goal/size/priority, comments (Ctrl+Enter), decisions, questions (answer cards with option buttons, also on Overview), bugs and gaps (add, resolve), tasks (add, status toggle; the only optimistic write).
- Todos page, Work page (quick log with a 160-character counter; a duplicate is shown calmly), Settings generated from plugin manifests (F44; shared `workspace.toml` vs this-machine `workspace.local.toml`, secrets by env-var name), and an All actions page with a form for any console verb.
- New verb `config set <plugin> <key> <value> [--local]` (settings plugin). It applies to `hl` commands at once; a running `hl serve` picks it up when restarted (config reload only, F107).

## Verified

- Unit tests (server writes, settings plugin), 52 UI tests, typecheck, Biome, UI build (main chunk 105 KB gzip), and the 8-step end-to-end test.
- Live against a copy of the demo repo: write header and verb allow-list refused correctly; blocking question stopped a move with 409; answering it let the move through; `config set` wrote `workspace.toml`. In the browser: created T-006-sa from the composer, claimed it, moved it to spec, saw the next gate before clicking, and the refused move showed inline; Settings shows the value and its source. Activity lines carry code 0 and 2; static pages refreshed.
- Fixed during integration: on narrow screens the ticket page's properties drawer was stuck open; it now starts closed with a "Properties" button.

## Not yet

Starting agent runs from the console (the agents and chat milestone), config reload without restarting `hl serve`, the web onboarding wizard, inbox read/archive state (F67), an entity on the `ticket new` activity line.

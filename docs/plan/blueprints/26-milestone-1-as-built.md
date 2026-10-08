# Blueprint 26: Milestone 1 as built (2026-10-07)

Milestone 1 is the agent system without the console. It was built in one day by seven parallel agents (worktrees), after a wave 0 that froze the contracts, then integrated on `m1/integrate`.

## What exists

| Part | Where | What it does |
|---|---|---|
| Contracts | `packages/core/src/contracts/` | Frozen interfaces: kernel, services, verbs, files, schemas (Zod), events, hooks, catalog |
| Kernel | `packages/core/src/kernel/` | Plugin container (F40, F101): context tree, services with `requires` (pending, restart), scoped disposers, events, waterfall hooks by priority, deny-only guards. Ported from Cordis (MIT) |
| File layer | `packages/core/src/files/` | Closed TOML emitters with key order, unknown keys kept, `schema_version` and migrations, lock + temp + rename, stale-write hash check, JSONL append, JSONC `.code-workspace` parsing, workspace resolution |
| Config | `packages/core/src/config/` | Bundles, `workspace.toml` rows, `workspace.local.toml`, launch flags; unknown keys refused |
| Verbs and CLI | `packages/core/src/verbs/`, `packages/cli/` | One registry; commander CLI built from plugin manifests, lazy plugin mount per verb, `--json`, `--dry-run`, exit codes 0/1/2, did-you-mean, `where`, `doctor`, `help agent`, `config show` |
| Tickets | `packages/plugins/tickets-toml`, `workflow-lite`, `validate` | Ticket folders, ids `T-001-sa`, one file per decision/question/bug/gap, tasks, claims, six lanes with gates (exit 2), layout and AC trace validation |
| Knowledge | `packages/plugins/roster`, `activity`, `todos`, `work-log`, `search`, `context`, `skills` | People roster (author never guessed), activity per person per day, todos, TOML work log with ~70% dedupe and quarter-hour allocation, ripgrep search, ticket and session digests, three-layer skill index |
| Harness | `packages/plugins/harness` | `harness.toml` to Claude Code and Cursor config with GENERATED stamps, `sync --check`, hook scripts for both hosts, `harness lint` (port of lc-wms `harness_lint.py`) |
| Runtimes | `packages/plugins/runtimes`, `runtime-claude`, `runtime-cursor` | `hl run`: Claude Code and Cursor headless, prompt on stdin, mode ladder (never `default`/bypass), watchdog, tree kill, run records, protected-path check after each run (Cursor ignores its own deny rules headless) |
| Scaffold | `packages/plugins/scaffold`, `templates/knowledge-repo/` | `hl init` (CLI-only, dry run, git first commit, launchers `hl`/`hl.cmd`), `hl project add` (the only writers of the workspace file) |
| System layer | `.claude/agents` (6), `.claude/skills` (14), `AGENTS.md`, `harness/` | Ported from lc-wms, domain wording removed; skills call only `hl` verbs |

## Numbers

- Verbs: see `docs/build/m1-verbs.md`.
- Start time on the user's machine: Node alone about 190 ms; `hl where` about 420 ms; `hl validate --changed` about 450 ms (the 300 ms target is not reachable as wall time on Windows; see `docs/build/m1-baseline.md`).

## Findings during the build

- Claude Code loads skills but not `CLAUDE.md` from `--add-dir` folders unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`; knowledge repos import the system rulebook with `@` and `hl run` sets the variable (research 11).
- Cursor headless ignores `.cursor/cli.json` deny rules and hooks; Helmlock enforces after each run instead.
- The delivery repo is not a knowledge repo: no activity, no generated host config there.

## Verified end to end (2026-10-07)

- `pnpm test` (unit), `pnpm test:e2e` (8 steps on a fresh `hl init` repo), `tsc`, Biome, `hl harness lint`: all pass.
- Headless Claude Code through `hl run`: runs `hl`, a direct `ticket.toml` edit is denied, an analyst run with the spec skill drives a ticket through `hl` and logs work.
- Headless Cursor through `hl run`: runs `hl`; a direct `ticket.toml` edit fails the run with `protected-path-write`.
- Findings and the fixes they caused: research 11.

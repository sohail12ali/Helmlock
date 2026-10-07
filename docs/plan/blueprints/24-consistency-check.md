# Blueprint 24: Consistency check of the 160 saved decisions (2026-10-07)

Every decided card and every settled entry was read side by side. **All fixes accepted and applied on 2026-10-07** ("accept all").

## Real contradictions (two decisions say opposite things)

| # | Conflict | Cards | Recommended fix |
|---|---|---|---|
| 1 | "hl reads folders and **never rewrites** the .code-workspace" vs "Setup writes the .code-workspace" and "Registering a product **adds a folder** to the workspace file" | F21, F22 vs F1a, F1b | hl never rewrites the file **silently**. Only `hl init` (create once) and `hl project add` (one folder, with a dry run and confirmation) may write it. |
| 2 | "workspace.toml holds settings, **not repo paths**" vs "the registry in workspace.toml lists the layers" and "`hl skill find` scans the three layers (paths from workspace.toml)" | settled entry, F86, F88 vs F22 | Layer paths come from the .code-workspace folders. workspace.toml only says which folder is which layer, by folder name. Update CLAUDE.md wording. |
| 3 | Telegram quick capture includes **/log** vs "No separate Telegram **log** command" | F4b vs F6b | Drop /log from Telegram. Work logs come from a person, a finished run or a stage change, as F6b says. |
| 4 | Voice: **browser Web Speech** dictation vs record audio, **local whisper-style engine first**, browser as fallback, keep audio 24 h. A local engine also needs an install, while F123 says "No install" | F12 vs F120, F123 | v1 = browser engine only (F12). Local engine becomes an optional plugin later (a separate process, as the Python plugin rule allows). |
| 5 | CLI and console run with **no build** (type stripping) vs React + Vite UI that **needs a build**, "shipped inside the package". The launcher claims "zero install" while dependencies need `pnpm install` | F146, F60 vs F34, F10d, F131, F147 | No build for core, cli and server. The UI is built once by `hl setup` (or on the first `hl serve`) into a gitignored folder. "Zero install" becomes "one `pnpm install`". |
| 6 | Markdown renderer: **markdown-it or marked** vs **react-markdown + remark-gfm**. Ticket pages are written as files *and* served live as "the same page" | F32 vs F149, F28 | One pipeline: unified/remark in core renders the static ticket page. The React UI uses the same remark plugins, so the file and the live page match. |

## Tensions (both can hold, but the rule needs a sentence)

| # | Tension | Cards | Recommended fix |
|---|---|---|---|
| 7 | Generated notes are **never stored in git**, but the Obsidian graph is meant to be shared by the team through git | F129 vs F52, F53, settled "Files only" | Keep them out of git. Obsidian users run `hl notes` (or the session-start hook does it). The graph is a local view of shared TOML. |
| 8 | The closure digest "stays in the Obsidian graph", but archived tickets move to archive/, which Obsidian excludes | F125 vs F124, F126 | On archive, `hl archive` writes the digest note to `shared/digests/` (outside archive/), so the graph keeps it. |
| 9 | The knowledge CLAUDE.md imports the system rulebook with `@path`, but **AGENTS.md is canonical** and Cursor does not follow `@` imports | F90 vs F135, F31 | `hl harness sync` writes the system rulebook into the generated Cursor rules, so Cursor gets it without imports. |
| 10 | Every verb appends to **one activity JSONL**, in a git repo shared by a team that relies on merge-friendly files. "Atomic claim" is only atomic on one machine | F70, F7d vs F62, F61 | Activity is one JSONL per person per day, like the work log. Claim stays local, and a duplicate claim across branches is caught by `hl validate` on merge. |
| 11 | "A **daily token cap** per agent" vs usage "warn at 80%, **no hard stop** unless you ask" | F134 vs F78 | The cap is opt-in and off by default, so it matches F78. |
| 12 | A **project** is "each product repo" (layer, registry) vs a project holds **several code repos** in project.toml. That gives three places for project-to-repo links | F86, F3c, F92 vs F143 | A project can have many repos. project.toml lists repos by **folder name** from .code-workspace. Paths live only in the workspace file. |
| 13 | "Nothing has to stay running" vs Telegram long-poll and outbound notifications, which need a running process | F110 vs F4a, F4b | Say it plainly: Telegram works only while `hl serve` runs. The CLI never needs it. |
| 14 | Ticket ids: "Local sequential **T-001**" vs "counter plus an author **or random** suffix, T-014-sa **or** T-4k7f". Both formats are still open, and file names (F26) use T-014 | F7a, F26 vs F61 | Pick counter plus author initials: `T-014-sa`. It is readable and does not collide. |
| 15 | F40 (how far "everything is a plugin" goes) is **undecided**, while CLAUDE.md and F144 already fix `packages/cli` and claim the CLI, runtime and workflow are replaceable plugins | F40 vs F144, CLAUDE.md | Decide F40 next. It is the only impact-3 foundation card still open, and seven cards wait on it. |

## Small gaps (not conflicts)

- The Deployer agent exists (F5a) but there is no release lane (F5b, F2b). Keep it as a skeleton, as F5a says.
- The do dispatcher ends with log-work (F5f), and the Stop hook also logs runs (F6b). That is a double entry, only partly caught by the 70% dedupe (F93). Pick one: the Stop hook.
- There is no Inbox tab (F10a), but F67, F84 and the `g i` shortcut assume one. Put Inbox under Overview, or add a tab.
- The format map allows JSON only for hosts (F49), yet graph.json (F140) and per-machine prefs JSON (F9b) use it. Allow JSON for generated machine files too.
- The assistant has no file tools (F11d), but F118 lists "find a file and open it" and "summarise a file". Allow read-only search and read.
- F35 draws state diagrams with Mermaid; F50 names only sequence and ER. Align on sequence, ER and state.
- F26 says every ticket file is prefixed, but F112 lists ticket.toml and tasks.toml with no prefix. Exempt the two TOML files.
- F122 says "nothing stored unless saved", while F119 and F120 keep raw speech or audio for 24 h. State the 24-hour exception.

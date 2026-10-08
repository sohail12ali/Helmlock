# Blueprint 31: People and storage scopes (approved and built, 2026-10-08)

The user's ask: several people share one knowledge repo; give options to keep things shared (committed) or local (on this machine, never committed). Grounded in how lc-wms, control-center and Paperclip do it (research, 2026-10-07).

## Who am I

- Keep the rule: the author comes from `author.local` and must be in `people.toml`; never guessed (F93).
- Add from lc-wms: `people.toml` entries get `git = [every name and email spelling seen in commits]` for attribution only, and `hl people unknown` lists spellings nobody claims. `hl init` and the setup wizard may *offer* to create `author.local` from `git config user.name`, confirmed by the person.
- Add from Paperclip: every run, approval and chat records `responsible` (the person slug). Credentials always come from that person's machine (`.env`, `workspace.local.toml`), never from an agent definition.

## Three scopes

| Scope | Where | In git | For |
|---|---|---|---|
| **Shared** | the repo as today | yes | tickets and records, work logs (one file per person per day), activity, `people.toml`, agents, skills, `workspace.toml`, digests, wiki |
| **Personal (shared)** | `people/<slug>/` | yes, visible to the team | a person's own todos list, personal agent and skill variants, chats they chose to share, personal notes |
| **Local** | gitignored paths | never | `author.local`, `workspace.local.toml`, `.env`, runs and transcripts, chats by default, approvals, usage, audio, `.hl-cache/`, generated `notes/` and `site/`, private todos and notes |

Committed means visible to everyone with the repo; the console says so plainly ("shared with the team" vs "only on this machine").

## Options per kind

| Kind | Default | Options |
|---|---|---|
| Todo | personal (shared) | `--scope team` (shared list), `--scope private` (local only) |
| Chat | local | "Share this chat" copies it to `people/<slug>/chats/` |
| Note | personal (shared) | private (local) |
| Agent / skill variant | none | `people/<slug>/agents/<name>.md` overrides the shared agent for that person only; a local variant in `.hl-local/agents/` overrides it on this machine only |
| Setting | per declared scope | already shared vs this machine (F9b) |
| Run record | local | "Attach to ticket" copies the record and digest into the ticket |

Overrides resolve: local, then personal, then shared. `hl skill find` and the console show which layer won.

## Why this shape

Merge-friendly (one file per person or record, as F62), nothing personal leaks by accident (local is the default for chats, runs and private items), and the team still sees what people choose to share.

## As built (milestone 6, `m6/people-scopes`)

- People: `hl people add`, `people claim <id> <git name or email>`, `people unknown`; `people.toml` keeps `git = [...]`; who you are still comes only from `author.local`. Console People page.
- Todos: `--scope team|personal|private` (default personal) stored in `todos/`, `people/<slug>/todos/`, `.hl-local/todos/`; `todo move`; list = team + mine, `--all` adds other people's personal lists. Ids unique across all three.
- `chat share` copies a chat to `people/<slug>/chats/` with file reads stripped; `run attach` writes `artifacts/<T>/runs/<id>.md` and a comment.
- Runs, approvals and chats record `responsible`; credentials always come from this machine.
- Agent and skill layers: system (delivery) < workspace (`harness/agents`, `harness/skills`) < personal (`people/<slug>/`) < local (`.hl-local/`); `hl harness sync` writes the winners into gitignored `.claude/agents` and `.claude/skills`; hand-made files there are never touched; `hl overrides` and Settings show which layer won.
- Verified: 325 unit tests, 99 UI tests, 8-step end-to-end; live on the demo (personal analyst and local builder overrides; one todo in each scope) and on the real repo (People page sees the author and the unclaimed git name).

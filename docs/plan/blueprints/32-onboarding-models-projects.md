# Blueprint 32: Machine secrets, several models, project switcher (built, 2026-10-08)

The user's ask: Telegram stayed "not done" after saving the token; set up the repo and projects before the first ticket and always show which workspace and project are active (Paperclip-style); connect several models at once and switch between them. Also seen: a real API key pasted into the "key variable name" field.

## Machine secrets
- Secrets live in the knowledge repo's gitignored `.env` (this machine only, Blueprint 31). The process environment wins; `.env` is read fresh on every lookup, so nothing needs a restart.
- `hl secret set NAME` (hidden prompt or stdin, never argv) and `secret status` (names and source only). The value never appears in output, activity, events, logs, the assistant's tools or Telegram.
- Console: paste the Telegram bot token or a provider key; it is saved to `.env` and only the name goes into `workspace.toml`. The Telegram bot starts, restarts or stops by itself when the token or settings change.

## Several models
- `provider add` takes several models; `model add`, `model remove` (an explicit `--default` when removing the default), `model default`, `provider remove [--force]`, `model list`.
- Settings > Models: providers with their models, star for the default, Add models, remove. A pasted key can be tried (Fetch, Test) before saving. Chat switches model per chat; Telegram `/model` lists and switches.

## Project switcher (F138 kept: one console serves one knowledge center)
- The top bar names the knowledge center; its menu lists other centers on this machine (`~/.helmlock/recent.toml`, written by `hl serve`), with a link if running or the command to start it.
- Sidebar PROJECTS: All projects, each project, Add project (a repo folder, or import folders from a `.code-workspace`, dry run then confirm, via `project add` / `project import`). The active project lives in `?project=`, filters board, tickets, and todos and runs through their ticket, and is the default for new tickets and runs (run cwd = the project's repo folder).
- Setup gains "Connect your code" before "A first ticket".

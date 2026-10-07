# {{NAME}}

The {{NAME}} knowledge center: tickets, projects, shared knowledge and work logs, kept as plain files in git. Run by Helmlock (the delivery repo at `{{DELIVERY_REL}}`).

## Open it

1. Open `{{NAME}}.code-workspace` in VS Code, Cursor, Antigravity or any editor that reads workspace files. It loads this folder as `knowledge` and the delivery repo as `system`, plus your project folders.
2. After a fresh clone the file is missing (it is yours, not shared). Copy `{{NAME}}.code-workspace.template` to `{{NAME}}.code-workspace`, then put your slug from `people.toml` in a file named `author.local`.

## Run hl

- Windows: `hl.cmd where`. macOS and Linux: `./hl where`. Both work from any folder.
- `hl where` shows the knowledge repo, the delivery repo, your author and the folders it found, and where each came from.
- `hl doctor` checks the setup and says how to fix what is wrong.
- `hl project add <folder-name> --path <path>` adds a product repo to the workspace file and creates `projects/<id>/`.

## Layout

| Folder | Holds |
|---|---|
| `artifacts/` | One folder per ticket |
| `projects/` | One folder per project: `project.toml`, a hub note, its wiki |
| `shared/` | Knowledge for every project; `shared/INDEX.md` lists it |
| `logs/` | Work log, one file per person per day |
| `activity/` | Verb history, one file per person per day |
| `todos/` | Personal todos |
| `archive/` | Closed work |
| `harness/` | Workspace rules for agents, turned into host config by `hl harness sync` |
| `.obsidian/` | Shared Obsidian settings; open this folder as a vault |

State (every `.toml`) changes through `hl`. Prose (`.md`) is edited directly.

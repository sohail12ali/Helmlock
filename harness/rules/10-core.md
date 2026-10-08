## Core rules

- **State goes through the CLI, prose is edited directly.** `ticket.toml`, `tasks.toml`, record TOML, logs and workspace TOML change only through `hl` verbs. Spec, plan, notes and wiki are markdown: edit them directly. If `hl` is missing, stop and say so; never edit state by hand.
- **Layers:** system (this repo), workspace (the knowledge repo), project (each product repo plus an optional overlay). Before work in a project, read that project's `CLAUDE.md` and pin the working directory to its root.
- **Same skill name in several layers:** show every match with its layer and description and ask; never pick one silently.
- **Never read generated files** (HTML pages, `site/`, generated notes); read the TOML and markdown they come from.
- **A run starts only when a person or the dispatcher starts it.** Agents act inside the workspace and ask before anything outward or destructive.

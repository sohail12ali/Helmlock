# Dependencies (F147)

One line of reasoning per dependency. Lockfile committed; installs use `--frozen-lockfile` with scripts disabled (`.npmrc`).

| Package | Where | Why |
|---|---|---|
| zod | core, plugins | One schema source for types, validation and generated forms (F145). |
| smol-toml | core, plugins | Small, maintained TOML parser; we write TOML with our own closed emitters (F24, F25). |
| commander | cli | Mature command framework; Paperclip's CLI uses it. |
| @clack/prompts | cli | Small interactive prompts for `hl init` in a terminal; Paperclip uses it. |
| typescript | dev | `tsc --noEmit` type check only; code runs through Node type stripping (F146). |
| @types/node | dev | Node API types. |
| @biomejs/biome | dev | One tool for lint and format. |

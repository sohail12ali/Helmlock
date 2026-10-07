# Workspace agents

Agents shared by everyone in {{NAME}}, one markdown file each (`<name>.md` with `name` and `description` frontmatter). A file here with the same name as a system agent replaces it for the whole team.

Agents come from four layers; the highest one wins for a name:

| Layer | Folder | In git |
|---|---|---|
| system | the delivery repo's `.claude/agents/` | delivery repo |
| workspace | `harness/agents/` (this folder) | yes, shared |
| personal | `people/<your id>/agents/` | yes, visible to the team, used only by you |
| local | `.hl-local/agents/` | no, this machine only |

`hl harness sync` copies each winner into `.claude/agents/` (generated and gitignored; never edit it there). `hl overrides` shows which layer won for each name.

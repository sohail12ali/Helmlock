# Workspace skills

Skills shared by everyone in {{NAME}}, one folder each (`<name>/SKILL.md` plus any reference files). A folder here with the same name as a system skill replaces it for the whole team.

Skills come from four layers; the highest one wins for a name:

| Layer | Folder | In git |
|---|---|---|
| system | the delivery repo's `.claude/skills/` | delivery repo |
| workspace | `harness/skills/` (this folder) | yes, shared |
| personal | `people/<your id>/skills/` | yes, visible to the team, used only by you |
| local | `.hl-local/skills/` | no, this machine only |

`hl harness sync` copies each winner above the system layer into `.claude/skills/` (generated and gitignored; never edit it there). `hl skill list` shows every copy with the layer that wins; `hl overrides` lists the winners.

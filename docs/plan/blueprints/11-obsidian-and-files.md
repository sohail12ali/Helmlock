# Blueprint 11: files only, shared with teams, and Obsidian (draft)

No database. Everything is a file in git, so a team shares the knowledge base by cloning it. Obsidian is a window onto the same folder.

## What Obsidian sees

| File type | Appears in Obsidian's graph and links | Notes |
|---|---|---|
| Markdown (`.md`) | Yes | Links, backlinks, tags, search, Properties from YAML frontmatter |
| TOML, JSONL, JSON | No | Not notes, so no graph nodes and no backlinks |
| HTML | No | Generated for the console, not for Obsidian |
| Images, PDF | As attachments | Fine for diagrams exported from elsewhere |
| Folders starting with a dot (`.claude/`) | Ignored | Good: agent config stays out of the vault |

So only markdown joins the graph. The authored prose already does. The structured records (decisions, bugs, tasks) do not, unless something turns them into markdown. That is card F52.

## Recommended: generate markdown notes from the TOML

TOML stays the source (safe to write, standard library). A verb, `hl notes sync`, writes a read-only markdown note for each ticket and each record, with wikilinks and properties. Obsidian then graphs everything.

```markdown
---
generated: true
id: T-014
type: ticket
stage: plan
size: M
owner: sa
blocked: false
tags: [ticket]
---
# T-014 Artifact format decision
Spec: [[T-014-spec]] | Plan: [[T-014-plan]]
Decisions: [[T-014-D-001]] | [[T-014-D-002]]
Open questions: [[T-014-Q-003]]

> Generated from ticket.toml. Change it with `hl`, not here.
```

- YAML frontmatter appears only in generated notes, because Obsidian's Properties need it. State is still never kept in frontmatter by hand (see Blueprint 9).
- Note names are unique across the vault (`T-014-D-001`), so short wikilinks resolve. This is why F26 now recommends prefixed file names.
- Properties let Obsidian tables (Bases, or the Dataview plugin) list tickets by stage or owner.
- Editing a generated note is pointless: it is overwritten. Edits go through the CLI.

## Layout in the vault (draft)

```
knowledge repo = the vault
  artifacts/T-014/
    T-014-spec.md          authored
    T-014-plan.md          authored
    ticket.toml            source
    decisions/D-001.toml   source (one file per record, F62)
    T-014.md               generated hub note
    decisions/T-014-D-001.md   generated record note
  wiki/                    authored notes
  templates/               note templates (Obsidian Templates plugin)
  logs/                    JSONL history, not in the graph
  site/                    generated HTML, excluded from the vault view
  .obsidian/               shared config (graph groups, templates folder, exclusions)
```

## Sharing with a team through git

- Source files are small, one-per-record where edits collide (F62), with ids that do not clash across branches (F61).
- Generated notes and pages are **not committed**; a git hook and the launcher run `hl notes sync` after checkout and merge. That avoids merge conflicts on generated files. Caveat: Obsidian on a phone cannot run hooks, so a team using mobile may prefer to commit the generated notes. (open point)
- `.obsidian/` ships shared settings (graph colour groups per kind, templates folder, excluded folders). Per-user state such as `workspace.json` is gitignored (F53).
- Everything works without Obsidian: the console and CLI read the same files.

## Open points

- Where generated notes live: next to their sources (shown above) or in one folder.
- Which Obsidian features the team relies on (Properties and Bases only, or Dataview too).
- Whether generated notes are committed for mobile users.

# Blueprint 17: shared knowledge and reference that is not a skill (draft)

Every knowledge center has information that belongs to all of its projects, and material that is useful but is neither a skill nor a ticket. Today lc-wms spreads it across `wiki/`, `data-graph/`, `_shared` artifacts, templates and the skills themselves. Cards: F115 (where) and F116 (reference versus skill).

## The knowledge repo, with a shared area

```
knowledge repo
  Name.code-workspace  Name.code-workspace.template
  workspace.toml  people.toml  author.local
  CLAUDE.md  .claude/            workspace layer: team rules, skills, agents (Blueprint 13)
  shared/                        applies to every project in this workspace
    INDEX.md                     generated: one line per document (how agents find things)
    wiki/
      standards/                 writing, coding, branch, naming
      decisions/                 workspace-level ADRs (not ticket decisions)
      runbooks/                  how to do recurring operations by hand
      environments/              servers, databases, URLs (no secrets)
      glossary.md
      integrations/              third-party systems and contracts
    contracts/                   API contracts, data dictionary, status codes, key maps
    sql/                         reusable scripts
      snippets/  diagnostics/    one README per area
    templates/                   spec, plan, tasks, ticket-layout.toml
    checklists/                  release, environment, test
    special-tickets.toml         meetings, leave, internal work
  projects/<id>/                 per project; optional overlay (F87)
    CLAUDE.md  .claude/skills/   project-specific rules and skills
    wiki/                        architecture, runbooks, schema notes for this project
  artifacts/<T>/                 per ticket (Blueprint 16)
  logs/YYYY-MM/                  one file per person per day (Blueprint 14)
  investigations/                INV-... dossiers that have no ticket yet
```

## What goes where (with lc-wms examples)

| Kind of knowledge | Example today | Goes to | Loaded automatically? |
|---|---|---|---|
| Registry: repo to project to skill to branch | `data-graph/catalog/projects.toml` | `workspace.toml` `[[projects]]` (Blueprint 13) | Read by the CLI |
| People and roles | `.kanban/config/people.toml` | `people.toml` (roster, F1b) | Read by the CLI |
| Meetings, leave, internal keys | `special-tickets.toml` | `shared/special-tickets.toml` | No |
| Standards and conventions | CLAUDE.md, wiki notes, rule files | `shared/wiki/standards/`; only a one-line pointer in CLAUDE.md | No (found by index) |
| Glossary, status codes, key maps | `data-graph/catalog/glossary.md`, `status-codes`, `fk-map` | `shared/wiki/glossary.md`, `shared/contracts/` | No |
| Reusable SQL | `_shared/common-handy-scripts` (184 files) | `shared/sql/snippets`, `shared/sql/diagnostics` | No |
| Runbooks and environment notes | checklists, text inside skills | `shared/wiki/runbooks`, `shared/wiki/environments` | No |
| Templates and checklists | `templates/`, `templates/checklists` | `shared/templates`, `shared/checklists` | Used by the scaffold and verbs |
| Workspace decisions (ADRs) | wiki | `shared/wiki/decisions` | No |
| Pre-ticket dossiers | `investigations/INV-...` | `investigations/` | No |
| Friction notes (papercuts) | `logs/papercuts.toml` | `shared/papercuts.toml`, later turned into rules | No |
| Vault conventions | `schema.md` | `shared/wiki/standards/vault.md` | No |

## The rule: skill versus reference (F116)

- A **skill** is a procedure the agent executes ("how to stage a release").
- **Reference** is a fact the agent looks up ("the shipping carriers and their codes").
- Reference is **never loaded automatically**. `shared/INDEX.md` lists every document in one line; `hl search` finds it; a skill links to the reference it needs instead of embedding it.
- lc-wms keeps SQL rules and verify scopes inside skills. In the new layout those become reference documents that the skills link to, so they cost tokens only when read and are visible to people and Obsidian.

## The index (generated)

```markdown
# Shared index (generated, do not edit)
- shared/wiki/standards/sql-rules.md: naming, transactions, catalog line, preview flag
- shared/wiki/environments/uat.md: UAT servers and databases (no secrets)
- shared/wiki/glossary.md: terms used across projects
- shared/sql/diagnostics/show-picking/README.md: how to diagnose a stuck picking show
- shared/contracts/status-codes.md: order and shipment status codes
```

`hl search sql rules` reads this file and returns paths. CLAUDE.md names only the index, never the content.

## Rules

1. Cross-project facts live in `shared/`; project-specific facts live in `projects/<id>/`; ticket facts live in the ticket.
2. Secrets never live here. Environment notes name the variable, not the value.
3. Anything promoted from a ticket (a decision that applies to all) is moved to `shared/wiki/decisions` with a link back.
4. The index is generated on demand and by a hook, so it is never out of date.

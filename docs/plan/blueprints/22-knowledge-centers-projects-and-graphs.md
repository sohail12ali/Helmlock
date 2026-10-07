# Blueprint 22: delivery center, knowledge centers, projects and their graphs (draft)

Your picture: like a Paperclip company that runs many projects, but with **one delivery center** and **many knowledge centers**. Each knowledge center has a template that keeps growing and holds several projects, each keeping its own knowledge, graphs and nodes. Cards: F138 to F143. Canvas: "Delivery center, knowledge centers and projects".

## Paperclip's words, in ours

| Paperclip | Helmlock | Difference |
|---|---|---|
| Company (organization) | **Knowledge center** (workspace) | Each is its own git repo, so isolation and access are git permissions, not rows in a shared database |
| Project | **Project** inside a knowledge center | Owns its knowledge, graph, tickets and code-repo links |
| Agents (hired employees) | Agent pack from the delivery center | Shared by every knowledge center; per-workspace overrides in the workspace layer |
| Goals | Project goals in `project.toml` | Light, in files |
| Issues | Tickets | Folder per ticket (Blueprint 16) |
| Skills library | Three skill layers (Blueprint 13) | Per-agent enablement (F132) |
| One deployment, many companies | One delivery center, many knowledge centers | A console per knowledge center (F138) |
| Postgres | Files in git | By decision |

## The shape

```
delivery center (one repo)            knowledge center A (repo)          knowledge center B (repo)
  agents, skills, console, plugins      workspace.toml                     workspace.toml
  base template (versioned)             template.toml  (growth)            template.toml
                                        shared/                            shared/
                                        projects/                          projects/
                                          wms/   (project)                   portal/
                                          ui/                              artifacts/ logs/ archive/
                                        artifacts/ logs/ archive/
```

## 1. Many knowledge centers (F138)

- Each knowledge center is a separate repo with its own team, history, projects and access.
- The delivery center stays shared and independent: it holds no workspace data (F3a, F39).
- Recommended: **one console per knowledge center**, started by the launcher; a small **switcher** lists your knowledge centers from a **per-user file outside both repos** (for example in your user config folder) and opens the one you pick. A read-only **portfolio page** (needs-you, tickets in flight, usage across all knowledge centers you can read) can come later.

## 2. A template that keeps growing (F139, F141, F142)

```toml
# template.toml (in each knowledge center)
base = "delivery-lite"
base_version = "1.4"
packs = ["software-delivery"]

[[added]]
kind = "folder"
path = "shared/wiki/runbooks/payments"
why = "Payment incidents need a runbook per provider"
date = "2026-11-03"

[[added]]
kind = "note-type"
name = "incident"
why = "Production incidents link to tickets and decisions"
```

| Verb | Does |
|---|---|
| `hl template add` | Adds a folder, note type, checklist or record kind and records it in `template.toml` with a reason |
| `hl template upgrade` | Dry run first: a three-way comparison of your old base, the new base and your workspace; never overwrites local growth |
| `hl template promote` | Produces a reviewable patch of a local addition for the delivery base or a shared pack; a person approves; nothing flows upstream automatically |

Packs are declarative (folders, templates, a workflow and skills): software delivery (from your lc-wms layout), research, client service. A workspace picks one at scaffold and can add more later.

## 3. A project as the unit of knowledge (F143)

```
projects/wms/
  project.toml          id, name, owners, code repos, goals, status
  index.md              hub note: summary, architecture overview, links
  wiki/                 architecture, runbooks, environments, project decisions, glossary
  nodes/                the project graph (below)
  raw/                  optional immutable sources
  log.md                append-only: ## [date] op | subject
  CLAUDE.md  .claude/   optional overlay (F87)
```

```toml
# project.toml
id = "wms"
name = "Warehouse system"
status = "active"
owners = ["sa"]
repos = ["wms-api", "wms-ui"]    # names only; paths are the folders in the .code-workspace file
goals = ["Replace the legacy picking screens"]
```

Tickets reference the project id. A project can span several code repos; a repo belongs to one project. Cross-project facts go to `shared/`.

## 4. The project graph (F140, mockup "Project knowledge graph")

### What your repos do today

| Source | What it has | Lesson |
|---|---|---|
| **lc-wms data-graph** | One global graph of the SQL schema: 186 files, 770 KB; node types table, procedure, flow, database, subgraph, ticket; markdown with YAML frontmatter and typed edges; catalogs; a 139-row agent index of about 4k tokens; an LLM-driven `/graph` skill and 8 health checks | Powerful for impact analysis, but **drifted**: the README claims 458 tables and 1,023 procedures while the index has 310 and 829; inverse edges exist on only 43 of 91 tables; the "generated" index was edited by hand and its edge counts are 0; ticket status is duplicated; it needs Obsidian and Dataview. No measurement of token savings exists |
| **control-center Vault graph** | Every text file is a node; edges are wikilinks and folder containment; a force-graph canvas with filters; typed edges were deliberately dropped | Cheap and robust, but no typed queries |
| **paperclip llm-wiki** | `raw/` (immutable sources) and `wiki/` with `index.md` (one line per page), `log.md` (`## [date] ingest | title`), sources, entities, concepts, synthesis, per-project pages; contradictions are flagged, never overwritten; lint is read-only | Good habits: index, log, flag contradictions |

### Recommended lite graph

A **node** is a markdown note: `projects/<id>/nodes/<type>/<node-id>.md`

```markdown
---
id: stock
type: data
title: Stock
summary: One row per stock position; a trigger keeps the sync table current.
updated: 2026-10-01
sources: [../wms-api/src/Stock.sql]
depends_on: [location, item]
touches: [sync-stock]
---
Writes need the caller context because of the trigger. See [[T-014-closure]].
```

- **Types** come from a closed set of about six: component, concept, decision, data, flow, integration. New ones are added through `hl template add`.
- **Edges** are typed list keys: `depends_on`, `part_of`, `touches`, `supersedes`, `see_also`. Body wikilinks count as `see_also`. Cross-project targets are written `other-slug:id`.
- **Outgoing edges only.** The generator computes inverses (backlinks). This is the direct fix for lc-wms's incomplete `fk_from`.
- **One stdlib generator**, run on demand and on Stop, with a fingerprint cache, writes:
  - `graph.json` (nodes and edges) for the console canvas;
  - `index.generated.md`: id, type, summary, edge count, under about 150 rows;
  - a lint report: broken targets, orphans, missing summary, node missing from the index, node older than its source.
- **Agent contract:** read the index, pick up to five nodes, follow up to two hops, cite node ids. A missing fact is marked `UNVERIFIED` and logged, never invented or written silently. Contradictions are flagged, not overwritten.
- **Obsidian:** the nodes are plain markdown, so they appear in the graph natively; the console adds typed edges and a project filter.

### Leave out (the drift sources)

Mirrors of source files (link to the source path instead); hand-kept catalogs that duplicate nodes (fk-map, table indexes); stored inverse edges; confidence and `verified_at` scores; Dataview dashboards; per-environment release-edge files; hand-written hub notes per subgraph (use folders or tags); mandatory ticket nodes (`ticket.toml` stays the state); any Obsidian CLI dependency; "must update after every change" rules that no hook enforces.

## How it fits the rest

- **Lifecycle (Blueprint 19):** an inactive project is archived like a ticket; its digest and index stay visible.
- **Skills (Blueprint 13):** the `projects/<id>/` folder holds the project overlay; a project skill can start with "read the project index and follow its nodes".
- **Search and context:** `hl search` and `hl context` take `--project`, so an agent working on a project loads that folder, not the whole knowledge center.

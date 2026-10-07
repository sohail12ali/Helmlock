# Blueprint 13: three layers of CLAUDE.md, skills and agents (draft)

Decided structure (F86): the same kinds of files exist at three levels, and Claude needs a way to find them. This is the recommended shape, built on what lc-wms and control-center already do for projects.

## The layers

| Layer | Lives in | Owns | Examples | Changed by |
|---|---|---|---|---|
| **System** | delivery repo (`CLAUDE.md`, `.claude/skills`, `.claude/agents`) | The CLI contract, generic skills (do, spec, plan, verify, log-work), agent roles, skill format rules | "State changes go through the CLI", the `do` dispatcher | Maintainers of the system, versioned |
| **Workspace** | knowledge repo (`CLAUDE.md`, `.claude/skills`, `.claude/agents`) | Team conventions, glossary, ticket flow variations, workspace-specific skills and agents | "Tickets use the T- prefix", "release checklist", client terminology | The team that owns the knowledge |
| **Project** | each project: its own repo, plus an optional overlay `projects/<name>/` in the knowledge repo (F87) | Build, test and publish commands, code conventions, project skills | "run the API tests", "migrate the database" | The project's team |

Rule from your repos: **the workspace owns process, the project owns product.** Nothing about one project's commands lives in the system layer.

## How they combine

- **CLAUDE.md files are complementary.** Each is short and about its own layer. The knowledge repo's `CLAUDE.md` imports the system rulebook with `@path`; a project's `CLAUDE.md` is read first when work starts in that project (F90).
- **Same skill name in several layers: show all, never hide (F89, decided).** The index lists every one with its layer and description, and the dispatcher shows them and asks which you mean; it can remember a preference per name. Descriptions must say how they differ, and lint warns when clashing names have near-identical descriptions.
- **Size budgets and the format lint apply to every layer**, so a project cannot bloat the always-loaded context.

## The registry (`workspace.toml` in the knowledge repo)

```toml
[skills]
layers = ["system", "workspace", "projects"]     # lookup order, most general first

[[projects]]
id = "wms"
path = "../wms-workspace/wms-api"                # repo paths live in the .code-workspace folders, not here
claude_md = "CLAUDE.md"
skills = ".claude/skills"
overlay = "projects/wms"                         # optional folder in the knowledge repo
default_branch = "main"

[[projects]]
id = "ui"
path = "../wms-workspace/wms-ui"
```

The delivery repo is found the same way (F22). Nothing in the delivery repo lists any workspace.

## A skill file across layers

```markdown
---
name: build
description: Build and test the WMS API. Use when asked to build, test or publish wms.
---
```

The index adds `layer` and `path` itself; authors never write them.

## Discovery: the skill index (F88)

`hl skill list` and `hl skill find "run the wms tests" --json` scan the layers in the registry and return a ranked, small result. Only descriptions are read; a skill body loads only when chosen.

```json
[{"name":"build","layer":"project:wms","description":"Build and test the WMS API. Use when asked to build, test or publish wms.","score":0.82,"path":"../wms-api/.claude/skills/build/SKILL.md"},
 {"name":"build","layer":"system","description":"Build the delivery console itself and run its tests.","score":0.61,"path":"helmlock/.claude/skills/build/SKILL.md"},
 {"name":"verify","layer":"system","description":"Review and test against acceptance criteria.","score":0.55,"path":"helmlock/.claude/skills/verify/SKILL.md"}]
```

Same-named skills appear side by side with their layer and description. Each is also reachable by a layer-qualified name (for example `project:wms/build`). `hl skill list --same-name` shows only the clashes. If the host shows only one skill of a clashing name, the index is still the complete view (to verify).

## The dispatcher (the `do` skill)

1. **Observe:** `hl context` for the ticket (digest, not files).
2. **Classify** into a lane: deliver, skill, role, investigate, cross-repo (as lc-wms does).
3. **Find skills** with `hl skill find` across all layers. If several match, or a name exists in more than one layer, show them with layer and description and ask which; run independent matches in parallel.
4. **Read the owning layer's `CLAUDE.md` first**, then the skill.
5. **Run from that layer's root.** For a project, pin the working directory to the project repo (F92). A ticket that spans repos gets one child agent per project; the parent owns the shared contract.
6. **Log** one line for the person with `hl log-work` (Blueprint 14).

If the request names a build, test or publish step, the dispatcher routes it to the project layer and never guesses commands from the system or from memory.

## Session start (F91)

A SessionStart hook runs `hl context --session` and prints a small digest. New workspace skills show up automatically because the index scans the workspace layer; nothing needs registering.

```
In flight: T-014 spec (sa), T-009 build (builder), 2 approvals waiting
Skills: system 12 | workspace 3 (release-checklist, glossary, client-terms) | project wms 4, ui 2
```

## How Claude Code sees the layers (assumed; verify)

- A session opened in the knowledge repo loads its `CLAUDE.md` and `.claude/skills`.
- Adding the delivery repo and the projects as additional directories made their skills and agents available in this very session, but a `CLAUDE.md` in an added directory may not load by default. So the knowledge `CLAUDE.md` imports the system rulebook and the registry tells the agent where to read project files.
- The skill index is the dependable path for finding project skills; native discovery is the bonus.

## Trees

```
delivery repo                 knowledge repo                      project repo (wms)
  CLAUDE.md                     CLAUDE.md  (imports system)         CLAUDE.md
  .claude/skills/               .claude/skills/  (workspace)         .claude/skills/  (build, publish)
  .claude/agents/               .claude/agents/                      .claude/agents/
                                projects/wms/  (overlay, optional)
                                  CLAUDE.md, .claude/skills/
```

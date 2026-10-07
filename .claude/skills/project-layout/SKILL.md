---
name: project-layout
description: Finds where things live, activates the owning project before work, runs a project's own build, test or publish skill, and states the generic git rules. Use when locating a repo or path, deciding which project owns a change, or building, testing or publishing code.
---

# /project-layout

```text
/project-layout [{T} | project | path | change]
/project-layout run {skill} [args]      # run a project's own skill (build, test, publish, lint)
```

**Reads:** `hl where --json`, `hl config show --json`, `hl skill find`, the project's `CLAUDE.md` · **Writes:** nothing

## Steps

1. **Resolve.**

   | What | How |
   |------|-----|
   | Knowledge repo, delivery repo, project folders | `hl where --json` (resolved from the `.code-workspace` file) |
   | Project ids and settings | `hl config show --json` |
   | A ticket's project and folder | `hl context {T} --json` |
   | Project skills (build, test, publish) | `hl skill find "{verb} {project}"` |
   | Per-project detail | the project's own `CLAUDE.md` |

   A path or a change: match it to the project folder that contains it. Not in any folder: say so; adding a project is `hl project add {folder}` with a dry run, and it is an ASK.
2. **Activate the owning project** before any edit, git command, build or test in it:
   1. Read the project's `CLAUDE.md` (and the rules file a skill points to).
   2. Pin the shell and git to the project root (`git -C {root}`, or the working directory of the shell or child agent).
   3. The knowledge repo stays the working directory only for ticket files, records and the work log.
3. **Run a project skill** (`run {skill}`):
   1. `hl skill find "{skill} {project}"`. Several matches, or one name in several layers (system, workspace, project): show each with its layer and description, recommend one and ask; never pick one silently.
   2. Read the chosen `SKILL.md`, activate its project (step 2), then run it from the project root.
   3. No match: list what `hl skill list` shows for that project and stop. Never guess build, test or publish commands.

## Rules

### Layers

- **System** (delivery repo): generic skills and agents, this rulebook. Knows nothing about any workspace.
- **Workspace** (knowledge repo): process, team conventions, special log keys, ticket folders, records, logs.
- **Project** (each product repo, plus an optional overlay in the knowledge repo): build, test and publish commands, code conventions, project skills.
- The workspace owns process, the project owns product. Nothing about one project's commands lives in the system layer.

### Git (generic)

- Every git command runs inside the owning repo (`git rev-parse --show-toplevel` first).
- **Branches:** one branch per ticket per project, cut from the base the project's `CLAUDE.md` names (its Git section). Name it after the ticket (the workspace or project may set a pattern). Never commit straight to the main line.
- **Upstream:** create ticket branches without tracking the base (`--no-track`); the first push sets the ticket branch as upstream (`git push -u origin HEAD`). Never leave the upstream on the main or development line.
- **ASK** before `git commit`, any push, opening or merging a PR, and `git reset --hard`. Commit message format comes from the workspace layer.
- Never force-push, rewrite shared history or change CI without the person's approval.
- Conflicts: resolve each hunk by the intent of both sides; when intents conflict, stop and ask.

### Ticket folder

- One folder per ticket in the knowledge repo, listed by `hl context {T} --json`: `ticket.toml` and `tasks.toml` (CLI only), `{T}-spec.md`, `{T}-plan.md`, record folders (`decisions/`, `questions/`, `bugs/`, `gaps/`), `test-cases/`, `tests/` (ticket-local checks), `source/` (stakeholder input, the only place for binaries), `{T}-closure.md`.
- Folders are created lazily: a folder exists only once it holds a file.
- File names carry the ticket id, so links like `[[T-014-sa-spec]]` are unique.

## Output

The resolved root (or path), its layer and project id, plus the next command. For `run`: the skill used (with its layer), the project root, the commands run and their output.

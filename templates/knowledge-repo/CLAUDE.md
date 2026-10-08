@{{DELIVERY_REL}}/AGENTS.md

# {{NAME}}

## This knowledge center

- Name: {{NAME}}. Console: {{CONSOLE_NAME}}. Started {{DATE}} by {{AUTHOR_NAME}}.
- The system rulebook is imported above from the delivery repo (folder `system` in `{{NAME}}.code-workspace`). This file only adds what is true for this knowledge center.
- Layout: `artifacts/` tickets (one folder each), `projects/<id>/` one folder per project, `shared/` knowledge for every project (find it through `shared/INDEX.md`), `logs/` work log, `activity/` verb history, `todos/`, `archive/` closed work, `harness/` workspace rules, agents and skills (`hl harness sync` copies the winning agents and skills into `.claude/`; `hl overrides` shows which layer won).
- State goes through `hl` (tickets, records, todos, logs, every `.toml`). Prose goes in directly (specs, plans, wiki notes, hub notes).
- `_work/` is scratch space for people. Agents do not read it.
- Not sure where you are? Run `hl where`. Something broken? Run `hl doctor`.

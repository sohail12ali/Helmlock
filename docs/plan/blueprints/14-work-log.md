# Blueprint 14: work log by person (kept from lc-wms and control-center)

**Rule: one file per person per day, in the knowledge repo.** Both of your repos already do this; the plan keeps it. Format choice is F6a, the rules are F93.

## Where it lives

```
knowledge repo
  logs/
    2026-10/
      2026-10-06.sa.toml        one person, one day
      2026-10-06.jo.toml
  people.toml                   team roster (committed)
  author.local                  who am I on this machine (gitignored, written by onboarding)
```

- The author is read from `author.local` and checked against `people.toml`. It is asked during onboarding and never guessed (F1b).
- Per-person per-day files never conflict in git, which suits team sharing.

## A day file (TOML, recommended)

```toml
schema_version = 1
author = "sa"
date = "2026-10-06"

[[entry]]
ticket = "T-014"
category = "Development"
text = "Chose TOML for records and wrote the format map"
weight = 3

[[entry]]
ticket = "Internal"
category = "Internal"
text = "Daily scrum"
hours = 0.5
```

## The same day in markdown (control-center style, the alternative)

```markdown
---
author: sa
date: 2026-10-06
---
## Work
- T-014 Chose TOML for records and wrote the format map
- Internal Daily scrum (0.5 h)
```

## Rules carried over from lc-wms log-work (F93)

| Rule | Why |
|---|---|
| You write one sentence; the tool owns storage, author, file layout, dedupe and hour allocation | Consistent, no re-deriving in a prompt |
| Text is plain, up to about 160 characters, with no semicolons, colons, pipes, asterisks, hashes, dashes or apostrophes, and no agent or skill names | The log is a timesheet for people |
| Duplicate detection: about 70% similar text on the same ticket and day is skipped | Agents and people both log |
| Weight 1 to 5 is a share of the day; hours only for a fixed block such as a meeting; a day length override exists | Fair splits without guessing |
| Categories: Development, Code Review, Testing, Design, Documentation, Internal | Reporting |
| Meetings and leave use special tickets, never delivery tickets | Clean timesheets |
| Agent runs are attributed to the person who ran them | A person is accountable for the work |

## Commands (draft)

```
hl log-work T-014 "Chose TOML for records and wrote the format map" --weight 3
hl log-work Internal "Daily scrum" --hours 0.5 --category Internal
hl log show --week            # my week, grouped by ticket
hl log summary --all          # team timesheet by ticket
```

## Where it shows up

- **Console:** the Work view and the Today card on the Overview (mockup 1).
- **Obsidian:** a generated daily note per person (F52), so the log joins the graph.
- **Reports:** timesheet by ticket, weekly summary and the standup digest (F6c).
- **Telegram:** no log command (F6b, Blueprint 24).
- **Hooks:** a Stop hook can remind you to log at session end, as in lc-wms.

## Relationship to the audit trail (F70)

The work log is human intent in your words, once per piece of work. The audit trail is every verb call by every actor. They are different files for different readers.

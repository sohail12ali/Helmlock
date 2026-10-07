# Milestone 1: the `hl` verb list (frozen contract)

Every stream and every skill uses exactly these verbs. Grammar is noun then verb. Every read verb takes `--json`; every write verb takes `--dry-run`. Exit codes: 0 ok, 1 error, 2 blocked by a gate. Every verb works with no server running.

Ids: tickets `T-014-sa` (counter plus author initials), records `D-003-sa` (decision), `Q-` (question), `B-` (bug), `G-` (gap), todos `TD-007-sa`, tasks `S1-T1` (slice, task).

| Verb | Arguments and flags | Owner stream |
|---|---|---|
| `hl where` | `--json` | S1 |
| `hl doctor` | `--repair`, `--json` | S1 |
| `hl help agent` | prints the agent contract | S1 |
| `hl config show` | `--json` | S1 |
| `hl init <dir>` | `--name`, `--author`, `--initials`, `--email`, `--delivery <path>`, `--yes`, `--dry-run` | S6 |
| `hl project add <folder-name>` | `--path`, `--id`, `--yes`, `--dry-run` | S6 |
| `hl ticket new "<title>"` | `--project`, `--size S\|M\|L`, `--priority`, `--goal` | S3 |
| `hl ticket show <T>` / `hl ticket list` | `--stage`, `--mine`, `--json` | S3 |
| `hl ticket move <T> <stage>` | exits 2 when a gate blocks | S3 |
| `hl ticket block <T>` / `hl ticket unblock <T>` | `--by "<who or what>"`, `--next "<next action>"` | S3 |
| `hl ticket claim <T>` / `hl ticket release <T>` | a second claim exits 1 and is never retried | S3 |
| `hl ticket comment <T> "<text>"` | | S3 |
| `hl decision add <T> "<title>"` | `--chosen`, `--why`, `--rejected` (repeatable) | S3 |
| `hl question add <T> "<text>"` | `--blocking`, `--option` (repeatable) | S3 |
| `hl question answer <Q> "<answer>"` | | S3 |
| `hl bug add <T> "<title>"` / `hl gap add <T> "<text>"` | `--severity` / `--category` | S3 |
| `hl blockers <T>` | open blocking questions, bugs, gaps; `--json` | S3 |
| `hl task add <T> "<title>"` | `--slice S1`, `--layer db\|api\|ui\|test\|env\|spike\|docs`, `--ac AC-1` (repeatable), `--estimate` | S3 |
| `hl task set <T> <task-id>` | `--status todo\|doing\|done\|blocked`, `--actual` | S3 |
| `hl validate [<T>]` | `--changed <file>`, `--json` (budget: under 300 ms for one file) | S3 |
| `hl todo add "<text>"` | `--ticket`, `--due`, `--priority` | S4 |
| `hl todo done <TD>` / `hl todo list` | `--json` | S4 |
| `hl log-work <T or -> "<one sentence>"` | `--category`, `--weight 1-5`, `--hours` | S4 |
| `hl log show` | `--week`, `--author`, `--json` | S4 |
| `hl context <T>` / `hl context --session` | `--json` (digest: ticket, stage, blocked, open questions, next, files) | S4 |
| `hl search "<query>"` | `--archived`, `--json` | S4 |
| `hl skill list` / `hl skill find "<query>"` | `--json`; same-named skills in several layers are all shown | S4 |
| `hl harness sync` | `--check` | S5 |
| `hl harness lint` | `--json` | S5 |
| `hl run "<task>"` | `--runtime claude\|cursor`, `--agent <role>`, `--ticket <T>`, `--mode plan\|ask\|auto-review\|force` | S5 |

Stages (workflow-lite): `backlog`, `spec`, `plan`, `build`, `verify`, `done`. Blocked is a flag that needs `--by` and `--next`.

Work log categories: Development, Code Review, Testing, Design, Documentation, Internal.

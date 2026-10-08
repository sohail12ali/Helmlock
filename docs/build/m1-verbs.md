# Milestone 1: the `hl` verb list (frozen contract)

Every stream and every skill uses exactly these verbs. Grammar is noun then verb. Every read verb takes `--json`; every write verb takes `--dry-run`. Exit codes: 0 ok, 1 error, 2 blocked by a gate. Every verb works with no server running.

Ids: tickets `T-014-sa` (counter plus author initials), records `D-003-sa` (decision), `Q-` (question), `B-` (bug), `G-` (gap), todos `TD-007-sa`, tasks `S1-T1` (slice, task).

| Verb | Arguments and flags | Owner stream |
|---|---|---|
| `hl where` | `--json` | S1 |
| `hl doctor` | `--repair`, `--json` | S1 |
| `hl help agent` | prints the agent contract | S1 |
| `hl config show` | `--json` | S1 |
| `hl init <dir>` | `--name`, `--author`, `--slug`, `--initials`, `--email`, `--no-git`, `--delivery <path>`, `--yes`, `--dry-run` | S6 |
| `hl project add <folder-name>` | `--path`, `--id`, `--name`, `--yes`, `--dry-run` (the dry run warns when the folder does not exist yet); console verb (milestone 7) | S6 |
| `hl project import <file.code-workspace>` | `--folders a,b` (default: every addable folder), `--yes`, `--dry-run`; skips the knowledge and system folders, folders already in the workspace and missing folders, each with a reason; same writes as `project add`; console verb (milestone 7) | S6 |
| `hl ticket new "<title>"` | `--project`, `--size S\|M\|L`, `--priority`, `--goal` | S3 |
| `hl ticket show <T>` / `hl ticket list` | `--stage`, `--mine`, `--json` (show includes tasks and record counts) | S3 |
| `hl ticket move <T> <stage>` | exits 2 when a gate blocks | S3 |
| `hl ticket block <T>` / `hl ticket unblock <T>` | `--by "<who or what>"`, `--next "<next action>"` | S3 |
| `hl ticket set <T>` | `--size`, `--priority`, `--title`, `--summary`, `--project`, `--goal` | S3 |
| `hl ticket claim <T>` / `hl ticket release <T>` | a second claim exits 1 and is never retried | S3 |
| `hl ticket comment <T> "<text>"` | | S3 |
| `hl decision add <T> "<title>"` | `--chosen`, `--why`, `--rejected` (repeatable) | S3 |
| `hl question add <T> "<text>"` | `--blocking`, `--option` (repeatable) | S3 |
| `hl question answer <Q> "<answer>"` | | S3 |
| `hl bug add <T> "<title>"` / `hl gap add <T> "<text>"` | `--severity` / `--category` | S3 |
| `hl bug resolve <B>` / `hl gap resolve <G>` | `--fixed-in` / `--note` | S3 |
| `hl blockers <T>` | open blocking questions, bugs, gaps; `--json` | S3 |
| `hl task add <T> "<title>"` | `--slice S1`, `--layer db\|api\|ui\|test\|env\|spike\|docs`, `--ac AC-1`, `--depends <task-id>`, `--file <path>` (all repeatable), `--estimate` | S3 |
| `hl task list <T>` | `--json` | S3 |
| `hl task set <T> <task-id>` | `--status todo\|doing\|done\|blocked`, `--actual` | S3 |
| `hl validate [<T>]` | `--changed <file>`, `--json` (budget: under 300 ms for one file) | S3 |
| `hl todo add "<text>"` | `--ticket`, `--due`, `--priority` | S4 |
| `hl todo done <TD>` / `hl todo list` | `--json` | S4 |
| `hl log-work <T or -> "<one sentence>"` | `--category`, `--weight 1-5`, `--hours` | S4 |
| `hl log show` | `--week`, `--author`, `--json` | S4 |
| `hl log edit <date> <entry id or position>` | `--text`, `--category`, `--ticket`, `--weight` (unpins), `--hours` (pins), `--hash`, `--dry-run` | Work page |
| `hl log remove <date> <entry id or position>` | `--hash`, `--dry-run` | Work page |
| `hl log day-hours <date> <hours>` | stated day length, 0 clears; `--hash`, `--dry-run` | Work page |
| `hl context <T>` / `hl context --session` | `--json` (digest: ticket, stage, blocked, open questions, next, files) | S4 |
| `hl search "<query>"` | `--archived`, `--json` | S4 |
| `hl skill list` / `hl skill find "<query>"` | `--json`; same-named skills in several layers are all shown | S4 |
| `hl harness sync` | `--check` | S5 |
| `hl harness lint` | `--json` | S5 |
| `hl run "<task>"` | `--runtime claude\|cursor`, `--agent <role>`, `--ticket <T>`, `--mode plan\|ask\|auto-review\|force` | S5 |
| `hl run report` | `--outcome done\|review\|blocked\|needs-input`, `--summary "<one sentence>"`, `--next "<step>"`, `--next-role <role>`, `--run <id>` (default HL_RUN_ID); called by the agent at the end of a run: a server-started run posts it to the server, otherwise it is filed in `runs/reports/<id>.json` and recorded when the run ends (F154) | M8 |
| `hl provider add <id>` | `--preset`, `--base-url`, `--key-env <NAME>`, `--model` or `--models` (repeatable, at least one), `--label`; first model becomes the default when there is none | M7 |
| `hl provider remove <id>` | removes the provider and its models; refuses when it holds the default model unless `--force` (the default then moves to the first remaining model, or is cleared) | M7 |
| `hl model add <provider> <model...>` | adds models to a saved provider; models already there are skipped and named | M7 |
| `hl model remove <model-id>` | `--default <model-id>` is required when removing the default model; role models naming it are cleared | M7 |
| `hl model default <model-id>` | the model must be configured | M7 |
| `hl model list` | `--json`; the default model is marked `*` | M7 |
| `hl secret set <NAME>` | value from a hidden prompt, or stdin when piped (`hl secret set NAME < file`); never on the command line (`--value` is refused). Writes `NAME=value` to the knowledge repo's gitignored `.env` (adds `.env` to `.gitignore` if missing); output and activity carry the name only. Not offered to the assistant or Telegram. | M7 |
| `hl secret status [NAME...]` | where each name is found: `environment`, `.env` or `missing` (default: the Telegram token variable and every provider `key_env`); never values; `--json` | M7 |
| `hl crew show` | the crew roles (from the agent pack plus the `crew` row of workspace.toml) with engine, model, worktree and permission mode, and the stage -> role map; `--json` | M8 |
| `hl crew set <role>` | `--engine <id>` (must be registered), `--model <id>` (checked against the configured models when the engine is `loop`; `""` clears), `--worktree true\|false`, `--mode plan\|ask\|auto-review`, `--dry-run`; writes the `crew` row of workspace.toml | M8 |

Stages (workflow-lite): `backlog`, `spec`, `plan`, `build`, `verify`, `done`. Blocked is a flag that needs `--by` and `--next`.

Work log categories: Development, Code Review, Testing, Design, Documentation, Internal.

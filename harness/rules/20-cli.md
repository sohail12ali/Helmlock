## Using the hl CLI

Rule: change state with `hl <noun> <verb>`; edit prose directly. Every read verb takes `--json`; every write verb takes `--dry-run`. Every verb works with no server running.

| Command | Use |
|---------|-----|
| `hl context {T} --json` | start here: stage, blocked, open questions, next, files |
| `hl ticket show {T}` / `hl ticket list --mine` | one ticket / my tickets |
| `hl ticket move {T} {stage}` | land the ticket in a lane |
| `hl ticket block {T} --by ... --next ...` | flag that you wait on someone |
| `hl question add {T} "..." --blocking` | ask or record a decision that must be answered |
| `hl decision add {T} "..." --chosen ... --why ...` | record a decision and its reason |
| `hl task add {T} "..." --slice S1 --layer api --ac AC-1` | add a task |
| `hl task set {T} {task} --status done --actual 2` | update a task |
| `hl blockers {T}` | open blocking questions, bugs and gaps |
| `hl validate {T}` | check layout and the AC to task trace |

Exit codes: 0 ok, 1 error, 2 blocked by a gate (read the message; do not retry blindly). Unknown command or flag: `hl help agent` prints the full contract.

# Blueprint 10: agent and CLI integration (draft)

Recommended answer to "should agents invoke the CLI or modify files themselves": **both, split by file type.** Prose is edited directly. State goes through the CLI. This is card F57; everything below is the draft if you accept it.

## Who writes which file

| File kind | Agent may edit directly | How it changes |
|---|---|---|
| Markdown prose: spec, plan, notes, wiki | Yes | Edit tool, then a hook runs `hl validate` |
| TOML records and `workspace.toml` | No (denied) | `hl <noun> <verb>` |
| JSONL logs and events | No | `hl log-work`, run events |
| Generated Obsidian notes and HTML pages | Never, and not read either | `hl notes sync`, `hl pages build` |

## What the agent sees in the main CLAUDE.md (about 15 lines)

```markdown
## Working here
- State lives in TOML and JSONL. Change it only with the CLI: `hl <noun> <verb>`. Never edit *.toml or *.jsonl by hand.
- Prose (spec, plan, notes, wiki) is markdown: edit it directly.
- Start every task with `hl context <ticket>`; it prints a digest (add --json).
- Common: `hl ticket move T-014 plan` | `hl decision add` | `hl question add` | `hl bug add` | `hl todo add` | `hl log-work` | `hl search <text>` | `hl validate`
- Exit codes: 0 ok | 1 error | 2 blocked by a gate (read the message; do not retry blindly).
- Unknown command? `hl help agent` prints the full contract.
- Never read generated files under site/ or the generated notes.
```

`hl` is a placeholder; the real name follows the console name (F23). The full reference stays out of CLAUDE.md and is printed on demand (F58).

## Enforcement (assumed settings syntax, verify against current Claude Code docs)

```json
{
  "permissions": {
    "deny": ["Edit(**/*.toml)", "Write(**/*.toml)", "Edit(**/*.jsonl)", "Write(**/*.jsonl)", "Read(site/**)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "hl validate --changed" } ] }
    ]
  }
}
```

Deny rules stop the edit tools, not a shell command that writes a file. So the layers are: deny rules, then the validate hook, then a pre-commit hook and CI, then git history as the audit trail. If the CLI is missing, the agent must stop and say so rather than edit TOML.

## The CLI contract for agents

| Rule | Why |
|---|---|
| Every read command accepts `--json` | Agents parse, people read the default output |
| Exit 0 ok, 1 error, 2 blocked by a gate | Gates (open blockers, missing approval) are first-class |
| Writes accept `--dry-run` | Preview before change |
| Prompts only in a terminal and only when arguments are missing | Never blocks an agent |
| Errors name the file, the rule and the fix | The agent can self-correct |

Example digest an agent gets from `hl context T-014 --json`:

```json
{"ticket":"T-014","stage":"plan","blocked":false,"open_questions":2,
 "next":["answer Q-3","freeze spec"],"files":["T-014-spec.md","T-014-plan.md"]}
```

## Experience for people (F56)

Readable tables and colour in a terminal, plain output when piped, examples in every `--help`, typo suggestions ("did you mean"), `hl doctor` for setup problems, and a launcher generated into the knowledge repo so `hl` works right after cloning (F60). Command grammar is noun then verb (F55): `hl ticket move`, `hl decision add`.

## Where the pieces live

- The CLI is a plugin slot (F41), so the front-end can be replaced; the verb registry underneath is core.
- The launcher is generated into the knowledge repo and points at the delivery repo from the `.code-workspace` folders, so the delivery repo never knows the workspace.
- MCP can wrap the same verbs later as an optional plugin; the CLI stays the contract.

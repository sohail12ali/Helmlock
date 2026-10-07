# Blueprint 9: which format for which job (recommendation)

**Rule of thumb: three jobs, three formats.** Author in Markdown (prose) and TOML (structure). Append in JSONL (history). Generate HTML for humans. JSON and YAML appear only where a host, API or CI requires them. Never author HTML or CSS.

## Format by job

| Job | Format | Written by | Why | Lives in |
|---|---|---|---|---|
| Prose: spec, plan, notes, wiki, rationale, release notes | **Markdown** | agents and people | Cheapest prose; readable anywhere | knowledge repo |
| Structured records: ticket state, decisions, questions, bugs, gaps, tasks, todos | **TOML** | console verbs only | Standard-library reader, comments, clean diffs, arrays of tables | knowledge repo |
| Workspace config: `workspace.toml`, `workspace.local.toml` | **TOML** | onboarding, people | Same family as records | knowledge repo |
| History: work log, chat history, activity events, run records | **JSONL** | machines | Append-safe, one line per event, standard library | knowledge repo |
| Generated indexes: artifact map, search index | **JSON** (compact) | program | Machine-only, regenerated, not committed | knowledge repo |
| Human views: ticket pages, board, reports | **HTML**, generated | program | Never authored; agents never read it | knowledge repo `site/` or served live |
| Diagrams inside prose | **Mermaid-style text** in a markdown fence | agents | Compact and familiar to models (F50) | knowledge repo |
| Plugin manifest, workflow pack, verbs, roles, console config | **TOML** | people | Comments allowed; one config language | delivery repo |
| Agent and skill definitions | **Markdown + YAML frontmatter** | people, agents | Required by Claude Code | delivery repo `.claude/` |
| Prompts: `assistant.md`, `house-style.md` | **Markdown** | people | Prose | delivery repo |
| Viewer: shell HTML, JS, CSS | **HTML / JS / CSS** | developers | Shipped once, cached, shared by every page | delivery repo |
| Theme override | **CSS variables file** | people | Tokens only (F51) | knowledge repo, optional |
| Host and API wire: `.claude/settings.json`, `.mcp.json`, LLM tool schemas | **JSON** | host or generated | Required by the tool; tool schemas are generated from `verbs.toml` | both |
| CI workflows | **YAML** | people | Required by CI | delivery repo |
| Editor workspace file | **JSON** (`.code-workspace`, plus a committed `.code-workspace.template`) | people, scaffold | VS Code requires it. The CLI reads `folders`; only `hl init` and `hl project add` write it, with a dry run and confirmation. Repo paths live here, not in `workspace.toml` | knowledge repo |

## What each format is good at

| Format | People edit | Diffs | Comments | Python read (stdlib) | Python write (stdlib) | Best for |
|---|---|---|---|---|---|---|
| Markdown | yes | great | n/a | text | text | prose |
| TOML | yes | great | yes (lost on rewrite) | yes, 3.11+ | **no**, needs a small emitter | records, config |
| YAML | yes | good | yes | **no** | **no** | host frontmatter, CI only |
| JSON | awkward | noisy | no | yes | yes | machine data, wire |
| JSONL | rarely | great, per line | no | yes | yes | logs, events |
| HTML | no | noisy | n/a | n/a | n/a | generated output only |
| CSS | yes | fine | yes | n/a | n/a | one shared file with variables |

## Measured: the same 8 decision records in each format

| Format | Characters | About tokens | vs TOML |
|---|---|---|---|
| TOML | 2,531 | 632 | 100% |
| YAML | 2,588 | 647 | 102% |
| JSON, compact | 2,442 | 610 | 96% |
| JSON, indented | 3,310 | 827 | 131% |
| JSONL | 2,407 | 601 | 95% |
| Markdown table | 1,898 | 474 | 75% |
| HTML table | 2,434 | 608 | 96% |
| HTML with inline CSS | 6,051 | 1,512 | 239% |

(About 4 characters per token, so a rough guide only.)

**What this tells us.** TOML, YAML and compact JSON differ by under 5%, so tokens should not pick between them. What costs tokens is inline styling (2.4 times), indented JSON (+31%), and how much you make an agent read. A markdown table is the smallest, but it flattens lists and is not safe for programs to write.

Choose formats by safety, standard-library support and host requirements. Save tokens by keeping styling out of anything an agent reads and by loading digests instead of whole files.

## Do and do not

- **Do** keep state in TOML and only change it through verbs. **Do not** put state in markdown frontmatter.
- **Do** use JSONL for anything appended to. **Do not** append to TOML.
- **Do** use YAML only where Claude Code or CI demands it. **Do not** author YAML data.
- **Do** generate HTML from data on a shared viewer. **Do not** let an agent write HTML or CSS.
- **Do** keep one config language (TOML) so a contributor learns one thing.

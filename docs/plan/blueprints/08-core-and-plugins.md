# Blueprint 8: core and plugins (draft)

A plugin container kernel (F40, decided 2026-10-07) and everything else a plugin, so the CLI, agent setup, voice, assistant, ticket model and statuses can each be replaced or reconfigured. Choices are in the **Core and plugins** phase (F40 to F48); this is the recommended shape.

## The kernel (about 500 lines of TypeScript, F40)

The kernel only knows how to load plugins. It has four primitives: a **context tree**, a **service registry** with `requires`, **scoped effects** that return a disposer, and **events**. Loading reads the plugin list from `workspace.toml`, merges config (plugin defaults, `workspace.toml`, `workspace.local.toml`, launch flags) and applies plugins in dependency order.

## Required built-in plugins (provide services; cannot be turned off)

| Built-in | Service | Job |
|---|---|---|
| File layer | `files` | Atomic TOML and JSONL read/write, schema versions, the layout validator |
| Verb registry | `verbs` | One table of verbs (`ticket-move`, `todo-add`, `log-work`) that every front door calls |
| Approval gate | `approvals` | The ask/never rule for risky actions, fail-closed |

Other built-ins (viewer shell, workflow, tickets, CLI and the rest) are ordinary plugins that can be swapped.

Rule: **the core never names a ticket status, an agent, a model, a channel or a voice engine.**

## Slots and default plugins

| Slot | Cardinality | Default plugin | Swap examples |
|---|---|---|---|
| Workflow | one | `workflow-lite` (6 lanes) | `workflow-lc-wms` (7 lanes), your own pack |
| Tickets | one | `tickets-toml` | a different ticket model or id scheme |
| Artifact kinds | many | decision, question, bug, gap, task, todo | add `risk`, `adr` |
| CLI | one | `cli-default` | a branded command name or different UX |
| Agent pack | one | `agents-lite` (6 roles, 14 skills) | a leaner or larger set |
| Agent runtime | many | `claude-code` | `openai-compatible` loop |
| Model provider | many | `openai-compatible` | Anthropic, Ollama, OpenRouter |
| Assistant | one | `assistant-chat` | another persona or engine |
| Voice | one | `voice-web-speech` | `voice-whisper-piper` |
| Channels | many | `telegram` | Slack |
| Views | many | dashboard, board, ticket page | extra tabs and widgets |

*One* means a single active provider (a swap). *Many* means providers add up. Cardinality is declared per slot (F45).

## A plugin manifest (`plugin.toml`)

```toml
id = "voice-web-speech"
kind = "code"                 # "pack" for declarative plugins (config, templates, no code)
version = "0.1.0"
requires_core = ">=1,<2"      # refuse to load on an incompatible core
fills = ["voice"]
entry = "index.ts"            # code plugins only: exports name, requires, Config, apply

[settings.read_aloud]         # the Settings screen is generated from these
type = "bool"
default = false
label = "Read replies aloud"

[settings.language]
type = "string"
default = "en-US"
label = "Language"
```

## The workspace picks and configures (`workspace.toml`, in the knowledge repo)

```toml
[workspace]
name = "acme-knowledge"
console_name = "Acme Console"

plugin_dirs = ["plugins"]      # optional workspace packs and plugins (F43)
```

Plugin rows follow the composition shape below (F103). Repo paths are not here; they come from the `.code-workspace` folders.

The delivery repo ships built-in plugins and their defaults. The knowledge repo enables them, holds their settings and may declare its own plugin folders for workspace packs (F43). The delivery repo never lists a workspace.

## Statuses as a plugin (a declarative pack, `workflow.toml`)

```toml
id = "workflow-lite"
kind = "pack"
fills = ["workflow"]

[[stage]]
id = "spec"
label = "Spec"
agent = "analyst"

[[stage]]
id = "plan"
label = "Plan"
agent = "planner"
wip = 3

[[transition]]
from = "spec"
to = "plan"
gate = "questions-blockers"   # a verb that must exit 0
```

The board, the validator, the agents and the ticket page all read this file. To change statuses, edit it or swap the pack. Switching packs on existing tickets needs a stage map (old stage to new stage).

## How a status change flows

1. You or an agent runs `ticket-move T-001 plan`.
2. The verb registry sends it to the workflow plugin, which checks the transition and its gate.
3. The tickets plugin writes `ticket.toml` through the file layer.
4. The core announces `ticket.moved`.
5. Views refresh, the work log appends a line, and Telegram notifies, each as separate plugins that only listen.

## Design rules

1. The core never names a stage, agent, model or channel.
2. Plugins talk through services, verbs, hooks and events, never by importing each other (F102).
3. Any setting a plugin adds is declared in its manifest, so the Settings screen needs no new code.
4. Defaults ship with the plugin; the workspace chooses and overrides.
5. A plugin that cannot load says why and leaves the rest running.

## Refinement after studying deepseek-harness (iteration 13)

deepseek-harness builds everything on a small kernel (the Cordis framework: about 2.7k lines, plus a 1k-line loader). Its weight comes from packaging ceremony, not from the mechanism. The TypeScript version (F40, decided) keeps the mechanism and skips the ceremony (F40 option "container").

**Kernel primitives (about 500 lines):** a context tree with a service registry; `requires` that hold a plugin pending until its services exist and restart dependents when a provider changes; scoped effects undone on dispose; events.

**One plugin form** (F101):

```ts
// plugins/permission-gate/index.ts
export const name = "permission-gate";
export const requires = ["verbs"];                    // held pending until ctx.verbs exists
export const Config = z.object({ timeoutMs: z.number().optional() });

export function apply(ctx: Context, cfg: z.infer<typeof Config>) {
  ctx.on("verb/pre-execute", gate, { priority: 10 });  // returns a disposer; undone on unload
  ctx.guard("verb", (call) => denyReason(call));       // can only deny; order cannot undo it
}
```

**Config as composition** (F103): rows, not a flat table.

```toml
[[plugin]]
id = "workflow"
use = "workflow-lite"

[[plugin]]
id = "voice"
use = "voice-web-speech"
[plugin.config]
read_aloud = true

bundles = ["delivery-lite"]      # data-only presets of rows (our declarative packs)
```

Layers, in order: bundle defaults, `workspace.toml`, `workspace.local.toml`, launch flags. A patch targets a row by id; an unmatched id is an error. `hl config show` prints the composed rows and the layer each came from.

**Hooks** (F102): named `domain/stage`, for example `verb/pre-execute`, `verb/post-execute`, `agent/pre-run`, `llm/request`, `approval/request`. Each declares its mode. Order is an explicit priority (F104).

**Built-in plugins (about 15, not 200):** file layer, verb registry, approval gate, workflow-lite, tickets-toml, agents-lite, cli-default, assistant-chat, providers, views, telegram, voice-web-speech, work-log. A few are marked required; a startup audit lists anything pending (F105).

**What we leave:** one package per plugin, bundles as separate packages, module hot reload, doc and coverage gates, a vendored and patched framework, a plugin-manager UI in v1.

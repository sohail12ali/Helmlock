# Blueprint 12: one provider layer for any model (draft)

Ollama, LM Studio, vLLM, llama.cpp, OpenRouter, OpenAI and most gateways speak the same OpenAI-style protocol. So there is **one adapter and one table**. A new server is a row of configuration, not a code change. This is the shape recommended in F11a, F72 to F78, and it is the part of deepseek-harness worth copying most.

## Three layers

| Layer | Describes | Example |
|---|---|---|
| Provider | An endpoint: protocol, base URL, auth, headers, compat switches | `ollama`, `lmstudio`, `openrouter` |
| Model | One model on a provider: context window, max tokens, capabilities | `ollama/qwen3:14b` |
| Role | Which model does which job | assistant, agents, summariser |

## Configuration (draft, TOML)

Shared, committed (`workspace.toml`): which providers and models exist, no secrets.

```toml
[providers.ollama]
preset = "ollama"                       # fills protocol, base URL, keyless, compat
models = ["qwen3:14b"]

[providers.lmstudio]
preset = "lmstudio"

[providers.openrouter]
preset = "openrouter"
api_key_env = "OPENROUTER_API_KEY"      # the NAME of an environment variable, never the key

[models."ollama/qwen3:14b"]
context_window = 32768
max_tokens = 4096
tool_calls = true
reasoning_efforts = {}                  # none; or { low = "low", high = "high" } to show an Effort menu

[roles]
assistant = "openrouter/anthropic/claude-sonnet"
agents    = "ollama/qwen3:14b"
summariser = "ollama/qwen3:14b"
```

Per machine (`workspace.local.toml`, gitignored): URLs that differ per machine.

```toml
[providers.ollama]
base_url = "http://192.168.1.20:11434/v1"
```

## A preset file (ships with the provider plugin)

```toml
id = "ollama"
label = "Ollama (local)"
protocol = "openai-completions"
base_url = "http://localhost:11434/v1"
auth = "optional"                       # keyless is fine; no dummy key needed

[compat]
developer_role = false                  # keep the system role
max_tokens_field = "max_tokens"
reasoning_effort = false
usage_in_stream = true
```

| Preset | Default base URL | Notes |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | Keyless. Server-side context length decides truncation |
| LM Studio | `http://localhost:1234/v1` | Keyless. Load the model in the app first |
| vLLM | `http://localhost:8000/v1` | Often keyed or keyless by deployment |
| llama.cpp server | `http://localhost:8080/v1` | Keyless |
| OpenRouter | `https://openrouter.ai/api/v1` | Key by env var |
| OpenAI | `https://api.openai.com/v1` | Key by env var |
| Custom | you type it | One row per protocol |

(Default ports are the usual ones; confirm on your machine. The presets are drafts and untested.)

## Compat switches worth keeping

| Switch | Fixes |
|---|---|
| `developer_role = false` | Gateways that reject the `developer` role used for reasoning models |
| `max_tokens_field` | `max_tokens` versus `max_completion_tokens` |
| `reasoning_effort` | Server does not accept the parameter |
| `usage_in_stream` | Server does not report usage while streaming |
| `tool_calls` (model) | Model cannot call tools; assistant falls back to chat and search (F77) |
| `thinking_format` | Servers that return reasoning in a different field |

deepseek-harness has about thirty switches. Start with these six and add one only when a real server needs it. Unknown or misspelled keys are refused at load time.

## What happens on a request

1. A role picks a model; the model names its provider.
2. Config is read fresh, so edits apply with no restart.
3. The adapter builds the request for the protocol and applies compat switches.
4. Token estimate versus `context_window`; warn near the limit; shorten old turns (F74).
5. Stream tokens; an idle timeout (longer for local servers) raises a timeout error.
6. Classify errors by HTTP status first; retry only retryable codes, honour Retry-After (F75).
7. Append a usage line (tokens, speed, time to first token) and an audit line (F78, F70).

## Credentials

Keys are never in the repo. A provider names an environment variable. Lookup order (draft): launch environment, then a user-level `.env`, then the workspace `.env` (gitignored). The settings screen writes keys only to the user-level file and never shows them again.

## Test connection (F73)

`hl provider test ollama` and the Settings button: reach the server, list models (`GET {base_url}/models`), send a tiny prompt, try streaming and a tiny tool call, then save what was learned (tool calls, context size if the server reports it) into the model row. Model discovery returns candidates; nothing is stored until the user adds them.

## Local-model problems in deepseek-harness, and our answer

| Problem there | Our design |
|---|---|
| A keyless server fails unless a dummy key is set | `auth = "optional"`: no key, no header |
| Unknown context window is guessed as 262,144 tokens | Per-model `context_window`, probed or required; warn when unknown |
| Default compaction needs 65k of headroom, breaks small windows | Thresholds are a ratio of the model's own window |
| No flag for models without tool calling | `tool_calls` capability and a graceful fallback |
| 300 s idle timeout and 5 short retries can trip on cold loads | Local presets with longer timeout and backoff |
| Errors classified by message regex | Classify by HTTP status first |
| No Test connection, no Ollama or LM Studio docs or presets | Test connection and shipped presets |
| Only temperature and max tokens passed | A small `params` and `extra_body` passthrough per model (for example Ollama options) |

## Verbs (draft)

`hl provider add|list|test|models|remove`, `hl model add|set-default`, `hl role set assistant ollama/qwen3:14b`.

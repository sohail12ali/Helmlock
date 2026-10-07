# Blueprint 15: stack decision sheet (measured on this machine)

> **Superseded in part (2026-10-07):** the stack is now TypeScript everywhere (F0a decided). The measurements below stay valid; the recommendation for Python is replaced. See Blueprint 23.

Evidence for F0a, F110 and F109. Machine: Windows 11, Python 3.14.0, Node 24.11, Rust 1.98.1, uv 0.9.11. Each number is the median of 30 runs after 3 warm-ups, started from a fresh process; noise is about 10 to 15 ms. **Not installed here, so not measured: Go, Bun, Deno.** .NET 10 is installed but not an option in the plan.

## How long one CLI call takes

| What was run | Median | 95th percentile |
|---|---|---|
| Rust hello (native binary, floor for process start on this machine) | 16 ms | 19 ms |
| Python, empty script | 43 ms | 49 ms |
| Node, empty script | 57 ms | 64 ms |
| Node with fs, path, os, http imports | 65 ms | 76 ms |
| Python with typical CLI imports (argparse, json, tomllib, pathlib, re, datetime) | 80 ms | 133 ms |
| `uv run python`, empty | 112 ms | 237 ms |
| **Our real stdlib CLI** (`plan build.py --status`, reads and validates about 300 KB of JSON) | **137 ms** | 160 ms |
| **Python through the `py` launcher, empty** | **166 ms** | 196 ms |

**What this says.** A native binary is about 16 ms; Python is 40 to 140 ms depending on imports. A delivery session may make 30 to 100 CLI calls: roughly 3 to 14 seconds of process start in total, against minutes of model time. It is acceptable, not free. The two avoidable costs are the `py` launcher (about 120 ms extra) and heavy imports.

## How to keep a Python CLI fast

| Rule | Why (measured or typical) |
|---|---|
| Never start Python through the `py` launcher in scripts or hooks; call `python` by path | The launcher added about 120 ms (166 ms against 43 ms) |
| Import server-only modules (`http.server`, `asyncio`, `urllib.request`) inside the commands that need them | Each cost roughly 85 to 105 ms on its own; the rest of the standard library was too small to separate from noise |
| Use `python -S` when no third-party packages are needed | Saved about 18 ms (41 ms against 59 ms in the second run) |
| Keep hot verbs cheap: read only the files they need; precompute a digest for `hl context` | The real CLI above spent most of its time reading and validating files |
| Do not ship the CLI as a one-file PyInstaller executable | It unpacks on every start; typically slower (typical, not measured here) |
| If call volume ever matters, add the optional native launcher or a resident process (F110) | Native forward is about 16 ms plus about 1 ms for the request |

## How fast is a local server

Test: one endpoint that reads a 54 KB JSON file and re-serialises it on every request.

| Server | Start to first response | New connection, median / p95 | Keep-alive, median / p95 |
|---|---|---|---|
| Python standard library threading server | 596 ms | 2.35 ms / 3.88 ms | 0.80 ms / 1.75 ms |
| Node http server | 527 ms | 1.52 ms / 2.43 ms | 0.73 ms / 1.27 ms |

**What this says.** Both answer in a millisecond or two. For a single-user local console, server speed is not a reason to pick a language. The UI's own work, such as rendering and animation, matters far more.

## UI performance budget (F109)

| Rule | Target |
|---|---|
| Response to a click or keypress | within 100 ms |
| First paint of a page on localhost | within 300 ms |
| Animation | 60 frames per second; animate only `transform` and `opacity`, never layout properties |
| Motion tools | CSS transitions, the Web Animations API, View Transitions; no animation library unless a screen needs one |
| Accessibility | respect `prefers-reduced-motion` |
| Long lists | page or virtualise past a few hundred rows |
| Live updates | batch to at most one UI update per 250 ms |
| Weight | a size budget for page JavaScript, checked in CI |

Animation quality comes from the browser and the UI code, not from the server language. A Python server can feed a very animated UI.

## How often does anything have to run?

| Part | Needs a running process? |
|---|---|
| CLI verbs, skills, agents | No. Every verb works on files (F110) |
| Generated ticket pages and notes | No. They are files you can open (F28, F52) |
| Live console (board, dashboard, chat) | Yes, the server; start it with `hl serve` or on demand |
| Telegram bot | Yes, a long-running poller (a plugin) |

## Where each option lands

See the **Weigh it yourself** panel on F0a. At default weights Python plain (82%) and Python with a built UI (80%) are close at the top. The UI plugin is swappable, so the plain option does not close the door on a richer UI later.

What would change the recommendation:
- **A fancy, animated UI on day one is the top priority:** Python with a built UI, or TypeScript.
- **Handing a single file to non-developers matters most:** Go or Tauri (accepting weaker plugins).
- **You want one language for a large team-built UI:** TypeScript.
- **CLI latency becomes a real complaint:** keep Python and add the native launcher (F110).

## Where the tokens actually go (iteration 23)

The language hardly changes what an agent reads. What costs tokens is how much code a change makes it open.

| Source | Size | Rough tokens | Lesson |
|---|---|---|---|
| control-center UI (plain JS, CSS, HTML) | 682 KB | about 170k | Plain JS is not small by itself; settings.js alone is 125 KB and styles.css 115 KB |
| This plan viewer (plain JS, CSS) | 81 KB | about 20k | Same approach, small files and a render helper, many more screens |
| paperclip UI | React, Radix, TanStack, Tailwind; 43 UI dependencies | not measured | Rich, but each screen is a component tree an agent must read |

Levers that work whatever the language:

1. Agents read TOML, markdown and JSONL, never HTML or CSS (decided).
2. UI size rules for the views plugin: one view per file under about 300 lines, one shared helper, no screen that mixes data and layout.
3. Screens as data where they can be (the mockup text format in this plan is 66 tokens for a card against 149 as markup).
4. Colours, fonts, radius and density as theme tokens, so a restyle edits a few lines of TOML.
5. CLI output compact by default; `--json` and `--verbose` opt in.

Check on the TypeScript row: Node 24.11 on this machine runs a `.ts` file directly (type stripping, no compile step), so TypeScript no longer needs a build for server code. It still means a rewrite of the Python you own and `npm install` for dependencies.

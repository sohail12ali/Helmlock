# Milestone 1 start-time baseline (wave 0, 2026-10-07)

Measured on the user's Windows 11 machine, Node 24.11.0:

| What | Time |
|---|---|
| `node -e 0` | 183 to 201 ms |
| `import("zod")` | 113 ms |
| `import("zod/mini")` | 101 ms |
| `import("smol-toml")` | 10 ms |
| `hl where` (walking skeleton) | 442 to 448 ms |

Node's own start time is about 190 ms here, so the 300 ms target for `hl validate --changed` cannot be met as wall time. Working target for the hook path: work after Node starts under 100 ms. Levers: `module.enableCompileCache()`, keep zod off the validate-a-file path, mount only the plugins a verb needs.

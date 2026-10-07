# Blueprint 27: Read-only console as built (2026-10-07)

Built on `m2/console` by three parallel agents after a wave 0 that froze the API contract (`packages/core/src/contracts/api.ts`) and installed every dependency.

| Part | Where | What it does |
|---|---|---|
| API server | `packages/server` | Hono, read-only `GET /api/v1/*` (workspace, overview, board, tickets, ticket detail with artifact index, artifact content, activity, worklog, runs, skills, search), `{ok,data}` envelope, SSE `/events` (snapshot, then batched changes at most every 250 ms from a file watcher), 127.0.0.1 only with a Host check, serves `packages/ui/dist` with an SPA fallback. Warm responses 2 to 23 ms on the demo repo |
| `hl serve` | `packages/cli/src/serve.ts` | Starts the console for the resolved workspace (`--port`, default 4317) |
| Console UI | `packages/ui` | React 19, Vite, Tailwind 4, shadcn on Radix, TanStack Query, react-router. Resizable shell, Overview, Board with drawer and filters, Ticket page with tabs and the move gate shown with its `hl` fix, artifact viewers by kind (Markdown, TOML table, JSONL timeline, sandboxed HTML), runs list, Ctrl+K palette, F68 keys, light and dark, phone bottom bar. Writes show the `hl` command to copy. Initial JS 151 KB gzip |
| Static ticket pages | `packages/plugins/pages` | `hl page build`; pages under `site/` rewritten after every write verb (F28); one unified/remark pipeline shared with the UI's plugin list |

## F151 spike result

React plus shadcn: the agent build had a clean first typecheck and no library retries; friction was newer library versions (react-resizable-panels 4, react-router 8), Biome accessibility rules, and jsdom stubs. Recommendation: stay on React.

## Verified

- Unit tests 230 pass (server, pages and the rest), UI 19 vitest tests, typecheck (core and UI), Biome, UI build.
- In the browser against `test/fixtures/ws-demo` via `hl serve`: Overview, Board, Ticket page, Spec viewer by direct URL, phone width with the bottom bar.
- Fixed during integration: SPA fallback for routes carrying file names; `todos` change area.

## Not yet

Writes from the console (the writable console milestone), `/todos` endpoint, acceptance criteria in `TicketDetail`, run trigger field (suggested by the UI agent).

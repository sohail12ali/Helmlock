# Blueprint 23: the TypeScript stack and the front-end reviews (decided direction)

Decided on 2026-10-07: **TypeScript everywhere** (F0a). Two constraints were dropped: reuse of the existing Python, and the no-dependencies rule. Editable themes were also dropped; only a light and a dark palette remain. Blueprint 15 holds the earlier measurements and is superseded where it favours Python.

## The stack at a glance

| Part | Choice | Card |
|---|---|---|
| Runtime | Node 24 LTS, pnpm workspace | F0a, F144 |
| Core | `packages/core`: file layer, Zod schemas, plugin kernel | F144, F40, F101 |
| CLI | `packages/cli`, `hl`, bundled with esbuild into one file | F146, F55 |
| Server | `packages/server`: Hono, JSON plus SSE under `/api/v1`, OpenAPI exported from the schemas | F145 |
| UI | `packages/ui`: React 19, TypeScript, Vite, Tailwind 4, shadcn/ui, TanStack Query, react-router | F34, F131 |
| Widgets | panels, kanban, graph, Markdown, palette, chat, each behind our own component | F149 |
| Plugins | TypeScript modules; other languages as separate processes | F42, F150 |
| Dependencies | allowed with rules | F147 |

## Folder shape

```
delivery-repo/
  packages/
    core/        file layer, Zod schemas, verb registry, plugin kernel (the only code touching workspace files)
    cli/         hl: parses arguments, calls core, prints compact output
    server/      Hono: routes call core; no markup
    ui/          src/{api, domain, features/<screen>, ui-kit, theme}; features import ui-kit and domain, never each other
    plugins/     built-in plugins (workflow, tickets, runtime, assistant, channels ...)
  contract/      exported OpenAPI file (generated from the Zod schemas)
```

Dependency rule: the UI knows only the contract; the server never imports UI code; the CLI and server both go through `core`. Replacing the UI means replacing `packages/ui`.

## Everyday cost: why UI choice barely touches tokens

The UI lives in the delivery repo, and agents work in code repos and the knowledge center. In everyday use an agent creates, moves and reads tickets through CLI verbs (about 30 to 60 tokens to write, 15 to 400 to read), so the UI is never opened. Keep it that way with a deny rule on `console/ui` (F38). The UI costs tokens only when someone asks an agent to change the console, which is occasional.

## Navigation and artifacts (F148)

- The server turns each `ticket.toml` into an artifact index: id, title, kind (md, toml, jsonl, html), path, group.
- The UI maps each kind to a viewer: Markdown renderer, TOML table, JSONL timeline, sandboxed iframe for generated HTML.
- Routes: `/t/:ticket/:artifact`, so back, deep links and breadcrumbs work; the command palette reads the same index.
- Generated HTML is served with a sandbox policy and shown in `<iframe sandbox="allow-scripts">` without same-origin access; the app and the page exchange only a height message.
- Layouts stay in code; data decides which panels appear. A screen-definition format tends to grow into a poor framework, so keep it for uniform lists only if the spike shows a need.

## What the two independent reviews found

Both reviewers were given the requirements only, not my opinion. Their figures are estimates (bytes divided by 4 for tokens, plus or minus 15%) unless stated.

| Question | Review 1 (briefed before "agents never read the UI") | Review 2 (briefed with that constraint) |
|---|---|---|
| Overall pick | Preact+htm, no build, screens as data, own token CSS | React 19 + TypeScript + Vite, own tokens plus headless primitives, JSON plus SSE plus OpenAPI |
| Runner-up | Plain ES modules | Svelte 5 as a plain Vite app (not SvelteKit 3) |
| Everyday tokens | An agent never opens UI files for create, move, comment, view or board reads; the real lever is compact CLI output (a board of 20 tickets is about 300 to 600 tokens in a brief form) | Same |
| Card prototype (tokens an agent writes) | Data spec 50; own HTML 72; Bootstrap 82; plain `h()` 96; Preact 103; Tailwind 116; TypeScript 135; Lit 150 | Not repeated |
| Measured toy app | | React 154 KB gzipped, 126 packages, 55 MB; Svelte 53 KB, 39 packages; Preact 31 KB |
| Main caution | Whole-page redraw loses focus and typed text on editable pages | Widget libraries churn (dnd-kit core unreleased since December 2024; its successor is 0.x); supply-chain surface |

Why the final pick differs from review 1: its token argument assumed agents read UI code every day, which you ruled out. Review 2 is the one briefed with the right constraints, and it agrees with the choice made here. I took its contract, navigation and distribution design and replaced its "own tokens" styling with Tailwind and shadcn/ui because editable themes were dropped.

## Risks and how each is handled

| Risk | Handling |
|---|---|
| Dependency churn and supply chain | F147: lockfile, scripts disabled in CI, automated updates, weekly audit, a written reason per dependency |
| Widget library drift | Each wrapped in our own `ui-kit` component (F149) |
| Contract drift | One Zod schema source in core; types inferred, OpenAPI exported (F145) |
| Agent quality with React unproven here | Front-end spike first (F151) |
| TypeScript tooling for TOML and files | smol-toml for reading, a closed writer per record kind in core (F24, F25) |
| Local speech and vision | Separate-process plugins, possibly Python (F150) |
| Single-executable build not verified on Windows | Left optional (F146) |

## Start-up cost to check in the spike

The bundled CLI start time with real dependencies (earlier tests say 60 to 100 ms), the Node single-executable build on Windows, and React versus Svelte 5 for agent-written changes.

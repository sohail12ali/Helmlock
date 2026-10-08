# Dependencies (F147)

One line of reasoning per dependency. Lockfile committed; installs use `--frozen-lockfile` with scripts disabled (`.npmrc`, and `--ignore-scripts` in CI). Dependabot opens weekly grouped minor/patch PRs (`.github/dependabot.yml`); `pnpm audit --prod` runs weekly (`.github/workflows/audit.yml`). Add a row here in the same change that adds a dependency.

## Runtime (core, cli, plugins, server)

| Package | Where | Why |
|---|---|---|
| zod | core, plugins, server | One schema source for types, validation and generated forms (F145). |
| smol-toml | core, plugins | Small, maintained TOML parser; we write TOML with our own closed emitters (F24, F25). |
| commander | cli | Mature command framework; Paperclip's CLI uses it. |
| @clack/prompts | cli, plugins | Small interactive prompts for `hl init` in a terminal (scaffold plugin); Paperclip uses it. |
| hono | server | Small, typed HTTP router with SSE helpers; runs on Node through its adapter. |
| @hono/node-server | server | Hono's Node adapter for `hl serve` (localhost only). |
| unified | plugins | The remark/rehype pipeline runner behind generated ticket pages. |
| remark-parse | plugins | Markdown to syntax tree (CommonMark) for generated pages. |
| remark-gfm | plugins, ui | GitHub tables, task lists and strikethrough in specs and wiki notes. |
| remark-rehype | plugins | Markdown tree to HTML tree. |
| rehype-sanitize | plugins, ui | Strips scripts and unsafe attributes from rendered Markdown (agent-written text is untrusted). |
| rehype-stringify | plugins | HTML tree to the generated page text. |

## Console (packages/ui)

| Package | Where | Why |
|---|---|---|
| react, react-dom | ui | React 19, the decided UI stack (F0a). |
| react-router | ui | Routes for the console pages with deep links. |
| @tanstack/react-query | ui | Server-state cache and refetching, so pages need no hand-written loading state. |
| radix-ui | ui | Accessible primitives under shadcn/ui components (dialogs, menus, tabs). |
| class-variance-authority | ui | Component variants, the shadcn/ui convention. |
| clsx | ui | Conditional class names. |
| tailwind-merge | ui | Merges conflicting Tailwind classes in shadcn/ui components. |
| lucide-react | ui | Icon set used by shadcn/ui. |
| cmdk | ui | Command palette. |
| react-markdown | ui | Renders spec, plan and wiki Markdown in the console without dangerouslySetInnerHTML. |
| react-resizable-panels | ui | The resizable, collapsible shell (drag to resize). |
| @atlaskit/pragmatic-drag-and-drop | ui | Small, framework-free drag and drop for the ticket board. |
| @atlaskit/pragmatic-drag-and-drop-hitbox | ui | Drop-edge detection for board columns and cards. |

## Development only

| Package | Where | Why |
|---|---|---|
| typescript | root, ui | `tsc --noEmit` type check only; code runs through Node type stripping (F146). |
| @types/node | root | Node API types. |
| @biomejs/biome | root | One tool for lint and format. |
| vite | ui | Dev server and production build of the console. |
| @vitejs/plugin-react | ui | React fast refresh and JSX for Vite. |
| tailwindcss, @tailwindcss/vite | ui | Tailwind 4 and its Vite plugin (F0a). |
| vitest | ui | UI unit tests with the Vite config. |
| jsdom | ui | DOM for UI tests. |
| @testing-library/react | ui | Render and query components the way a person uses them. |
| @testing-library/jest-dom | ui | Readable DOM assertions in UI tests. |
| @types/react, @types/react-dom | ui | React types. |

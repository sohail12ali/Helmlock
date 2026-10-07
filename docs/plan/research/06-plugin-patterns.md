# Plugin patterns in the four repos (iteration 5)

| Repo | How it does plugins | Take | Skip |
|---|---|---|---|
| control-center (yours) | Each feature is a module `console/server/features/*_feature.py` with a row in `console/config/plugins.toml`; `enabled = false` removes both the routes and the tab. Agent backends are added by config only. One verb registry (`verbs.toml`) feeds CLI, jobs, MCP and API-agent tools | Enable and disable by config; a feature owns its routes and tab; one verb table for every front door | It is a list of features inside one repo, not independently packaged |
| lc-wms-cursor-config (yours) | The workflow is data: `board-ticket.toml` lanes, `recipes.toml`, `verbs.toml`, `people.toml` under `.kanban/config/` | Statuses and verbs as config files | Spread over many files with no manifest or version check |
| paperclip (public) | `ServerAdapterModule` with `type`, `execute(ctx)`, `testEnvironment`, optional `listModels` and `getConfigSchema` (a declarative settings form). A mutable registry with register and unregister. External adapters are npm packages exporting `createServerAdapter()`, loaded by a plugin loader | A small adapter contract; a declarative settings schema; a registry you can change at runtime | npm packaging, a plugin runtime, a plugin SDK |
| deepseek-harness (public) | Everything is a plugin on the Cordis dependency-injection framework; profiles and bundles layer YAML patches; hooks bridge Claude Code and Codex configs | Config layering order; "refuse a file newer than the reader" | The framework itself, hot reload, 60 package groups |

**Conclusion:** copy control-center's enable-by-config and verb registry, lc-wms's statuses-as-data, and paperclip's small contract plus settings schema. Avoid deepseek-harness's framework. That gives a tiny kernel with manifests, which is what Blueprint 8 describes.

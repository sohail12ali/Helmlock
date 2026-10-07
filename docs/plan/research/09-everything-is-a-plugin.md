# deepseek-harness: "everything is a plugin" (iteration 13)

Findings from reading its architecture docs, notes and code. Their kernel is small; the weight is elsewhere.

## The core idea

- A **plugin** is a module with `name`, `inject` (service keys it needs), `Config` (a schema) and `apply(ctx, config)`. A second form (a service class) exists, and mixing the two silently dropped `inject` once (postmortem 0001), so the rule is one form per module.
- The **kernel** (Cordis) is about 2.7k lines: a context tree, services (`ctx.provide` and `ctx.inject`), events with five dispatch modes, fibers with reversible effects, and scopes. The loader is about 1k lines. The loader mounts a YAML tree of rows (`id`, `name`, `config`, `disabled`).
- **Not plugins:** the kernel and loader, the launcher and app boot, bundles (data only), the required-entry startup audit, and the vocabulary of events the agent loop emits (semi-privileged).

## What they do that we want

| Idea | How it works there | Our card |
|---|---|---|
| One plugin form | name, requires, Config, apply; every registration is an effect that unwinds on dispose | F101 |
| Services with requires | A plugin waits (pending) until its services exist; dependents restart when a provider changes | F101 |
| One provider per service name | A second registration fails the load; replacing = disable one row, enable another | F45 |
| Hook pipelines named domain/stage | `tools/pre-execute`, `tools/post-execute`, `agent/pre-step`, `approval/request`; waterfall with `next()` | F102 |
| Guard that can only deny | Runs after the waterfall and has no allow result, so order cannot undo a denial | F102, F14 |
| Config is composition | Bundles (data-only), the profile patch, a home patch, launch overlays; rows patched by id; `--dump-config` shows the layer of every row | F103 |
| Dormant plugins | The provider adapter mounts with zero routes until settings add them | F107 |
| Scoped contexts | Per-agent and per-session child contexts with their own tools | F106 |
| Plugin Manager | Toggle `disabled`, edit bundles, install packages | Later |
| Generated references | Config catalog, event matrix, tool catalog, freshness-gated | F108 |

## What it costs them

| Pain | Evidence |
|---|---|
| Ceremony | 209 empty "invariant companion" files deleted; 328 package.json files for three-role splits, per-backend packages and per-package gates |
| Load-order bugs | Tool order followed concurrent registration and differed in CI; equal prompt sections varied by platform |
| Silent failures | A plugin pending forever with no error; a second export dropping `inject`; a config expression that never ran and left tools off; patch ids that matched nothing; whole-config replacement pinning values against later bundle changes |
| Kernel upkeep | The vendored kernel carries 23 local changes; a transactional loader was tried and reverted; dropping module hot reload (about 400 lines plus 372 of tests) is proposed |
| Startup | A dormant adapter once imported hundreds of modules on every start |
| Types | A build-time generator for the host and client split; runtime event schemas were rejected |

They never rejected the plugin approach itself. They rejected middleware chains, `link:` entries, a second settings store and inheriting profiles.

## Our verdict (what changed in the plan)

**Copy (eight ideas):**
1. A kernel of four primitives in about 500 lines of Python: context tree with a service registry, `requires` with dependent restart, scoped effects with dispose, events.
2. One plugin form, validated at load.
3. Config as composition: ordered layers, rows with stable ids, `disabled`, patch by id, `hl config show` naming the layer. Improve on them: an unmatched id is an error and merge rules are explicit.
4. Hook pipelines named `domain/stage` with a declared mode, plus a separate deny-only guard registry; generate the event matrix.
5. Explicit priorities from day one; never rely on activation order.
6. A service definition and one provider per name, enforced loudly; split into more only at a second provider.
7. Loud startup: list pending plugins and the missing service; a required-versus-optional audit.
8. Scoped child contexts per agent or run; "model-visible means logged".

**Leave:** a package per plugin, bundles as packages, Node resolver hooks, module hot reload, code generation for types, 328-package granularity, bilingual README and coverage gates, transactional loader rollback, a plugin-manager UI in v1, `!!js` expressions in config, forking the kernel.

## What this does to the earlier recommendation

Before: fixed core parts (loader, config merge, event bus, verb registry, file layer, approval gate) plus slots. After: a plugin container kernel, with the verb registry, file layer, approval gate and workflow as built-in plugins providing services (some marked required). The difference is small in code and large in what you can replace. The risk to manage is the silent-failure list above, which F105 addresses.

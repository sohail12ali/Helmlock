// Boot for one hl call (or one server): resolve the workspace, compose config, provide the core services,
// register core verbs, then mount plugins lazily per verb from plugin.toml (`verbs`, `provides`, `requires`).
// Plugin load order follows control-center console/server/plugins/registry.py: providers before dependents,
// a cycle is reported, never looped on.
import { type AskFn, createApprovals } from "../approvals/approvals.ts";
import { type ComposedRow, type ConfigFlags, composeRows, type LoadedConfig, loadConfig } from "../config/config.ts";
import type { PluginCatalog } from "../contracts/catalog.ts";
import type { Context, Kernel, MountResult } from "../contracts/kernel.ts";
import type { PluginManifest } from "../contracts/schemas.ts";
import type { Services, WorkspaceInfo } from "../contracts/services.ts";
import type { Actor, VerbResult } from "../contracts/verbs.ts";
import { createFileLayer } from "../files/file-layer.ts";
import { resolveWorkspace } from "../files/resolve.ts";
import { createKernel, type FullKernel } from "../kernel/kernel.ts";
import { registerCoreVerbs } from "../verbs/core-verbs.ts";
import { createVerbRegistry, type VerbRegistry } from "../verbs/registry.ts";
import { readManifests } from "./manifests.ts";

export { readManifest, readManifests } from "./manifests.ts";

export interface RuntimeOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Launch flags: {"plugin.<id>.<key>": value, disable: id | id[]} (F103). */
  flags?: ConfigFlags;
  catalog: PluginCatalog;
  actor?: Partial<Actor>;
  /** True when a person can answer prompts (stdin and stdout are a TTY). Default false. */
  interactive?: boolean;
  /** Prompt used by the approval gate in a TTY. */
  ask?: AskFn;
  /** Diagnostics (default stderr). */
  log?: (line: string) => void;
}

export interface RunVerbOptions {
  dryRun?: boolean;
  json?: boolean;
  interactive?: boolean;
  actor?: Partial<Actor>;
}

export interface Runtime {
  kernel: Kernel;
  ctx: Context;
  info: WorkspaceInfo;
  manifests: Map<string, PluginManifest>;
  /** Set when workspace.toml or workspace.local.toml is broken; plugins then stay unmounted (fail-closed). */
  configError: Error | undefined;
  /** The plugin row id whose manifest lists this verb, if any. */
  ownerOf(verbId: string): string | undefined;
  mountForVerb(verbId: string): Promise<MountResult[]>;
  mountAll(): Promise<MountResult[]>;
  run(verbId: string, input: Record<string, unknown>, opts?: RunVerbOptions): Promise<VerbResult>;
  dispose(): Promise<void>;
}

/** Plugins mounted for every write so the activity line and the author are available. */
const ALWAYS_FOR_WRITES = ["roster", "activity"];

export async function createRuntime(o: RuntimeOptions): Promise<Runtime> {
  const env = o.env ?? process.env;
  const log = o.log ?? ((line: string) => process.stderr.write(`hl: ${line}\n`));
  const info = resolveWorkspace(o.cwd, env);
  const kernel: FullKernel = createKernel({ log });
  const ctx = kernel.root;
  const files = createFileLayer(info.root);

  let configError: Error | undefined;
  let config: LoadedConfig;
  try {
    config = await loadConfig(files, o.flags);
  } catch (e) {
    configError = e as Error;
    const { workspace } = composeRows({ workspace: undefined });
    config = { workspace, fromFile: false, rows: () => [], pluginConfig: () => ({}) };
  }

  const verbs: VerbRegistry = createVerbRegistry(ctx);
  ctx.provide("workspace", info);
  ctx.provide("files", files);
  ctx.provide("config", config);
  ctx.provide("verbs", verbs);
  ctx.provide("approvals", createApprovals({ ctx, interactive: o.interactive ?? false, ask: o.ask }));

  const manifests = readManifests(o.catalog, log);
  const rows = new Map<string, ComposedRow>(
    config
      .rows()
      .filter((r) => !r.disabled)
      .map((r) => [r.id, r]),
  );
  const manifestOf = (rowId: string) => {
    const r = rows.get(rowId);
    return r ? manifests.get(r.use) : undefined;
  };
  const ownerOf = (verbId: string) => [...rows.keys()].find((id) => manifestOf(id)?.verbs.includes(verbId));
  const settled = new Map<string, MountResult>();
  const cycles: string[] = [];

  const mountRow = async (rowId: string, trail: string[], out: MountResult[]): Promise<void> => {
    if (settled.has(rowId)) return;
    if (trail.includes(rowId)) {
      // Manifest requires only order the mounts; the kernel's pending state decides what really runs.
      const cycle = [...trail.slice(trail.indexOf(rowId)), rowId].join(" -> ");
      if (!cycles.includes(cycle)) cycles.push(cycle);
      return;
    }
    const row = rows.get(rowId);
    const m = manifestOf(rowId);
    const entry = row ? o.catalog[row.use] : undefined;
    if (!row || !m || !entry) {
      const r: MountResult = { id: rowId, state: "failed", error: row ? `plugin "${row.use}" is not in the catalog` : "not enabled" };
      settled.set(rowId, r);
      out.push(r);
      return;
    }
    for (const key of m.requires) {
      if (ctx.has(key as keyof Services)) continue;
      for (const [pid] of rows) if (pid !== rowId && manifestOf(pid)?.provides.includes(key)) await mountRow(pid, [...trail, rowId], out);
    }
    if (settled.has(rowId)) return;
    let res: MountResult;
    try {
      const mod = (await entry.load()).default;
      res = await kernel.mount(rowId, mod, row.config ?? {});
    } catch (e) {
      res = { id: rowId, state: "failed", error: `cannot load: ${(e as Error).message}` };
      log(`plugin ${rowId} failed: ${res.error}`);
    }
    settled.set(rowId, res);
    out.push(res);
  };

  /** Latest state of a mounted row (pending ones may have become active since). */
  const stateOf = (rowId: string): MountResult | undefined => kernel.states().find((s) => s.id === rowId) ?? settled.get(rowId);

  const mountForVerb = async (verbId: string): Promise<MountResult[]> => {
    const out: MountResult[] = [];
    if (!verbs.get(verbId)) {
      const owner = ownerOf(verbId);
      if (owner) await mountRow(owner, [], out);
    }
    if (verbs.get(verbId)?.writes) for (const id of ALWAYS_FOR_WRITES) if (rows.has(id)) await mountRow(id, [], out);
    return out.map((r) => stateOf(r.id) ?? r);
  };

  const mountAll = async (): Promise<MountResult[]> => {
    const out: MountResult[] = [];
    for (const id of rows.keys()) await mountRow(id, [], out);
    await kernel.settled();
    return [...rows.keys()].map((id) => stateOf(id) ?? { id, state: "failed" as const, error: "not mounted" });
  };

  registerCoreVerbs(ctx, {
    env,
    configError: () => configError,
    workspaceRaw: async () => ((await files.exists("workspace.toml")) ? (await files.readTomlRaw("workspace.toml")).data : undefined),
    mountAll,
    pending: () => kernel.pending().map((p) => ({ id: p.id, waitingFor: p.waitingFor.map(String) })),
    cycles: () => [...cycles],
  });

  const loudPending = (): string => {
    const p = kernel.pending();
    return p.length ? `pending plugins: ${p.map((x) => `${x.id} (waiting for ${x.waitingFor.join(", ")})`).join("; ")}` : "";
  };

  return {
    kernel,
    ctx,
    info,
    manifests,
    configError,
    ownerOf,
    mountForVerb,
    mountAll,
    async run(verbId, input, opts = {}) {
      if (configError && !verbs.get(verbId)) {
        const e = configError as Error & { rule?: string; file?: string; fix?: string };
        return {
          ok: false,
          code: 1,
          error: { rule: e.rule ?? "config", message: e.message, ...(e.file ? { file: e.file } : {}), ...(e.fix ? { fix: e.fix } : {}) },
        };
      }
      await mountForVerb(verbId);
      if (!verbs.get(verbId)) {
        const owner = ownerOf(verbId);
        const st = owner ? stateOf(owner) : undefined;
        if (st?.state === "pending") {
          const line = loudPending();
          log(line);
          return {
            ok: false,
            code: 1,
            error: { rule: "plugin-pending", message: `${verbId}: plugin ${owner} is waiting for ${st.waitingFor?.join(", ")}. ${line}` },
          };
        }
        if (st?.state === "failed")
          return { ok: false, code: 1, error: { rule: "plugin-failed", message: `${verbId}: plugin ${owner} failed: ${st.error}`, fix: "run `hl doctor`" } };
        if (owner)
          return { ok: false, code: 1, error: { rule: "verb-missing", message: `plugin ${owner} lists ${verbId} in plugin.toml but did not register it` } };
      }
      const slug = info.author ?? "unknown";
      const actor: Actor = { kind: "person", id: slug, onBehalfOf: slug, ...o.actor, ...opts.actor };
      return verbs.run(verbId, input, {
        actor,
        dryRun: opts.dryRun ?? false,
        json: opts.json ?? false,
        interactive: opts.interactive ?? o.interactive ?? false,
        cwd: o.cwd,
      });
    },
    dispose: () => kernel.dispose(),
  };
}

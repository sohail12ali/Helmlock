// WALKING SKELETON (wave 0). S1 owns: boot, lazy mount per verb, activity line per write, loud startup.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { createApprovals } from "../approvals/approvals.ts";
import { loadConfig } from "../config/config.ts";
import type { PluginCatalog } from "../contracts/catalog.ts";
import type { Context, Kernel, MountResult } from "../contracts/kernel.ts";
import { PluginManifest } from "../contracts/schemas.ts";
import type { WorkspaceInfo } from "../contracts/services.ts";
import type { Actor, VerbResult } from "../contracts/verbs.ts";
import { createFileLayer } from "../files/file-layer.ts";
import { resolveWorkspace } from "../files/resolve.ts";
import { createKernel } from "../kernel/kernel.ts";
import { registerCoreVerbs } from "../verbs/core-verbs.ts";
import { createVerbRegistry } from "../verbs/registry.ts";

export interface RuntimeOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  flags?: Record<string, unknown>;
  catalog: PluginCatalog;
  actor?: Partial<Actor>;
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
  mountForVerb(verbId: string): Promise<MountResult[]>;
  mountAll(): Promise<MountResult[]>;
  run(verbId: string, input: Record<string, unknown>, opts?: RunVerbOptions): Promise<VerbResult>;
  dispose(): Promise<void>;
}

/** Plugins mounted for every write so the activity line and the author are available. */
const ALWAYS = ["roster", "activity"];

export async function createRuntime(o: RuntimeOptions): Promise<Runtime> {
  const env = o.env ?? process.env;
  const info = resolveWorkspace(o.cwd, env);
  const kernel = createKernel();
  const ctx = kernel.root;
  const files = createFileLayer(info.root);
  const config = await loadConfig(files, o.flags);
  const verbs = createVerbRegistry(ctx);
  ctx.provide("workspace", info);
  ctx.provide("files", files);
  ctx.provide("config", config);
  ctx.provide("verbs", verbs);
  ctx.provide("approvals", createApprovals());
  registerCoreVerbs(ctx);

  const manifests = new Map<string, PluginManifest>();
  for (const [id, entry] of Object.entries(o.catalog)) {
    try {
      manifests.set(id, PluginManifest.parse(parse(readFileSync(join(entry.dir, "plugin.toml"), "utf8"))));
    } catch (e) {
      process.stderr.write(`plugin ${id}: bad plugin.toml: ${(e as Error).message}\n`);
    }
  }
  const enabled = new Map(
    config
      .rows()
      .filter((r) => !r.disabled)
      .map((r) => [r.use, r]),
  );
  const active = new Set<string>();

  const mountOne = async (id: string, seen: Set<string>): Promise<MountResult[]> => {
    if (active.has(id) || seen.has(id)) return [];
    seen.add(id);
    const m = manifests.get(id);
    const entry = o.catalog[id];
    if (!m || !entry) return [{ id, state: "failed", error: "not in catalog" }];
    const out: MountResult[] = [];
    for (const key of m.requires) {
      if (ctx.has(key as never)) continue;
      const provider = [...manifests.entries()].find(([pid, pm]) => pm.provides.includes(key) && enabled.has(pid));
      if (provider) out.push(...(await mountOne(provider[0], seen)));
    }
    const mod = (await entry.load()).default;
    const res = await kernel.mount(id, mod, enabled.get(id)?.config ?? {});
    if (res.state === "active") active.add(id);
    out.push(res);
    return out;
  };

  const mountForVerb = async (verbId: string) => {
    if (verbs.get(verbId)) return [];
    const out: MountResult[] = [];
    const seen = new Set<string>();
    for (const id of ALWAYS) if (enabled.has(id)) out.push(...(await mountOne(id, seen)));
    for (const [id, m] of manifests) if (m.verbs.includes(verbId) && enabled.has(id)) out.push(...(await mountOne(id, seen)));
    return out;
  };

  const mountAll = async () => {
    const out: MountResult[] = [];
    const seen = new Set<string>();
    for (const id of manifests.keys()) if (enabled.has(id)) out.push(...(await mountOne(id, seen)));
    return out;
  };

  return {
    kernel,
    ctx,
    info,
    manifests,
    mountForVerb,
    mountAll,
    async run(verbId, input, opts = {}) {
      await mountForVerb(verbId);
      const slug = info.author ?? "unknown";
      const actor: Actor = { kind: "person", id: slug, onBehalfOf: slug, ...o.actor, ...opts.actor };
      return verbs.run(verbId, input, {
        actor,
        dryRun: opts.dryRun ?? false,
        json: opts.json ?? false,
        interactive: opts.interactive ?? false,
        cwd: o.cwd,
      });
    },
    dispose: () => kernel.dispose(),
  };
}

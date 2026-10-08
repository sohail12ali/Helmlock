// Crew plugin (Blueprint 33, F152-F157): provides the "crew" service and the `crew show` and `crew set` verbs.
// Roles come from the agent pack; the [[plugin]] id = "crew" row of workspace.toml sets each role's engine, model,
// worktree flag and permission mode, and the stage -> role map. `crew set` writes that row through the file layer.
import type { FileLayer, PluginModule, VerbCtx, VerbDef } from "@helmlock/core";
import { composeRows, fail, ok } from "@helmlock/core";
import { z } from "zod";
import { RUNTIME_ALIASES } from "../runtimes/registry.ts";
import { CREW_CONFIG_KIND, type CrewRoleFull, crewConfigEmitter, LOCAL_FILE, WORKSPACE_FILE } from "./config.ts";
import { type Crew, createCrew } from "./crew.ts";

export * from "./config.ts";
export * from "./crew.ts";
export * from "./project-dir.ts";

/** Engines known by name when the CLI has not mounted the adapter plugins (they mount with `run`). */
export const KNOWN_ENGINES: readonly string[] = [...new Set([...Object.values(RUNTIME_ALIASES), "loop"])];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();

const crewOf = (v: VerbCtx) => v.ctx.get("crew") as Crew;

const showText = (roles: CrewRoleFull[], stageRoles: Record<string, string>) => {
  const w = Math.max(4, ...roles.map((r) => r.id.length));
  const lines = roles.map((r) => `${r.id.padEnd(w)}  ${r.engine}${r.model ? ` (${r.model})` : ""}${r.worktree ? "  worktree" : ""}  mode ${r.mode}`);
  const map = Object.entries(stageRoles)
    .map(([s, r]) => `${s} -> ${r}`)
    .join(", ");
  return [...lines, "", `stages: ${map}`].join("\n");
};

const crewShow: VerbDef = {
  id: "crew show",
  summary: "List the crew roles with the engine, model, worktree flag and permission mode each runs on, and the stage map.",
  examples: ["hl crew show", "hl crew show --json"],
  input: z.object({}),
  writes: false,
  async run(v) {
    const crew = crewOf(v);
    const roles = await crew.rolesFull();
    const stageRoles = await crew.stageRoles();
    return ok({ roles, stage_roles: stageRoles }, showText(roles, stageRoles));
  },
};

/** Set fields of one role in the crew row of a parsed workspace.toml; every other key and row is kept. */
export function setRoleInDoc(doc: Record<string, unknown>, role: string, patch: Record<string, unknown>): Record<string, unknown> {
  const plugin = Array.isArray(doc.plugin) ? [...(doc.plugin as unknown[])] : [];
  let at = -1;
  plugin.forEach((r, n) => {
    if (isObj(r) && r.id === "crew") at = n;
  });
  const row: Record<string, unknown> = at >= 0 ? { ...(plugin[at] as Record<string, unknown>) } : { id: "crew" };
  const config = isObj(row.config) ? { ...row.config } : {};
  const roles = Array.isArray(config.roles) ? (config.roles as unknown[]).map((r) => (isObj(r) ? { ...r } : r)) : [];
  const i = roles.findIndex((r) => isObj(r) && r.id === role);
  const cur = i >= 0 ? (roles[i] as Record<string, unknown>) : { id: role };
  const next: Record<string, unknown> = { ...cur, ...patch };
  for (const [k, val] of Object.entries(next)) if (val === undefined || val === "") delete next[k];
  if (i >= 0) roles[i] = next;
  else roles.push(next);
  row.config = { ...config, roles };
  if (at >= 0) plugin[at] = row;
  else plugin.push(row);
  return { ...doc, plugin };
}

const SetInput = z.object({
  role: z.string().min(1),
  engine: z.string().min(1).optional(),
  model: z.string().optional(),
  worktree: flag,
  mode: z.enum(["plan", "ask", "auto-review"]).optional(),
});

async function readWs(files: FileLayer): Promise<{ data: Record<string, unknown>; hash: string } | undefined> {
  if (!(await files.exists(WORKSPACE_FILE))) return undefined;
  return files.readToml<Record<string, unknown>>(WORKSPACE_FILE, CREW_CONFIG_KIND);
}

const crewSet: VerbDef<typeof SetInput> = {
  id: "crew set",
  summary: "Set the engine, model, worktree flag or permission mode a crew role runs on (shared in workspace.toml).",
  examples: [
    "hl crew set builder --engine claude-code",
    "hl crew set analyst --engine loop --model openrouter/deepseek-chat",
    "hl crew set verifier --engine cursor --dry-run",
    'hl crew set builder --model ""',
  ],
  args: ["role"],
  input: SetInput,
  writes: true,
  async run(v, i) {
    if (i.engine === undefined && i.model === undefined && i.worktree === undefined && i.mode === undefined)
      return fail("bad-request", "nothing to set", { fix: "give --engine, --model, --worktree or --mode" });
    const crew = crewOf(v);
    const roles = await crew.rolesFull();
    const role = roles.find((r) => r.id === i.role);
    if (!role) return fail("unknown-role", `no role ${JSON.stringify(i.role)} in the crew`, { fix: `known roles: ${roles.map((r) => r.id).join(", ")}` });

    const engine = i.engine ? (RUNTIME_ALIASES[i.engine] ?? i.engine) : role.engine;
    if (i.engine) {
      const registered = v.ctx.has("runtimes")
        ? v.ctx
            .get("runtimes")
            .list()
            .map((a) => a.id)
        : [];
      const known = registered.length ? registered : KNOWN_ENGINES;
      if (!known.includes(engine))
        return fail("unknown-engine", `no engine ${JSON.stringify(i.engine)} is registered`, { fix: `known engines: ${known.join(", ")}` });
    }
    // A model is only checked for the model engine: the CLIs name their own models.
    const model = i.model !== undefined ? i.model : i.engine && engine !== role.engine ? "" : role.model;
    if (engine === "loop" && model) {
      const models = v.ctx.has("providers") ? v.ctx.get("providers").models() : [];
      if (!models.some((m) => m.id === model))
        return fail("unknown-model", `no model ${JSON.stringify(model)} is configured`, {
          fix: models.length ? `configured models: ${models.map((m) => m.id).join(", ")}` : "add one with hl provider add or hl model add",
        });
    }

    const files = v.ctx.get("files");
    const ws = await readWs(files);
    if (!ws) return fail("config", `no ${WORKSPACE_FILE} here`, { fix: "run hl inside a knowledge repo", file: WORKSPACE_FILE });
    const patch: Record<string, unknown> = {};
    if (i.engine) patch.engine = engine;
    if (i.model !== undefined || (i.engine && engine !== role.engine)) patch.model = model ?? "";
    if (i.worktree !== undefined) patch.worktree = i.worktree;
    if (i.mode) patch.mode = i.mode;
    let next = setRoleInDoc(ws.data, role.id, patch);
    const local = (await files.exists(LOCAL_FILE)) ? (await files.readTomlRaw(LOCAL_FILE)).data : undefined;
    try {
      composeRows({ workspace: next, local });
    } catch {
      // No crew row in a bundle here: the row has to add the plugin, not patch it.
      next = { ...next, plugin: (next.plugin as Record<string, unknown>[]).map((r) => (r.id === "crew" && !r.use ? { id: r.id, use: "crew", ...r } : r)) };
    }
    const res = await files.writeToml(WORKSPACE_FILE, CREW_CONFIG_KIND, next, { dryRun: v.dryRun, expectHash: ws.hash });
    if (!v.dryRun) crew.resetEngineCache();
    const after = { ...role, engine, ...(model ? { model } : {}) } as CrewRoleFull;
    if (!model) delete after.model;
    if (i.worktree !== undefined) after.worktree = i.worktree;
    if (i.mode) after.mode = i.mode;
    const shown = `${role.id}: ${after.engine}${after.model ? ` (${after.model})` : ""}${after.worktree ? ", worktree" : ""}, mode ${after.mode}`;
    const verb = v.dryRun ? "would set" : res.changed ? "set" : "unchanged:";
    return ok({ role: after, file: WORKSPACE_FILE, changed: res.changed }, `${verb} ${shown} in ${WORKSPACE_FILE}`);
  },
};

const Config = z.object({}).loose();

const plugin: PluginModule<typeof Config> = {
  name: "crew",
  requires: ["files", "verbs", "workspace"],
  Config,
  async apply(ctx, config) {
    const files = ctx.get("files");
    await ctx.effect(() => files.registerEmitter(crewConfigEmitter));
    const runtimes = ctx.has("config") ? ctx.get("config").pluginConfig("runtimes") : {};
    ctx.provide("crew", createCrew({ ctx, mounted: { crew: config as Record<string, unknown>, runtimes } }));
    await ctx.effect(() => ctx.get("verbs").register(crewShow));
    await ctx.effect(() => ctx.get("verbs").register(crewSet as unknown as VerbDef));
  },
};

export default plugin;

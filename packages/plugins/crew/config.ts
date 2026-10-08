// Crew config (F157): roles come from the agent pack (.claude/agents/*.md of the knowledge repo over the delivery
// repo's), each with an engine, an optional model, a worktree flag and a permission mode; stage_roles maps a workflow
// stage to the role that takes it. The [[plugin]] id = "crew" row of workspace.toml overrides both. All role and
// stage names live here, in the plugin's defaults: the core never names one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CrewRole, FileLayer, RunMode, TomlEmitter } from "@helmlock/core";
import { composeRows } from "@helmlock/core";
import { z } from "zod";
import { parseFrontmatter } from "../skills/index.ts";

/** The engine when neither the crew row nor the runtimes plugin names one (runtimes plugin.toml default). */
export const FALLBACK_ENGINE = "claude-code";
/** Live runs at once when the runtimes plugin sets no max_live (Blueprint 33: default 2). */
export const DEFAULT_MAX_LIVE = 2;

/** Build roles: a git worktree per ticket and edits accepted without a card (F156). */
export const DEFAULT_WORKTREE_ROLES: readonly string[] = ["builder", "fixer"];

/** The lite workflow's stage -> role map; done has no role. */
export const DEFAULT_STAGE_ROLES: Readonly<Record<string, string>> = {
  backlog: "analyst",
  spec: "analyst",
  plan: "planner",
  build: "builder",
  verify: "verifier",
};

/** What the role does at a stage, for the Next step reason ("Stage build: Builder builds"). */
export const STAGE_ACTIONS: Readonly<Record<string, string>> = {
  backlog: "triages and sizes it",
  spec: "writes the spec",
  plan: "plans the slices",
  build: "builds",
  verify: "verifies",
};

export const RoleConfig = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, "a role id like builder"),
    label: z.string().optional(),
    description: z.string().optional(),
    engine: z.string().min(1).optional(),
    model: z.string().optional(),
    worktree: z.boolean().optional(),
    mode: z.enum(["plan", "ask", "auto-review"]).optional(),
  })
  .loose();
export type RoleConfig = z.infer<typeof RoleConfig>;

export const CrewConfig = z
  .object({
    roles: z.array(RoleConfig).optional(),
    stage_roles: z.record(z.string(), z.string()).optional(),
  })
  .loose();
export type CrewConfig = z.infer<typeof CrewConfig>;

/** A role with its permission mode (not in the contract's CrewRole; the run gets it). */
export interface CrewRoleFull extends CrewRole {
  mode: RunMode;
}

/** "builder" -> "Builder". */
export const roleLabel = (id: string) => {
  const s = id.replace(/[-_]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Agent files of one .claude/agents folder: id (file name or frontmatter name) and description. */
function agentsIn(dir: string): { id: string; description?: string }[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }
  const out: { id: string; description?: string }[] = [];
  for (const n of names.sort()) {
    let fm: Record<string, string> = {};
    try {
      fm = parseFrontmatter(readFileSync(join(dir, n), "utf8"));
    } catch {
      /* an unreadable file still names a role */
    }
    const id = (fm.name || n.slice(0, -3)).trim();
    if (!/^[a-z][a-z0-9-]*$/.test(id)) continue;
    out.push(fm.description ? { id, description: fm.description } : { id });
  }
  return out;
}

/** The agent pack: the delivery repo's agents, overridden and extended by the knowledge repo's. */
export function agentPack(knowledgeRoot: string, deliveryRoot: string): { id: string; description?: string }[] {
  const byId = new Map<string, { id: string; description?: string }>();
  for (const a of agentsIn(join(deliveryRoot, ".claude", "agents"))) byId.set(a.id, a);
  for (const a of agentsIn(join(knowledgeRoot, ".claude", "agents"))) byId.set(a.id, a);
  return [...byId.values()];
}

/** Roles: the agent pack with defaults, then the crew row's roles (by id) on top; unknown ids add a role. */
export function composeRoles(pack: { id: string; description?: string }[], cfg: CrewConfig, defaultEngine: string): CrewRoleFull[] {
  const out = new Map<string, CrewRoleFull>();
  const base = (id: string, description?: string): CrewRoleFull => {
    const worktree = DEFAULT_WORKTREE_ROLES.includes(id);
    return {
      id,
      label: roleLabel(id),
      ...(description ? { description } : {}),
      engine: defaultEngine,
      worktree,
      mode: worktree ? "auto-review" : "ask",
    };
  };
  for (const a of pack) out.set(a.id, base(a.id, a.description));
  for (const r of cfg.roles ?? []) {
    const cur = out.get(r.id) ?? base(r.id);
    const next: CrewRoleFull = { ...cur };
    if (r.label) next.label = r.label;
    if (r.description) next.description = r.description;
    if (r.engine) next.engine = r.engine;
    if (r.model) next.model = r.model;
    else if (r.model === "") delete next.model;
    if (r.worktree !== undefined) next.worktree = r.worktree;
    if (r.mode) next.mode = r.mode;
    else if (r.worktree !== undefined) next.mode = r.worktree ? "auto-review" : "ask";
    out.set(r.id, next);
  }
  return [...out.values()];
}

export const stageRoles = (cfg: CrewConfig): Record<string, string> => ({ ...DEFAULT_STAGE_ROLES, ...(cfg.stage_roles ?? {}) });

export const WORKSPACE_FILE = "workspace.toml";
export const LOCAL_FILE = "workspace.local.toml";
/** Own emitter kind for workspace.toml (the settings plugin registers its own; kinds must be unique). */
export const CREW_CONFIG_KIND = "crew-workspace-config";
export const crewConfigEmitter: TomlEmitter<Record<string, unknown>> = {
  kind: CREW_CONFIG_KIND,
  schema: z.object({}).loose(),
  version: 1,
  order: {
    "": ["schema_version", "bundles", "workspace", "plugin", "layers", "retention"],
    workspace: ["name", "console_name", "plugin_dirs"],
    plugin: ["id", "use", "disabled", "config"],
    "plugin.config.roles": ["id", "label", "engine", "model", "worktree", "mode"],
  },
};

async function rawDoc(files: FileLayer, rel: string): Promise<Record<string, unknown> | undefined> {
  try {
    if (!(await files.exists(rel))) return undefined;
    return (await files.readTomlRaw(rel)).data;
  } catch {
    return undefined;
  }
}

/**
 * The composed config of the crew and runtimes rows as it is now on disk (re-read per call, so `crew set` shows at
 * once). Falls back to the config the plugin was mounted with when the files do not compose.
 */
export async function liveConfig(
  files: FileLayer,
  mounted: { crew: Record<string, unknown>; runtimes: Record<string, unknown> },
): Promise<{ crew: CrewConfig; runtimes: Record<string, unknown> }> {
  let crewRaw = mounted.crew;
  let runtimes = mounted.runtimes;
  const ws = await rawDoc(files, WORKSPACE_FILE);
  if (ws) {
    try {
      const { rows } = composeRows({ workspace: ws, local: await rawDoc(files, LOCAL_FILE) });
      const crewRow = rows.find((r) => r.id === "crew") ?? rows.find((r) => r.use === "crew");
      const rtRow = rows.find((r) => r.id === "runtimes") ?? rows.find((r) => r.use === "runtimes");
      crewRaw = crewRow?.config ?? {};
      runtimes = rtRow?.config ?? {};
    } catch {
      /* keep the mounted config */
    }
  }
  const parsed = CrewConfig.safeParse(crewRaw);
  return { crew: parsed.success ? parsed.data : {}, runtimes };
}

// Settings page diagnostics: GET /api/v1/server/plugins (what this `hl serve` has mounted), GET /api/v1/settings/env
// (the knowledge repo's gitignored .env and the NAMES it defines, never values) and POST /api/v1/engines/test (drop the
// cached engine tests and run them again). Reads only, except the engine test, which writes nothing but runs the
// engines' own checks and so goes through the same write-request checks as every POST.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EngineTestResult, FullKernel, MachineEnvView, Runtime, ServerPlugin, ServerPluginsView } from "@helmlock/core";
import { composeRows, MACHINE_ENV_FILE, readMachineEnv } from "@helmlock/core";
import type { Hono, Context as HonoContext } from "hono";
import { crewOf, failCrew } from "./crew.ts";
import { failJson, okJson, writeBody } from "./models.ts";

export interface DiagnosticsDeps {
  runtime: Runtime;
  ready: () => Promise<unknown>;
  hostOf: (c: HonoContext) => string;
  log: (line: string) => void;
}

const STATUS = { active: "ok", pending: "pending", failed: "failed" } as const;

/** Every [[plugin]] row with its manifest facts and its mount state in this process. */
export async function serverPlugins(runtime: Runtime): Promise<ServerPluginsView> {
  const files = runtime.ctx.get("files");
  const read = async (rel: string) => ((await files.exists(rel)) ? (await files.readTomlRaw(rel)).data : undefined);
  let rows: ReturnType<typeof composeRows>["rows"] = [];
  let configError = runtime.configError?.message;
  try {
    rows = composeRows({ workspace: await read("workspace.toml"), local: await read("workspace.local.toml") }).rows;
  } catch (e) {
    configError ??= (e as Error).message;
  }
  const states = (runtime.kernel as Partial<FullKernel>).states?.() ?? [];
  const pending = new Map(runtime.kernel.pending().map((p) => [p.id, p.waitingFor.map(String)]));
  const plugins: ServerPlugin[] = rows.map((row) => {
    const m = runtime.manifests.get(row.use);
    const st = states.find((s) => s.id === row.id);
    const base = { id: row.id, use: row.use, provides: m?.provides ?? [], ...(m?.version ? { version: m.version } : {}) };
    if (row.disabled) return { ...base, status: "off" };
    if (!st) return { ...base, status: "failed", error: m ? "not mounted" : `plugin "${row.use}" is not in the catalog` };
    const waiting = st.waitingFor?.map(String) ?? pending.get(row.id);
    return {
      ...base,
      status: STATUS[st.state],
      ...(st.state === "pending" && waiting?.length ? { waiting_for: waiting } : {}),
      ...(st.error ? { error: st.error } : {}),
    };
  });
  return { plugins, ...(configError ? { config_error: configError } : {}) };
}

/** The .env path and the names it defines. Values never leave this function. */
export function machineEnv(root: string): MachineEnvView {
  const file = join(root, MACHINE_ENV_FILE);
  const names = Object.entries(readMachineEnv(root))
    .filter(([, v]) => v !== "")
    .map(([k]) => k)
    .sort();
  return { file, exists: existsSync(file), names };
}

export function registerDiagnosticsRoutes(api: Hono, d: DiagnosticsDeps): void {
  api.get("/server/plugins", async (c) => {
    try {
      await d.ready().catch(() => undefined); // a broken config still lists the rows, with the error
      return okJson(c, await serverPlugins(d.runtime));
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
  api.get("/settings/env", (c) => {
    try {
      return okJson(c, machineEnv(d.runtime.info.root));
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
  api.post("/engines/test", async (c) => {
    try {
      await writeBody(c, d.hostOf);
      await d.ready();
      const crew = crewOf(d.runtime);
      crew.resetEngineCache();
      return okJson<EngineTestResult>(c, await crew.engines());
    } catch (e) {
      return failCrew(c, e, d.log);
    }
  });
}

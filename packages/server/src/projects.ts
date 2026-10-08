// Milestone 7: project switcher. GET /projects (projects/<id>/project.toml with their repo folders resolved through
// the live .code-workspace file) and GET /centers (this knowledge center plus the others this machine has served,
// from ~/.helmlock/recent.toml, each probed with a quick health GET). One console serves one center (F138).
import { statSync } from "node:fs";
import type { CenterEntry, CentersView, ProjectsView, Runtime } from "@helmlock/core";
import { readProjects } from "@helmlock/plugins/notes/notes.ts";
import { centerName, readRecent, userHome } from "@helmlock/plugins/scaffold/recent.ts";
import { readWorkspaceFolders, samePath } from "@helmlock/plugins/scaffold/scaffold.ts";
import type { Hono, Context as HonoContext } from "hono";
import type { ReadModel } from "./data.ts";
import { ApiError } from "./errors.ts";
import { failJson, okJson } from "./models.ts";

export interface ProjectDeps {
  runtime: Runtime;
  ready: () => Promise<ReadModel>;
  log: (line: string) => void;
  home?: string;
  /** Health probe for another console (tests replace it). */
  probe?: (port: number, root: string) => Promise<boolean>;
}

const PROBE_MS = 600;

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Folders of the workspace file as they are now (`hl project add` may have changed it since the server started). */
export function liveFolders(runtime: Runtime): { name: string; abs: string }[] {
  const info = runtime.info;
  if (info.codeWorkspaceFile) {
    try {
      return readWorkspaceFolders(info.codeWorkspaceFile);
    } catch {
      /* fall back to the folders read at start */
    }
  }
  return info.folders.map((f) => ({ name: f.name, abs: f.path }));
}

/** Product folders only: never the knowledge center itself or the system repo. */
function productFolders(runtime: Runtime): { name: string; abs: string }[] {
  const info = runtime.info;
  return liveFolders(runtime).filter((f) => !samePath(f.abs, info.root) && !samePath(f.abs, info.deliveryRoot));
}

export async function projectsView(runtime: Runtime): Promise<ProjectsView> {
  const ctx = runtime.ctx;
  const tickets = await ctx.get("tickets").list();
  const folders = productFolders(runtime);
  const projects = (await readProjects(ctx)).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    repos: p.repos.map((folder) => {
      const f = folders.find((x) => x.name === folder);
      return f ? { folder, path: f.abs, exists: isDir(f.abs) } : { folder, exists: false };
    }),
    tickets: tickets.filter((t) => t.ticket.project === p.id).length,
  }));
  return { projects };
}

/**
 * The folder a run for this project starts in: its first repo folder that the workspace file names and that exists.
 * Only folders of this workspace file are used, so a project.toml cannot point a run anywhere else.
 */
export async function projectCwd(runtime: Runtime, id: string): Promise<string> {
  const p = (await readProjects(runtime.ctx)).find((x) => x.id === id);
  if (!p) throw new ApiError(404, "unknown-project", `no project ${JSON.stringify(id)} in projects/`, { fix: "pick one from GET /api/v1/projects" });
  const folders = productFolders(runtime);
  for (const repo of p.repos) {
    const f = folders.find((x) => x.name === repo);
    if (f && isDir(f.abs)) return f.abs;
  }
  throw new ApiError(422, "no-repo-folder", `project ${id} has no repo folder on this machine (repos: ${p.repos.join(", ") || "none"})`, {
    fix: `add its folder with \`hl project add <folder> --path <path> --id ${id}\``,
  });
}

/** Does a console answer at this port for this root? */
export async function probeConsole(port: number, root: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/workspace`, { signal: AbortSignal.timeout(PROBE_MS), headers: { accept: "application/json" } });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; data?: { root?: unknown } };
    return body.ok === true && typeof body.data?.root === "string" && samePath(body.data.root, root);
  } catch {
    return false;
  }
}

export async function centersView(runtime: Runtime, o: { home?: string; probe?: (port: number, root: string) => Promise<boolean> } = {}): Promise<CentersView> {
  const info = runtime.info;
  const name = centerName(info.root, info.name);
  const consoleName = runtime.ctx.has("config") ? (runtime.ctx.get("config").workspace.workspace.console_name ?? `${name} Console`) : `${name} Console`;
  const probe = o.probe ?? probeConsole;
  const recent = readRecent(o.home ?? userHome()).filter((c) => !samePath(c.root, info.root) && isDir(c.root));
  const others: CenterEntry[] = await Promise.all(
    recent.map(async (c) => {
      const running = await probe(c.port, c.root);
      return {
        name: c.name,
        root: c.root,
        port: c.port,
        last_opened: c.last_opened,
        running,
        ...(running ? { url: `http://127.0.0.1:${c.port}/` } : {}),
        command: c.port === 4317 ? "hl serve" : `hl serve --port ${c.port}`,
      };
    }),
  );
  return { current: { name, console_name: consoleName, root: info.root }, others };
}

export function registerProjectRoutes(api: Hono, d: ProjectDeps): void {
  const get = (path: string, fn: (c: HonoContext) => Promise<unknown>) =>
    api.get(path, async (c) => {
      try {
        await d.ready();
        return okJson(c, await fn(c));
      } catch (e) {
        return failJson(c, e, d.log);
      }
    });
  get("/projects", () => projectsView(d.runtime));
  get("/centers", () =>
    centersView(d.runtime, {
      ...(d.home ? { home: d.home } : {}),
      ...(d.probe ? { probe: d.probe } : {}),
    }),
  );
}

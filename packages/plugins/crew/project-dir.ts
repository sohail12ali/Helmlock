// The repo folder a run for a project starts in (milestone 7, moved here in milestone 8 so the crew plugin and the
// server share it). Only folders of this workspace's .code-workspace file are used, so a project.toml cannot point a
// run anywhere else; the workspace file is read live (`hl project add` may have changed it since start).
import { statSync } from "node:fs";
import type { Context, WorkspaceInfo } from "@helmlock/core";
import { readProjects } from "../notes/notes.ts";
import { readWorkspaceFolders, samePath } from "../scaffold/scaffold.ts";

export class CrewError extends Error {
  readonly rule: string;
  readonly fix: string | undefined;
  constructor(rule: string, message: string, fix?: string) {
    super(message);
    this.rule = rule;
    this.fix = fix;
  }
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Folders of the workspace file as they are now; the folders read at start when the file cannot be read. */
export function liveFolders(info: WorkspaceInfo): { name: string; abs: string }[] {
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
export function productFolders(info: WorkspaceInfo): { name: string; abs: string }[] {
  return liveFolders(info).filter((f) => !samePath(f.abs, info.root) && !samePath(f.abs, info.deliveryRoot));
}

/**
 * The first repo folder of project `id` that the workspace file names and that exists.
 * Throws CrewError "unknown-project" or "no-repo-folder".
 */
export async function projectRepoDir(ctx: Context, id: string): Promise<string> {
  const info = ctx.get("workspace");
  const p = (await readProjects(ctx)).find((x) => x.id === id);
  if (!p) throw new CrewError("unknown-project", `no project ${JSON.stringify(id)} in projects/`, "pick one from GET /api/v1/projects");
  const folders = productFolders(info);
  for (const repo of p.repos) {
    const f = folders.find((x) => x.name === repo);
    if (f && isDir(f.abs)) return f.abs;
  }
  throw new CrewError(
    "no-repo-folder",
    `project ${id} has no repo folder on this machine (repos: ${p.repos.join(", ") || "none"})`,
    `add its folder with \`hl project add <folder> --path <path> --id ${id}\``,
  );
}

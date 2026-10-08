// Folder picker for Add project (Browse...): GET /api/v1/fs/list?path=<absolute>&mode=folder|workspace.
// A browser cannot reveal real paths from <input type=file>, so the console lists folders for it. Read-only and
// names only: folders, and in mode "workspace" *.code-workspace files; never file contents, never other files.
import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { FsEntry, FsListing, FsListMode, FsShortcut, Runtime } from "@helmlock/core";
import { liveFolders } from "@helmlock/plugins/crew/project-dir.ts";
import { userHome } from "@helmlock/plugins/scaffold/recent.ts";
import { ApiError } from "./errors.ts";

/** Most entries listed per folder. */
export const FS_LIST_MAX = 500;

const SKIP = new Set(["node_modules", "system volume information"]);
/** Hidden and system folders the picker never shows: dot folders, $Recycle.Bin and friends, node_modules. */
export const skipName = (name: string): boolean => name.startsWith(".") || name.startsWith("$") || SKIP.has(name.toLowerCase());

const isWorkspaceFile = (name: string) => name.toLowerCase().endsWith(".code-workspace");

/** Drive roots on Windows, "/" elsewhere. */
export function fsRoots(platform: string = process.platform): string[] {
  if (platform !== "win32") return ["/"];
  const out: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try {
      if (existsSync(root)) out.push(root);
    } catch {
      /* an unready drive is skipped */
    }
  }
  return out;
}

function dirInfo(p: string): { git: boolean; workspace: boolean } {
  let git = false;
  let workspace = false;
  try {
    for (const name of readdirSync(p)) {
      if (name === ".git") git = true;
      else if (isWorkspaceFile(name)) workspace = true;
      if (git && workspace) break;
    }
  } catch {
    /* no access: no chips */
  }
  return { git, workspace };
}

function isDirSafe(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fsError(e: unknown, p: string): ApiError {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return new ApiError(404, "not-found", `${p} does not exist`, { fix: "pick a folder from the list or type an existing path" });
  if (code === "ENOTDIR") return new ApiError(400, "bad-request", `${p} is not a folder`);
  if (code === "EACCES" || code === "EPERM" || code === "EBUSY")
    return new ApiError(403, "no-access", `no access to ${p}`, { fix: "pick another folder; this one cannot be read by the console" });
  return new ApiError(400, "bad-request", `cannot list ${p}: ${(e as Error)?.message ?? String(e)}`);
}

export function shortcutsFor(runtime: Runtime, home: string): FsShortcut[] {
  const out: FsShortcut[] = [];
  const add = (label: string, path: string) => {
    const r = resolve(path);
    const k = process.platform === "win32" ? r.toLowerCase() : r;
    if (!out.some((s) => (process.platform === "win32" ? s.path.toLowerCase() : s.path) === k)) out.push({ label, path: r });
  };
  add("Home", home);
  add("Next to this knowledge center", dirname(runtime.info.root));
  for (const f of liveFolders(runtime.info)) if (isDirSafe(f.abs)) add(f.name, f.abs);
  return out;
}

export interface FsListOptions {
  path?: string | undefined;
  mode?: string | undefined;
  home?: string | undefined;
  max?: number;
}

export function listFolder(runtime: Runtime, o: FsListOptions = {}): FsListing {
  if (o.mode && o.mode !== "folder" && o.mode !== "workspace")
    throw new ApiError(400, "bad-request", `mode must be folder or workspace, got ${JSON.stringify(o.mode)}`);
  const mode: FsListMode = o.mode === "workspace" ? "workspace" : "folder";
  const raw = (o.path ?? "").trim().replace(/^["']|["']$/g, "");
  let target: string;
  if (!raw) target = dirname(runtime.info.root);
  else {
    // "C:" alone means the drive root here, not the drive's current folder.
    const p = process.platform === "win32" && /^[a-zA-Z]:$/.test(raw) ? `${raw}\\` : raw;
    if (!isAbsolute(p))
      throw new ApiError(400, "bad-request", `path must be absolute, got ${JSON.stringify(raw)}`, { fix: "start from a drive or a shortcut" });
    target = resolve(p);
  }
  let dirents: Dirent[];
  try {
    if (!statSync(target).isDirectory()) throw Object.assign(new Error("not a folder"), { code: "ENOTDIR" });
    dirents = readdirSync(target, { withFileTypes: true });
  } catch (e) {
    throw fsError(e, target);
  }
  const folders: FsEntry[] = [];
  const files: FsEntry[] = [];
  for (const d of dirents) {
    if (skipName(d.name)) continue;
    const abs = join(target, d.name);
    let dir = d.isDirectory();
    let file = d.isFile();
    if (d.isSymbolicLink()) {
      try {
        const s = statSync(abs);
        dir = s.isDirectory();
        file = s.isFile();
      } catch {
        continue; // a broken link
      }
    }
    if (dir) folders.push({ name: d.name, path: abs, kind: "folder" });
    else if (file && mode === "workspace" && isWorkspaceFile(d.name)) files.push({ name: d.name, path: abs, kind: "workspace-file" });
  }
  const byName = (a: FsEntry, b: FsEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  folders.sort(byName);
  files.sort(byName);
  const max = o.max ?? FS_LIST_MAX;
  const all = [...folders, ...files];
  const entries = all.slice(0, max).map((e) => (e.kind === "folder" ? { ...e, ...dirInfo(e.path) } : e));
  const parent = dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    roots: fsRoots(),
    entries,
    truncated: all.length > max,
    shortcuts: shortcutsFor(runtime, o.home ?? (userHome() || homedir())),
  };
}

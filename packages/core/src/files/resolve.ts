// Finds the knowledge repo, its folders and layers, the delivery repo and the author (F39, B22, B24).
// Sync fs and no zod: this runs on every `hl` start, so it stays cheap (docs/build/m1-baseline.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "smol-toml";
import type { LayerName } from "../contracts/schemas.ts";
import type { WorkspaceFolder, WorkspaceInfo } from "../contracts/services.ts";
import { parseJsonc, stripBom } from "./jsonc.ts";

/** Root of this hl install (the delivery checkout): packages/core/src/files -> repo root. */
export const INSTALL_ROOT = resolve(import.meta.dirname, "../../../..");

const LAYERS: readonly string[] = ["system", "workspace", "project"];

export interface ResolveOptions {
  /** Override the install root (tests). */
  installRoot?: string;
}

function workspaceFileIn(dir: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const hit = names.filter((n) => n.endsWith(".code-workspace")).sort()[0];
  return hit ? join(dir, hit) : undefined;
}

const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
};

/** KEY=VALUE lines; `#` comments, optional `export ` and quotes. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    let v = m[2] ?? "";
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

function readEnvFile(dir: string): Record<string, string> {
  const p = join(dir, ".env");
  if (!existsSync(p)) return {};
  try {
    return parseDotEnv(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** A path from HL_WORKSPACE or .env: a .code-workspace file, or a folder holding one. */
function workspaceFileAt(p: string): string | undefined {
  if (p.endsWith(".code-workspace") && existsSync(p)) return p;
  return workspaceFileIn(p);
}

export function resolveWorkspace(cwd: string, env: Record<string, string | undefined> = process.env, opts: ResolveOptions = {}): WorkspaceInfo {
  const installRoot = resolve(opts.installRoot ?? INSTALL_ROOT);
  const sources: Record<string, string> = {};
  let file: string | undefined;
  let fallbackRoot = resolve(cwd);

  // 1. Which knowledge repo: HL_WORKSPACE, else walk up from cwd. Started from inside the delivery checkout,
  //    the walk stops at its root and uses the .env there (HL_WORKSPACE names the default workspace).
  if (env.HL_WORKSPACE) {
    const p = resolve(cwd, env.HL_WORKSPACE);
    file = workspaceFileAt(p);
    fallbackRoot = p;
    sources.root = file ? `HL_WORKSPACE (${file})` : `HL_WORKSPACE (${p}, no .code-workspace)`;
  } else {
    const fromInstall = inside(fallbackRoot, installRoot);
    for (let dir = fallbackRoot; ; dir = dirname(dir)) {
      file = workspaceFileIn(dir);
      if (file) {
        sources.root = `found ${file}`;
        break;
      }
      if (fromInstall && dir === installRoot) {
        const dotenv = readEnvFile(installRoot).HL_WORKSPACE;
        if (dotenv) {
          const p = resolve(installRoot, dotenv);
          file = workspaceFileAt(p);
          fallbackRoot = p;
          sources.root = file ? `.env HL_WORKSPACE (${file})` : `.env HL_WORKSPACE (${p}, no .code-workspace)`;
          break;
        }
      }
      if (dirname(dir) === dir) break;
    }
    sources.root ??= "none (no .code-workspace found)";
  }
  const root = file ? dirname(file) : fallbackRoot;

  // 2. Folders and their layers: root -> workspace, workspace.toml [[layers]] by folder name, "system" -> system.
  const layerByName = new Map<string, LayerName>();
  try {
    const ws = parse(readFileSync(join(root, "workspace.toml"), "utf8")) as { layers?: unknown };
    if (Array.isArray(ws.layers)) {
      for (const row of ws.layers as Record<string, unknown>[]) {
        if (typeof row?.folder === "string" && typeof row.layer === "string" && LAYERS.includes(row.layer)) {
          layerByName.set(row.folder, row.layer as LayerName);
        }
      }
    }
    sources.layers = "workspace.toml [[layers]]";
  } catch (e) {
    sources.layers = existsSync(join(root, "workspace.toml"))
      ? `workspace.toml unreadable: ${(e as Error).message.split("\n")[0]}`
      : "defaults (no workspace.toml)";
  }

  const folders: WorkspaceFolder[] = [];
  if (file) {
    const ws = parseJsonc(readFileSync(file, "utf8")) as { folders?: unknown };
    const rows = Array.isArray(ws.folders) ? (ws.folders as Record<string, unknown>[]) : [];
    for (const f of rows) {
      if (typeof f?.path !== "string") continue;
      const path = resolve(root, f.path);
      const name = typeof f.name === "string" && f.name ? f.name : basename(path);
      const layer = layerByName.get(name) ?? (path === root ? "workspace" : name === "system" ? "system" : "product");
      folders.push({ name, path, layer });
    }
  }

  // 3. Delivery repo: HL_DELIVERY, else the system folder, else this install.
  let deliveryRoot: string;
  const sys = folders.find((f) => f.layer === "system");
  if (env.HL_DELIVERY) {
    deliveryRoot = resolve(cwd, env.HL_DELIVERY);
    sources.deliveryRoot = "HL_DELIVERY";
  } else if (sys) {
    deliveryRoot = sys.path;
    sources.deliveryRoot = `code-workspace folder '${sys.name}'`;
  } else {
    deliveryRoot = installRoot;
    sources.deliveryRoot = "this hl install";
  }

  // 4. Author: first non-empty, non-comment line of author.local.
  let author: string | undefined;
  try {
    author = stripBom(readFileSync(join(root, "author.local"), "utf8"))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
  } catch {
    author = undefined;
  }
  sources.author = author ? "author.local" : "missing";

  const name = file ? basename(file).replace(/\.code-workspace$/, "") : "";
  return { root, deliveryRoot, codeWorkspaceFile: file, folders, name, author, sources };
}

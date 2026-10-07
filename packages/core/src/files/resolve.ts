// WALKING SKELETON (wave 0). S2 owns this: full rules for finding the knowledge repo,
// the delivery repo (.code-workspace "system" folder, HL_DELIVERY, delivery .env), layers and author.local.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CodeWorkspace } from "../contracts/schemas.ts";
import type { WorkspaceFolder, WorkspaceInfo } from "../contracts/services.ts";

function findUp(start: string): string | undefined {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const hit = readdirSync(dir).find((n) => n.endsWith(".code-workspace"));
    if (hit) return join(dir, hit);
    if (dirname(dir) === dir) return undefined;
  }
}

export function resolveWorkspace(cwd: string, env: Record<string, string | undefined> = process.env): WorkspaceInfo {
  const sources: Record<string, string> = {};
  const explicit = env.HL_WORKSPACE;
  const file = explicit ? findUp(explicit) : findUp(cwd);
  const root = file ? dirname(file) : resolve(explicit ?? cwd);
  sources.root = file ? `found ${file}` : "none (no .code-workspace found)";
  const folders: WorkspaceFolder[] = [];
  if (file) {
    const ws = CodeWorkspace.parse(JSON.parse(readFileSync(file, "utf8")));
    for (const f of ws.folders) {
      const path = resolve(root, f.path);
      const name = f.name ?? path.split(/[\\/]/).pop() ?? f.path;
      const layer = path === root ? "workspace" : name === "system" ? "system" : "product";
      folders.push({ name, path, layer });
    }
  }
  let deliveryRoot = env.HL_DELIVERY;
  if (deliveryRoot) sources.deliveryRoot = "HL_DELIVERY";
  else {
    const sys = folders.find((f) => f.layer === "system");
    deliveryRoot = sys?.path ?? resolve(import.meta.dirname, "../../../..");
    sources.deliveryRoot = sys ? "code-workspace folder 'system'" : "this hl install";
  }
  const authorFile = join(root, "author.local");
  const author = existsSync(authorFile)
    ? readFileSync(authorFile, "utf8")
        .split(/\r?\n/)
        .find((l) => l.trim())
        ?.trim()
    : undefined;
  sources.author = author ? "author.local" : "missing";
  const name = file ? (file.split(/[\\/]/).pop() ?? "").replace(/\.code-workspace$/, "") : "";
  return { root, deliveryRoot: resolve(deliveryRoot), codeWorkspaceFile: file, folders, name, author, sources };
}

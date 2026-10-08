// Knowledge centers this machine has served: ~/.helmlock/recent.toml, per user, never in any repo (milestone 7).
// `hl serve` records { name, root, port, last_opened }; the console lists the others with how to open each.
// One console serves one knowledge center (F138): this list only points at other consoles, it never switches.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse, stringify } from "smol-toml";

export interface RecentCenter {
  name: string;
  root: string;
  port: number;
  last_opened: string;
}

/** Most entries kept; the oldest drop off. */
export const RECENT_MAX = 20;

/** The per-user folder: HL_USER_HOME (tests) or the OS home. */
export const userHome = (env: Record<string, string | undefined> = process.env): string => env.HL_USER_HOME || homedir();
export const recentFile = (home: string): string => join(home, ".helmlock", "recent.toml");

const key = (root: string) => {
  const r = resolve(root).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
};

/** The knowledge center's name: workspace.toml [workspace] name, else the fallback (the workspace file's name). */
export function centerName(root: string, fallback: string): string {
  try {
    const t = parse(readFileSync(join(root, "workspace.toml"), "utf8")) as { workspace?: { name?: unknown } };
    if (typeof t.workspace?.name === "string" && t.workspace.name.trim()) return t.workspace.name.trim();
  } catch {
    /* no or broken workspace.toml: hl doctor reports it */
  }
  return fallback;
}

/** The recorded centers, newest first. A missing or broken file reads as empty (it is a convenience list). */
export function readRecent(home: string): RecentCenter[] {
  const file = recentFile(home);
  if (!existsSync(file)) return [];
  let raw: { center?: unknown };
  try {
    raw = parse(readFileSync(file, "utf8")) as { center?: unknown };
  } catch {
    return [];
  }
  const out: RecentCenter[] = [];
  for (const c of Array.isArray(raw.center) ? (raw.center as Record<string, unknown>[]) : []) {
    const port = Number(c.port);
    if (typeof c.name !== "string" || typeof c.root !== "string" || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    out.push({ name: c.name, root: c.root, port, last_opened: typeof c.last_opened === "string" ? c.last_opened : "" });
  }
  return out.sort((a, b) => b.last_opened.localeCompare(a.last_opened));
}

/** Adds or refreshes one center (matched by root). Best effort: a failure must never stop `hl serve`. */
export function recordRecent(home: string, entry: Omit<RecentCenter, "last_opened"> & { last_opened?: string }): RecentCenter[] {
  const now: RecentCenter = { ...entry, root: resolve(entry.root), last_opened: entry.last_opened ?? new Date().toISOString() };
  const list = [now, ...readRecent(home).filter((c) => key(c.root) !== key(now.root))].slice(0, RECENT_MAX);
  const file = recentFile(home);
  mkdirSync(join(file, ".."), { recursive: true });
  const text = `# Knowledge centers served on this machine (written by hl serve; safe to delete).\n${stringify({ center: list })}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, file);
  return list;
}

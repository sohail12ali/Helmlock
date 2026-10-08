// Post-run guard for protected state paths. The Cursor CLI in print mode ignores .cursor/cli.json deny rules
// and its hooks (pre-flight, 2026-10-07), and a shell command can write a file under any host. So the runtime
// hashes the protected files before a run and again after it; a change that no hl activity line explains is
// reported as failure class "protected-path-write". Nothing is reverted.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { globBase, globToRegExp } from "./glob.ts";

/** Knowledge-repo state that only hl verbs may write (Blueprint 10, harness.toml [permissions] deny). */
export const DEFAULT_PROTECTED = [
  "artifacts/**/ticket.toml",
  "artifacts/**/tasks.toml",
  "artifacts/**/decisions/*.toml",
  "artifacts/**/questions/*.toml",
  "artifacts/**/bugs/*.toml",
  "artifacts/**/gaps/*.toml",
  "logs/**",
  "activity/**",
  "workspace.toml",
  "people.toml",
  "projects/*/project.toml",
];

const SKIP = new Set([".git", "node_modules"]);

/**
 * The built-in state paths plus permissions.deny from every harness/harness.toml under `roots` (system and workspace
 * layers). A union: a workspace layer with an empty deny list must never switch the protection off.
 */
export function protectedGlobs(roots: readonly string[]): string[] {
  const out = new Set<string>(DEFAULT_PROTECTED);
  for (const r of roots) {
    const f = join(r, "harness", "harness.toml");
    if (!existsSync(f)) continue;
    try {
      const deny = (parseToml(readFileSync(f, "utf8")) as { permissions?: { deny?: unknown } }).permissions?.deny;
      if (Array.isArray(deny)) for (const d of deny) if (typeof d === "string") out.add(d.replace(/^(?:Edit|Write)\((.*)\)$/, "$1"));
    } catch {
      /* unreadable layer: the defaults still apply */
    }
  }
  return [...out];
}

export type Snapshot = Map<string, string>;

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(root, r, out);
    else if (e.isFile()) out.push(r);
  }
}

/** sha256 of every file under `root` that matches a protected glob. */
export async function snapshot(root: string, globs: readonly string[]): Promise<Snapshot> {
  const snap: Snapshot = new Map();
  const res = globs.map((g) => globToRegExp(g));
  const candidates = new Set<string>();
  for (const g of globs) {
    if (!/[*?[]/.test(g)) {
      candidates.add(g.replace(/\\/g, "/"));
      continue;
    }
    const base = globBase(g);
    const files: string[] = [];
    if (base) await walk(root, base, files);
    else {
      // A wildcard at the top level: only look at root files and one level down, never the whole tree.
      for (const e of await readdir(root, { withFileTypes: true }).catch(() => [])) if (e.isFile()) files.push(e.name);
    }
    for (const f of files) candidates.add(f);
  }
  for (const f of candidates) {
    if (!res.some((r) => r.test(f))) continue;
    try {
      snap.set(
        f,
        createHash("sha256")
          .update(await readFile(join(root, f)))
          .digest("hex"),
      );
    } catch {
      /* missing literal path */
    }
  }
  return snap;
}

export function diff(before: Snapshot, after: Snapshot): string[] {
  const changed = new Set<string>();
  for (const [f, h] of after) if (before.get(f) !== h) changed.add(f);
  for (const f of before.keys()) if (!after.has(f)) changed.add(f);
  return [...changed].sort();
}

interface ActivityRow {
  verb?: string;
  entity?: string;
  dry_run?: boolean;
}

/** Activity rows appended during the run (lines present after but not before, in changed activity files). */
async function newActivity(root: string, changed: string[], before: Map<string, string>): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  for (const f of changed.filter((c) => c.startsWith("activity/") && c.endsWith(".jsonl"))) {
    let text = "";
    try {
      text = await readFile(join(root, f), "utf8");
    } catch {
      continue;
    }
    const old = before.get(f) ?? "";
    const added = text.startsWith(old) ? text.slice(old.length) : text;
    for (const line of added.split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as ActivityRow);
      } catch {
        /* not an hl line */
      }
    }
  }
  return rows;
}

export interface ProtectGuard {
  /** Call after the run; returns the protected files changed outside hl. */
  check(): Promise<string[]>;
}

/** Take the "before" snapshot now; check() compares and filters out changes hl explains. */
export async function guardProtected(root: string, globs: readonly string[] = DEFAULT_PROTECTED): Promise<ProtectGuard> {
  const before = await snapshot(root, globs);
  const activityText = new Map<string, string>();
  for (const f of before.keys()) if (f.startsWith("activity/")) activityText.set(f, await readFile(join(root, f), "utf8").catch(() => ""));
  return {
    async check() {
      const after = await snapshot(root, globs);
      const changed = diff(before, after);
      if (!changed.length) return [];
      const rows = (await newActivity(root, changed, activityText)).filter((r) => !r.dry_run);
      const entities = rows.map((r) => r.entity).filter((e): e is string => Boolean(e));
      const verbs = new Set(rows.map((r) => r.verb ?? ""));
      return changed.filter((f) => {
        if (f.startsWith("activity/")) return rows.length === 0; // hl appended lines: explained
        if (entities.some((e) => f.includes(e))) return false;
        if (f.startsWith("logs/") && verbs.has("log-work")) return false;
        if ((f === "workspace.toml" || f.endsWith("project.toml")) && (verbs.has("project add") || verbs.has("init"))) return false;
        return true;
      });
    },
  };
}

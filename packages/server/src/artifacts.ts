// The ordered artifact index of one ticket folder (F148), and safe reads of one artifact.
// The index is generated from the folder on every request, never hand-kept.
import { readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { ArtifactKind, ArtifactRef } from "@helmlock/core";
import { ApiError } from "./errors.ts";

/** Largest artifact the content endpoint returns. */
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

const RECORD_GROUPS: Record<string, { group: ArtifactRef["group"]; rank: number }> = {
  decisions: { group: "decisions", rank: 3 },
  questions: { group: "questions", rank: 4 },
  bugs: { group: "bugs", rank: 5 },
  gaps: { group: "gaps", rank: 6 },
};

export function kindOf(name: string): ArtifactKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md") return "md";
  if (ext === "toml") return "toml";
  if (ext === "jsonl") return "jsonl";
  if (ext === "html" || ext === "htm") return "html";
  return "other";
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** Group and sort rank: spec, plan, tasks.toml, decisions, questions, bugs, gaps, test cases, other. */
function classify(rel: string): { group: ArtifactRef["group"]; rank: number; title?: string } {
  const parts = rel.split("/");
  const name = parts[parts.length - 1] as string;
  const lower = name.toLowerCase();
  const top = parts.length === 1;
  if (!top && RECORD_GROUPS[parts[0] as string]) return RECORD_GROUPS[parts[0] as string]!;
  if (top && lower === "tasks.toml") return { group: "tasks", rank: 2, title: "Tasks" };
  if (/test-?cases?|(^|\/)tests?\//i.test(rel)) return { group: "tests", rank: 7 };
  const kind = kindOf(name);
  if (top && (kind === "md" || kind === "html")) {
    if (/(^|[-_.])spec([-_.]|$)/.test(lower)) return { group: "docs", rank: 0, title: kind === "html" ? "Spec (page)" : "Spec" };
    if (/(^|[-_.])plan([-_.]|$)/.test(lower)) return { group: "docs", rank: 1, title: kind === "html" ? "Plan (page)" : "Plan" };
    return { group: "docs", rank: 8 };
  }
  return { group: "other", rank: 8 };
}

async function walk(abs: string, base: string, out: { rel: string; size: number }[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "_work") continue;
    if (e.name.endsWith(".lock") || e.name.includes(".tmp-")) continue;
    const p = join(abs, e.name);
    if (e.isDirectory()) await walk(p, base, out);
    else if (e.isFile()) out.push({ rel: relative(base, p).split(sep).join("/"), size: (await stat(p)).size });
  }
}

/**
 * Build the ordered index of artifacts/<ticket>/ (skipping _work/, dotfiles, locks and temp files).
 * `titles` maps a record id (D-001-sa) to its title.
 */
export async function artifactIndex(root: string, ticketDir: string, titles: Map<string, string> = new Map()): Promise<ArtifactRef[]> {
  const base = join(root, ticketDir);
  const found: { rel: string; size: number }[] = [];
  await walk(base, base, found);
  const refs = found.map(({ rel, size }) => {
    const c = classify(rel);
    const name = rel.split("/").pop() as string;
    const title = c.title ?? titles.get(stem(name)) ?? stem(name);
    const ref: ArtifactRef & { rank: number } = {
      id: rel.replaceAll("/", "~"),
      title,
      kind: kindOf(name),
      path: `${ticketDir}/${rel}`,
      group: c.group,
      size,
      rank: c.rank,
    };
    return ref;
  });
  refs.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  return refs.map(({ rank: _rank, ...r }) => r);
}

/** Refuse ids that could leave the ticket folder before any file system access. */
export function checkArtifactId(id: string): void {
  const rel = id.replaceAll("~", "/");
  const bad =
    !id ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id.includes(":") ||
    rel.split("/").some((seg) => seg === ".." || seg === "." || seg === "") ||
    rel.split("/")[0] === "_work";
  if (bad)
    throw new ApiError(400, "path-outside-ticket", `artifact id ${JSON.stringify(id)} is not a path inside the ticket folder`, {
      fix: "use an id from the ticket's artifacts index",
    });
}

/** Resolve the real file and make sure it is still inside the ticket folder (symlinks included). */
export async function resolveArtifactFile(root: string, ticketDir: string, id: string): Promise<string> {
  checkArtifactId(id);
  const base = resolve(root, ticketDir);
  const abs = resolve(base, ...id.split("~"));
  const inside = (dir: string, p: string) => p.startsWith(dir + sep);
  if (!inside(base, abs)) throw new ApiError(400, "path-outside-ticket", `artifact ${id} is outside the ticket folder`);
  let real: string;
  let realBase: string;
  try {
    [real, realBase] = await Promise.all([realpath(abs), realpath(base)]);
  } catch {
    throw new ApiError(404, "unknown-artifact", `no artifact ${id}`, { fix: "use an id from the ticket's artifacts index" });
  }
  if (!inside(realBase, real)) throw new ApiError(400, "path-outside-ticket", `artifact ${id} is outside the ticket folder`);
  return real;
}

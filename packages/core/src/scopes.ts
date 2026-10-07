// Storage scopes (Blueprint 31): where a scoped kind (todos, notes, chats, agents, skills) lives.
// team = the shared place (todos/), personal = people/<slug>/<kind> (committed, visible to the team),
// private = .hl-local/<kind> (gitignored, this machine only). The location is the truth; a scope field in a file is
// only informational.
import type { Scope } from "./contracts/schemas.ts";

/** The gitignored folder for private, this-machine-only items. */
export const LOCAL_DIR = ".hl-local";
export const PEOPLE_DIR = "people";

/** Plain words for the console and verb output. */
export const SCOPE_LABEL: Record<Scope, string> = {
  team: "shared with the team",
  personal: "your own list, shared with the team",
  private: "only on this machine",
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Folder (root-relative, forward slashes) of a kind in a scope: "todos", "people/sam/todos", ".hl-local/todos". */
export function scopeDir(scope: Scope, kind: string, slug?: string): string {
  if (scope === "team") return kind;
  if (scope === "private") return `${LOCAL_DIR}/${kind}`;
  if (!slug || !SLUG.test(slug)) throw new Error(`a personal ${kind} folder needs a person slug, got ${JSON.stringify(slug)}`);
  return `${PEOPLE_DIR}/${slug}/${kind}`;
}

/** Globs that cover a kind in every scope on this machine (team, every person, private). */
export function scopeGlobs(kind: string, file: string): string[] {
  return [`${kind}/${file}`, `${PEOPLE_DIR}/*/${kind}/${file}`, `${LOCAL_DIR}/${kind}/${file}`];
}

/** The scope (and owner, for personal) of a root-relative path. */
export function scopeOfPath(rel: string): { scope: Scope; slug?: string } {
  const p = rel.replaceAll("\\", "/").replace(/^\.\//, "");
  if (p === LOCAL_DIR || p.startsWith(`${LOCAL_DIR}/`)) return { scope: "private" };
  const m = /^people\/([^/]+)\//.exec(p);
  if (m) return { scope: "personal", slug: m[1] as string };
  return { scope: "team" };
}

// Where the loop's file tools may reach: the run's cwd, its added folders and the knowledge root. Knowledge-repo state
// files (runtimes protect.ts) are refused for edit and write: agents change state only through hl verbs.
import { isAbsolute, relative, resolve } from "node:path";
import { matchesAny } from "../runtimes/glob.ts";

export interface PathPolicy {
  cwd: string;
  /** Every folder a path may be in (cwd, addDirs, knowledge root). */
  roots: string[];
  knowledgeRoot: string;
  protectedGlobs: readonly string[];
}

export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const inside = (root: string, abs: string): string | undefined => {
  const rel = relative(root, abs);
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.replace(/\\/g, "/");
};

/** An absolute path inside one of the roots, or a PATH_OUTSIDE error. */
export function resolvePath(policy: PathPolicy, raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new ToolError("BAD_ARGS", "give a path");
  const abs = resolve(policy.cwd, raw.trim());
  if (!policy.roots.some((r) => inside(r, abs) !== undefined))
    throw new ToolError("PATH_OUTSIDE", `${raw} is outside the work folders (${policy.roots.join(", ")})`);
  return abs;
}

/** The knowledge-root relative path when `abs` is a protected state file. */
export function protectedRel(policy: PathPolicy, abs: string): string | undefined {
  const rel = inside(policy.knowledgeRoot, abs);
  if (rel === undefined || rel === "") return undefined;
  return matchesAny(rel, policy.protectedGlobs) ? rel : undefined;
}

export function assertWritable(policy: PathPolicy, abs: string): void {
  const rel = protectedRel(policy, abs);
  if (rel) throw new ToolError("PROTECTED_PATH", `${rel} is knowledge-repo state: change it with an hl verb (the hl tool), never by editing the file`);
}

/** True when the path is inside the run's own work folder (auto-review edits there without asking). */
export const insideCwd = (policy: PathPolicy, abs: string) => inside(policy.cwd, abs) !== undefined;

/** Secrets never go to a model. */
export function assertReadable(abs: string): void {
  const base = abs.replace(/\\/g, "/").split("/").pop() ?? "";
  if (/^\.env(\..*)?$/i.test(base) && !/\.(example|template|sample)$/i.test(base))
    throw new ToolError("SECRET_FILE", `${base} holds secrets and is never read by the loop`);
}

/** A short display form: relative to cwd when inside it. */
export function display(policy: PathPolicy, abs: string): string {
  const rel = inside(policy.cwd, abs);
  return rel === undefined ? abs.replace(/\\/g, "/") : rel || ".";
}

/** Key for the read-before-edit map (case-insensitive on Windows). */
export const pathKey = (abs: string) => (process.platform === "win32" ? abs.toLowerCase() : abs);

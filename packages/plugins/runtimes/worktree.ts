// A git worktree per ticket for build runs (F156; control-center worktrees.py, lc-wms worktrees.py). The worktree
// lives outside the product repo, under the knowledge repo's gitignored .hl-cache/worktrees/<repo>/<ticket>, on branch
// hl/<ticket> from the product repo's HEAD: the product repo gets no stray folder and no .gitignore change, and the
// cache is local like runs/. Git runs from PATH without a shell. Never a force, never a push.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export const PATCH_LIMIT = 512 * 1024;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((res) =>
    execFile("git", args, { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code as number) : 1) : 0;
      res({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    }),
  );
}

async function must(args: string[], cwd: string): Promise<string> {
  const r = await git(args, cwd);
  if (r.code !== 0) throw Object.assign(new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`), { rule: "git-failed" });
  return r.stdout;
}

const same = (a: string, b: string) => resolve(a).replaceAll("\\", "/").toLowerCase() === resolve(b).replaceAll("\\", "/").toLowerCase();

/** The top folder of the git repo holding `cwd`, or undefined outside a repo (or without git). */
export async function repoRoot(cwd: string): Promise<string | undefined> {
  if (!existsSync(cwd)) return undefined;
  const r = await git(["rev-parse", "--show-toplevel"], cwd);
  return r.code === 0 && r.stdout.trim() ? resolve(r.stdout.trim()) : undefined;
}

/** A ticket id as a folder and branch name segment. */
export const safeSegment = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "") || "x";

export interface WorktreeInfo {
  path: string;
  branch: string;
  repo: string;
}

/** Where the worktree of `ticket` in `repo` lives. */
export function worktreePath(knowledgeRoot: string, repo: string, ticket: string): string {
  return join(knowledgeRoot, ".hl-cache", "worktrees", safeSegment(basename(repo)), safeSegment(ticket));
}

/** Create the worktree on hl/<ticket> (from HEAD), or reuse the one already there. */
export async function ensureWorktree(knowledgeRoot: string, repo: string, ticket: string): Promise<WorktreeInfo & { created: boolean }> {
  const path = worktreePath(knowledgeRoot, repo, ticket);
  const branch = `hl/${safeSegment(ticket)}`;
  await git(["worktree", "prune"], repo);
  if (existsSync(path)) {
    const top = await repoRoot(path);
    if (top && same(top, path)) return { path, branch, repo, created: false };
    throw Object.assign(new Error(`${path} exists but is not a git worktree`), { rule: "worktree-blocked", fix: "remove the folder and start again" });
  }
  const exists = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo)).code === 0;
  await must(exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"], repo);
  return { path, branch, repo, created: true };
}

/** The run's cwd inside the worktree: the same sub folder of the repo as the original cwd. */
export function cwdInWorktree(cwd: string, wt: WorktreeInfo): string {
  const rel = relative(wt.repo, cwd);
  return rel && !rel.startsWith("..") ? join(wt.path, rel) : wt.path;
}

/** `-c user.name/-c user.email` when the repo has no identity, so a wip or merge commit never fails on it. */
async function identity(cwd: string): Promise<string[]> {
  const email = (await git(["config", "user.email"], cwd)).stdout.trim();
  return email ? [] : ["-c", "user.name=Helmlock", "-c", "user.email=helmlock@localhost"];
}

/**
 * Commit whatever the run left uncommitted in the worktree as one "wip" commit, so the branch holds the whole result
 * and Merge needs no extra step. Returns false when there was nothing to commit.
 */
export async function commitWip(wt: WorktreeInfo, message: string): Promise<boolean> {
  if (!existsSync(wt.path)) return false;
  await must(["add", "-A"], wt.path);
  if ((await git(["diff", "--cached", "--quiet"], wt.path)).code === 0) return false;
  await must([...(await identity(wt.path)), "commit", "--no-verify", "-q", "-m", message], wt.path);
  return true;
}

function numstat(text: string): { file: string; added: number; removed: number }[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [a, r, ...rest] = l.split("\t");
      return { file: rest.join("\t"), added: a === "-" ? 0 : Number(a) || 0, removed: r === "-" ? 0 : Number(r) || 0 };
    });
}

/**
 * Files changed on hl/<ticket> since it left the repo's current branch (their merge base). While the worktree exists
 * the working tree is compared, so uncommitted and new files of a live run count too (new files are marked
 * intent-to-add, which the wip commit at run end makes real anyway).
 */
export async function worktreeDiff(wt: WorktreeInfo): Promise<{ files: { file: string; added: number; removed: number }[]; patch: string }> {
  const base = (await must(["merge-base", "HEAD", wt.branch], wt.repo)).trim();
  let stat: string;
  let patch: string;
  if (existsSync(wt.path)) {
    await git(["add", "--intent-to-add", "--", "."], wt.path);
    stat = await must(["diff", "--numstat", base], wt.path);
    patch = await must(["diff", base], wt.path);
  } else {
    stat = await must(["diff", "--numstat", base, wt.branch], wt.repo);
    patch = await must(["diff", base, wt.branch], wt.repo);
  }
  if (patch.length > PATCH_LIMIT) patch = `${patch.slice(0, PATCH_LIMIT)}\n... (patch cut at ${PATCH_LIMIT / 1024} KB)\n`;
  return { files: numstat(stat), patch };
}

/**
 * Merge hl/<ticket> into the repo's current branch: only from a clean main checkout and only when git reports no
 * conflict (checked first with `git merge-tree`, which touches nothing). Fast-forward when possible, else a merge
 * commit. Refusals come back as merged: false with the reason.
 */
export async function mergeWorktree(wt: WorktreeInfo): Promise<{ merged: boolean; message: string }> {
  const current = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], wt.repo);
  if (current.code !== 0) return { merged: false, message: `${wt.repo} is on a detached HEAD; check out a branch first` };
  const into = current.stdout.trim();
  if (into === wt.branch) return { merged: false, message: `${wt.repo} has ${wt.branch} checked out itself` };
  const dirty = (await must(["status", "--porcelain", "--untracked-files=no"], wt.repo)).trim();
  if (dirty) return { merged: false, message: `${wt.repo} has uncommitted changes on ${into}; commit or stash them, then merge again` };
  const ahead = Number((await must(["rev-list", "--count", `HEAD..${wt.branch}`], wt.repo)).trim());
  if (!ahead) return { merged: false, message: `nothing to merge: ${wt.branch} has no commits that ${into} lacks` };
  const tree = await git(["merge-tree", "--write-tree", "--name-only", "HEAD", wt.branch], wt.repo);
  if (tree.code === 1) {
    const files = tree.stdout
      .split("\n")
      .slice(1)
      .filter((l) => l.trim() && !l.startsWith("Auto-merging") && !l.startsWith("CONFLICT"));
    return { merged: false, message: `${wt.branch} conflicts with ${into}${files.length ? ` in ${files.slice(0, 10).join(", ")}` : ""}; resolve it by hand` };
  }
  const r = await git([...(await identity(wt.repo)), "merge", "--no-edit", wt.branch], wt.repo);
  if (r.code !== 0) {
    await git(["merge", "--abort"], wt.repo);
    return { merged: false, message: `git merge refused: ${(r.stderr || r.stdout).trim().slice(0, 300)}` };
  }
  const ff = /fast-forward/i.test(r.stdout);
  return { merged: true, message: `merged ${wt.branch} into ${into} (${ff ? "fast-forward" : "merge commit"}, ${ahead} commit${ahead === 1 ? "" : "s"})` };
}

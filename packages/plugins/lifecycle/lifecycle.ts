// Ticket lifecycle (Blueprint 19, F124 to F127): close with a checked digest, archive with a sha256 manifest,
// restore after verifying it, and suggest what is eligible to archive. Nothing here deletes by itself.
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Actor, Context, Ticket, TicketToml } from "@helmlock/core";
import { TicketId } from "@helmlock/core";
import { parse } from "smol-toml";
import { checkDigest, type DigestCheck, digestNames, splitFrontmatter } from "./digest.ts";

export const MANIFEST = "manifest.sha256";
export const ARCHIVE = "archive";
export const SHARED_DIGESTS = "shared/digests";
export const DEFAULT_ARCHIVE_AFTER_DAYS = 30;

export class LifecycleError extends Error {
  readonly rule: string;
  readonly fix: string | undefined;
  readonly file: string | undefined;
  constructor(rule: string, message: string, extra: { fix?: string; file?: string } = {}) {
    super(message);
    this.rule = rule;
    this.fix = extra.fix;
    this.file = extra.file;
  }
}

const p2 = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function checkId(id: string): void {
  if (!TicketId.safeParse(id).success) throw new LifecycleError("bad-id", `not a ticket id: ${id}`, { fix: "ticket ids look like T-014-sa" });
}

/** The ticket's digest file (relative path), or undefined. */
export async function findDigest(ctx: Context, dir: string, id: string): Promise<string | undefined> {
  const files = ctx.get("files");
  for (const n of digestNames(id)) if (await files.exists(`${dir}/${n}`)) return `${dir}/${n}`;
  return undefined;
}

export function terminalStages(ctx: Context): Set<string> {
  return new Set(
    ctx
      .get("workflow")
      .stages()
      .filter((s) => s.terminal)
      .map((s) => s.id),
  );
}

/** When a ticket was closed: the digest's `closed:` date when it has one, else the ticket's last update. */
export async function closedAt(ctx: Context, t: Ticket): Promise<string> {
  const rel = await findDigest(ctx, t.dir, t.ticket.id);
  if (rel) {
    const { fm } = splitFrontmatter(await ctx.get("files").readText(rel));
    if (fm.closed && /^\d{4}-\d{2}-\d{2}/.test(fm.closed) && !Number.isNaN(Date.parse(fm.closed))) return fm.closed.slice(0, 10);
  }
  return localDate(new Date(t.ticket.updated));
}

// ---------- close ----------
export interface CloseOutcome {
  ticket: string;
  digest: string | undefined;
  check: DigestCheck | undefined;
  stage: string;
  already_closed: boolean;
  gate?: { allowed: boolean; reasons: { rule: string; message: string; fix?: string }[] };
}

export async function closeTicket(ctx: Context, id: string, actor: Actor, dryRun: boolean): Promise<CloseOutcome> {
  checkId(id);
  const t = await ctx.get("tickets").get(id);
  const terminal = terminalStages(ctx);
  const target = [...terminal][0];
  if (!target) throw new LifecycleError("no-terminal-stage", "the workflow has no terminal stage to close into");
  const rel = await findDigest(ctx, t.dir, id);
  const out: CloseOutcome = { ticket: id, digest: rel, check: undefined, stage: t.ticket.stage, already_closed: terminal.has(t.ticket.stage) };
  if (!rel) return out;
  out.check = checkDigest(await ctx.get("files").readText(rel));
  if (!out.check.ok || out.already_closed) return out;
  const moved = await ctx.get("tickets").move(id, target, actor, { dryRun });
  out.gate = moved.gate;
  if (moved.gate.allowed) out.stage = dryRun ? target : moved.ticket.ticket.stage;
  return out;
}

// ---------- archive and restore ----------
async function walkFiles(absDir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(absDir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await walkFiles(join(absDir, d.name), rel)));
    else if (d.isFile()) out.push(rel);
  }
  return out.sort();
}

export async function manifestOf(absDir: string): Promise<{ path: string; sha256: string }[]> {
  const out: { path: string; sha256: string }[] = [];
  for (const f of await walkFiles(absDir)) {
    if (f === MANIFEST) continue;
    out.push({ path: f, sha256: sha256(await readFile(join(absDir, f))) });
  }
  return out;
}

export const manifestText = (rows: { path: string; sha256: string }[]) => rows.map((r) => `${r.sha256}  ${r.path}\n`).join("");

export function parseManifest(text: string): { path: string; sha256: string }[] {
  const out: { path: string; sha256: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (m) out.push({ sha256: m[1] as string, path: m[2] as string });
  }
  return out;
}

/** Rename, or copy then remove when a rename is refused (Windows file watchers, other drives). */
async function moveDir(src: string, dst: string): Promise<void> {
  await mkdir(dirname(dst), { recursive: true });
  try {
    await rename(src, dst);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EXDEV" && code !== "EBUSY" && code !== "EACCES") throw e;
    await cp(src, dst, { recursive: true, errorOnExist: true, force: false });
    await rm(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const isDir = async (p: string) => (await stat(p).catch(() => undefined))?.isDirectory() ?? false;

/** archive/YYYY-MM/<T> holding this ticket, relative to the root, or undefined. */
export async function findArchived(root: string, id: string): Promise<string | undefined> {
  checkId(id);
  const months = (await readdir(join(root, ARCHIVE), { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const m of months) if (await isDir(join(root, ARCHIVE, m, id))) return `${ARCHIVE}/${m}/${id}`;
  return undefined;
}

export interface ArchivePlan {
  ticket: string;
  title: string;
  from: string;
  to: string;
  files: number;
  digest: string;
  digest_copy: string;
  dry_run: boolean;
}

export async function archiveTicket(ctx: Context, id: string, o: { dryRun: boolean; now?: Date }): Promise<ArchivePlan> {
  checkId(id);
  const files = ctx.get("files");
  const root = files.root;
  const t = await ctx.get("tickets").get(id);
  if (!terminalStages(ctx).has(t.ticket.stage))
    throw new LifecycleError("not-closed", `${id} is in ${t.ticket.stage}; only closed tickets are archived`, { fix: `hl ticket close ${id}` });
  const digest = await findDigest(ctx, t.dir, id);
  if (!digest)
    throw new LifecycleError("digest-missing", `${id} has no closure digest; it is what stays visible after archiving`, {
      fix: `write ${t.dir}/${id}-digest.md (the close skill drafts it), then hl ticket close ${id}`,
    });
  const existing = await findArchived(root, id);
  if (existing) throw new LifecycleError("already-archived", `${id} is already archived in ${existing}`, { fix: `hl ticket restore ${id}` });
  const to = `${ARCHIVE}/${localDate(o.now ?? new Date()).slice(0, 7)}/${id}`;
  const rows = await manifestOf(join(root, t.dir));
  const plan: ArchivePlan = {
    ticket: id,
    title: t.ticket.title,
    from: t.dir,
    to,
    files: rows.length,
    digest: `${to}/${digest.split("/").pop()}`,
    digest_copy: `${SHARED_DIGESTS}/${id}.md`,
    dry_run: o.dryRun,
  };
  if (o.dryRun) return plan;
  await files.writeText(plan.digest_copy, await files.readText(digest));
  await files.writeText(`${t.dir}/${MANIFEST}`, manifestText(rows));
  await moveDir(join(root, t.dir), join(root, to));
  return plan;
}

export interface RestorePlan {
  ticket: string;
  from: string;
  to: string;
  verified: number;
  extra: string[];
  dry_run: boolean;
}

export async function restoreTicket(ctx: Context, id: string, o: { dryRun: boolean }): Promise<RestorePlan> {
  checkId(id);
  const files = ctx.get("files");
  const root = files.root;
  const from = await findArchived(root, id);
  if (!from) throw new LifecycleError("not-archived", `${id} is not in ${ARCHIVE}/`, { fix: "hl search <text> --archived" });
  const to = `artifacts/${id}`;
  if (await files.exists(to)) throw new LifecycleError("restore-conflict", `${to} already exists`, { fix: `move ${to} aside first`, file: to });
  const manifestRel = `${from}/${MANIFEST}`;
  if (!(await files.exists(manifestRel)))
    throw new LifecycleError("manifest-missing", `${manifestRel} is missing; the archive cannot be verified`, { file: manifestRel });
  const want = parseManifest(await files.readText(manifestRel));
  const have = new Map((await manifestOf(join(root, from))).map((r) => [r.path, r.sha256]));
  const bad = want.filter((w) => have.get(w.path) !== w.sha256).map((w) => (have.has(w.path) ? `${w.path} (changed)` : `${w.path} (missing)`));
  if (bad.length)
    throw new LifecycleError("manifest-mismatch", `${from} does not match its manifest: ${bad.join(", ")}`, {
      file: manifestRel,
      fix: "restore the files from git history, or move the folder back by hand",
    });
  const listed = new Set(want.map((w) => w.path));
  const plan: RestorePlan = { ticket: id, from, to, verified: want.length, extra: [...have.keys()].filter((p) => !listed.has(p)), dry_run: o.dryRun };
  if (o.dryRun) return plan;
  await moveDir(join(root, from), join(root, to));
  await files.remove(`${to}/${MANIFEST}`);
  // The shared copy came from the archive step; drop it when it still matches the ticket's own digest.
  const copy = `${SHARED_DIGESTS}/${id}.md`;
  const own = await findDigest(ctx, to, id);
  if (own && (await files.exists(copy)) && (await files.readText(copy)) === (await files.readText(own))) await files.remove(copy);
  return plan;
}

/** ticket.toml of an archived ticket (for titles in the knowledge view). */
export async function archivedTicket(root: string, rel: string): Promise<TicketToml | undefined> {
  try {
    return parse(await readFile(join(root, rel, "ticket.toml"), "utf8")) as unknown as TicketToml;
  } catch {
    return undefined;
  }
}

// ---------- retention (F127) ----------
export interface RetentionItem {
  ticket: string;
  title: string;
  closed: string;
  days: number;
}

export function archiveAfterDays(ctx: Context): number {
  const r = ctx.get("config").workspace.retention ?? {};
  for (const k of ["archive_after_days", "archive_after_closed_days"]) {
    const v = Number(r[k]);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return DEFAULT_ARCHIVE_AFTER_DAYS;
}

/** Closed tickets still in artifacts/ whose close is at least `days` old. A `keep` flag pins a ticket. */
export async function retentionSuggest(ctx: Context, o: { days?: number; today?: Date } = {}): Promise<{ days: number; items: RetentionItem[] }> {
  const days = o.days ?? archiveAfterDays(ctx);
  const today = Date.parse(`${localDate(o.today ?? new Date())}T00:00:00`);
  const terminal = terminalStages(ctx);
  const items: RetentionItem[] = [];
  for (const t of await ctx.get("tickets").list()) {
    if (!terminal.has(t.ticket.stage) || (t.flags as Record<string, unknown>).keep === true) continue;
    const closed = await closedAt(ctx, t);
    const age = Math.floor((today - Date.parse(`${closed}T00:00:00`)) / 86_400_000);
    if (age >= days) items.push({ ticket: t.ticket.id, title: t.ticket.title, closed, days: age });
  }
  return { days, items: items.sort((a, b) => a.closed.localeCompare(b.closed) || a.ticket.localeCompare(b.ticket)) };
}

// Milestone 5: GET /knowledge, GET /knowledge/doc, GET /inbox, POST /inbox/:key, GET /setup (contracts/api.ts).
// The inbox is derived from files on every call; read/archive state is local (.hl-cache/inbox.json, F67) and an
// archived item comes back when it changes after it was archived.
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import type { InboxItem, InboxItemState, KnowledgeDoc, KnowledgeView, Runtime, SetupStatus } from "@helmlock/core";
import { splitFrontmatter } from "@helmlock/plugins/lifecycle/digest.ts";
import { archivedTicket, closedAt, findArchived, findDigest, retentionSuggest, SHARED_DIGESTS, terminalStages } from "@helmlock/plugins/lifecycle/lifecycle.ts";
import { readProjects } from "@helmlock/plugins/notes/notes.ts";
import { collectIndex } from "@helmlock/plugins/notes/shared-index.ts";
import type { Hono, Context as HonoContext } from "hono";
import type { ReadModel } from "./data.ts";
import { STALE_CLAIM_DAYS } from "./data.ts";
import { ApiError } from "./errors.ts";
import { currentPerson, failJson, okJson, writeBody } from "./models.ts";

export interface KnowledgeDeps {
  runtime: Runtime;
  ready: () => Promise<ReadModel>;
  hostOf: (c: HonoContext) => string;
  log: (line: string) => void;
  /** Home folder for the Claude Code trust hint (~/.claude.json); tests point it elsewhere. */
  home?: string;
}

export const INBOX_STATE = ".hl-cache/inbox.json";
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const KEY_RE = /^[a-z-]+:[A-Za-z0-9._:-]{1,160}$/;
const EPOCH = "1970-01-01T00:00:00.000Z";

// ---------- knowledge ----------
export async function knowledgeView(runtime: Runtime): Promise<KnowledgeView> {
  const ctx = runtime.ctx;
  const files = ctx.get("files");
  const tickets = await ctx.get("tickets").list();
  const projects = (await readProjects(ctx)).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    owners: p.owners,
    repos: p.repos,
    goals: p.goals,
    tickets: tickets.filter((t) => t.ticket.project === p.id).length,
  }));
  const digests: KnowledgeView["digests"] = [];
  const terminal = terminalStages(ctx);
  for (const t of tickets) {
    if (!terminal.has(t.ticket.stage)) continue;
    const path = await findDigest(ctx, t.dir, t.ticket.id);
    if (path) digests.push({ ticket: t.ticket.id, title: t.ticket.title, closed: await closedAt(ctx, t), path });
  }
  const seen = new Set(digests.map((d) => d.ticket));
  for (const path of await files.list(`${SHARED_DIGESTS}/*.md`)) {
    const id = (path.split("/").pop() as string).replace(/\.md$/, "");
    if (seen.has(id)) continue;
    const { fm, body } = splitFrontmatter(await files.readText(path));
    let title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? id;
    let closed = fm.closed?.slice(0, 10) ?? "";
    const arch = await findArchived(files.root, id).catch(() => undefined);
    const tt = arch ? await archivedTicket(files.root, arch) : undefined;
    if (tt?.ticket?.title) title = tt.ticket.title;
    if (!closed && tt?.ticket?.updated) closed = String(tt.ticket.updated).slice(0, 10);
    digests.push({ ticket: id, title, closed, path });
  }
  digests.sort((a, b) => b.closed.localeCompare(a.closed) || a.ticket.localeCompare(b.ticket));
  return { index: await collectIndex(ctx), projects, digests };
}

/** Raw markdown of one document inside shared/ or projects/ (never outside, never hidden folders). */
export async function knowledgeDoc(runtime: Runtime, raw: string | undefined): Promise<KnowledgeDoc> {
  const path = (raw ?? "").replace(/\\/g, "/");
  const segs = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    segs.some((s) => s === "" || s === "." || s === ".." || s.startsWith(".")) ||
    (segs[0] !== "shared" && segs[0] !== "projects") ||
    segs.length < 2 ||
    !path.toLowerCase().endsWith(".md")
  )
    throw new ApiError(400, "bad-path", `path must be a .md file inside shared/ or projects/, got ${JSON.stringify(raw ?? "")}`, {
      fix: "use a path from GET /api/v1/knowledge",
    });
  const root = runtime.ctx.get("files").root;
  const abs = join(root, ...segs);
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    throw new ApiError(404, "not-found", `no document ${path}`);
  }
  const base = await realpath(join(root, segs[0] as string)).catch(() => "");
  if (!base || !(real === base || real.startsWith(base + sep))) throw new ApiError(400, "bad-path", `${path} resolves outside ${segs[0]}/`);
  const st = await stat(real);
  if (!st.isFile()) throw new ApiError(404, "not-found", `no document ${path}`);
  if (st.size > MAX_DOC_BYTES) throw new ApiError(413, "too-large", `${path} is ${st.size} bytes; the console shows files up to 2 MB`, { file: path });
  return { path, text: (await readFile(real, "utf8")).replace(/^\uFEFF/, "") };
}

// ---------- setup ----------
async function listMd(dir: string): Promise<string[]> {
  return (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name)
    .sort();
}

async function trusted(home: string, root: string): Promise<boolean> {
  try {
    const cfg = JSON.parse(await readFile(join(home, ".claude.json"), "utf8")) as { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> };
    const want = root.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
    return Object.entries(cfg.projects ?? {}).some(
      ([k, v]) => k.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() === want && v?.hasTrustDialogAccepted === true,
    );
  } catch {
    return false;
  }
}

export async function setupStatus(runtime: Runtime, o: { home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<SetupStatus> {
  const ctx = runtime.ctx;
  const info = runtime.info;
  const env = o.env ?? process.env;
  const steps: SetupStatus["steps"] = [];

  const person = info.author ? await ctx.get("roster").get(info.author) : undefined;
  steps.push({
    id: "author",
    label: "You are in the roster",
    done: Boolean(person),
    detail: person
      ? `${person.name} (${person.id})`
      : info.author
        ? `author.local says ${info.author}, who is not in people.toml`
        : "no author.local on this machine",
    ...(person ? {} : { action: "write your roster id to author.local and add yourself to people.toml (hl doctor)" }),
  });

  let modelDone = false;
  let modelDetail = "the providers plugin is not enabled";
  if (ctx.has("providers")) {
    const p = ctx.get("providers");
    const models = p.models();
    const probed = [];
    for (const pr of p.providers()) if (await ctx.get("files").exists(`.hl-cache/models/${pr.id}.json`)) probed.push(pr.id);
    modelDone = models.length > 0 && probed.length > 0;
    modelDetail = !models.length
      ? "no model configured"
      : probed.length
        ? `${models.length} model(s); probed: ${probed.join(", ")}`
        : `${models.length} model(s) configured, none probed yet`;
  }
  steps.push({
    id: "model",
    label: "A model is configured and tested",
    done: modelDone,
    detail: modelDetail,
    ...(modelDone ? {} : { action: "Settings > Models: add a provider, then Test" }),
  });

  const tg = ctx.get("config").pluginConfig("telegram") as Record<string, unknown>;
  const tokenEnv = typeof tg.token_env === "string" && tg.token_env ? tg.token_env : "HL_TELEGRAM_TOKEN";
  const ids = String(tg.allowed_user_ids ?? "").trim();
  const tgDone = Boolean(env[tokenEnv]) && ids.length > 0;
  steps.push({
    id: "telegram",
    label: "Telegram (optional)",
    done: tgDone,
    detail: tgDone ? `token in ${tokenEnv}; allowed ids set` : `optional: set ${tokenEnv} and the allowed user ids`,
    ...(tgDone ? {} : { action: "Settings > Telegram" }),
  });

  const count = (await ctx.get("tickets").list()).length;
  steps.push({
    id: "first-ticket",
    label: "A first ticket",
    done: count > 0,
    detail: count ? `${count} ticket(s)` : "no tickets yet",
    ...(count ? {} : { action: "create one on the Board (or hl ticket new)" }),
  });

  const sys = await listMd(join(info.deliveryRoot, ".claude", "agents"));
  const have = new Set(await listMd(join(info.root, ".claude", "agents")));
  const missing = sys.filter((n) => !have.has(n));
  const agentsDone = sys.length > 0 && missing.length === 0;
  steps.push({
    id: "agents",
    label: "System agents are in the knowledge repo",
    done: agentsDone,
    detail: !sys.length
      ? "the delivery repo has no agents"
      : missing.length
        ? `missing: ${missing.map((n) => n.replace(/\.md$/, "")).join(", ")}`
        : `${sys.length} agent(s)`,
    ...(agentsDone ? {} : { action: "hl harness sync" }),
  });

  const trust = await trusted(o.home ?? homedir(), info.root);
  steps.push({
    id: "trust",
    label: "Claude Code trusts this folder",
    done: trust,
    detail: trust ? "trust prompt accepted" : "hint: open the knowledge repo once in Claude Code and accept the trust prompt (Cursor runs pass --trust)",
    ...(trust ? {} : { action: "run claude in the knowledge repo once" }),
  });
  return { steps };
}

// ---------- inbox ----------
type InboxState = Record<string, Omit<InboxItemState, "key">>;

async function readState(runtime: Runtime): Promise<InboxState> {
  const files = runtime.ctx.get("files");
  if (!(await files.exists(INBOX_STATE))) return {};
  try {
    const raw = JSON.parse(await files.readText(INBOX_STATE)) as { items?: InboxState };
    return raw.items && typeof raw.items === "object" ? raw.items : {};
  } catch {
    return {};
  }
}

const later = (a: string, b: string | undefined) => b !== undefined && Date.parse(a) > Date.parse(b);

type Derived = Omit<InboxItem, "read" | "archived">;

export async function deriveInbox(runtime: Runtime, model: ReadModel, o: { home?: string; now?: Date } = {}): Promise<Derived[]> {
  const ctx = runtime.ctx;
  const out: Derived[] = [];
  if (ctx.has("approvalQueue"))
    for (const a of ctx.get("approvalQueue").pending())
      out.push({
        key: `approval:${a.id}`,
        kind: "approval",
        title: `Approve ${a.action}${a.tool ? ` (${a.tool})` : ""}`,
        detail: a.detail,
        id: a.id,
        updated: a.created,
      });

  const now = (o.now ?? new Date()).getTime();
  const terminal = terminalStages(ctx);
  for (const t of (await ctx.get("tickets").list()).sort((a, b) => a.ticket.id.localeCompare(b.ticket.id))) {
    const id = t.ticket.id;
    if (t.flags.blocked)
      out.push({
        key: `blocked:${id}`,
        kind: "blocked",
        title: `${id} blocked${t.flags.blocked_by ? `: ${t.flags.blocked_by}` : ""}`,
        ...(t.flags.next_action ? { detail: t.flags.next_action } : {}),
        ticket: id,
        id,
        updated: t.ticket.updated,
      });
    if (terminal.has(t.ticket.stage)) continue;
    for (const q of await ctx.get("records").list(id, "question")) {
      if (q.status !== "open" || !("blocking" in q) || !q.blocking) continue;
      out.push({
        key: `question:${q.id}`,
        kind: "question",
        title: `Answer ${q.id}: ${"text" in q ? q.text : q.id}`,
        detail: `blocks ${id}`,
        ticket: id,
        id: q.id,
        updated: typeof (q as { asked?: unknown }).asked === "string" ? (q as { asked: string }).asked : t.ticket.updated,
      });
    }
    if (t.claim && now - Date.parse(t.claim.claimed_at) > STALE_CLAIM_DAYS * 86_400_000)
      out.push({
        key: `claim-stale:${id}`,
        kind: "claim-stale",
        title: `${id} claimed by ${t.claim.claimed_by} since ${t.claim.claimed_at.slice(0, 10)}`,
        ticket: id,
        id,
        updated: t.claim.claimed_at,
      });
  }

  for (const r of await model.runs())
    if (r.ok === false)
      out.push({
        key: `run-failed:${r.id}`,
        kind: "run-failed",
        title: `Run ${r.id} failed${r.agent ? ` (${r.agent})` : ""}`,
        ...(r.failure_class || r.first_result_line ? { detail: [r.failure_class, r.first_result_line].filter(Boolean).join(": ") } : {}),
        ...(r.ticket ? { ticket: r.ticket } : {}),
        id: r.id,
        updated: r.ended ?? r.started ?? EPOCH,
      });

  const setup = await setupStatus(runtime, o.home ? { home: o.home } : {});
  for (const s of setup.steps)
    if (!s.done && (s.id === "author" || s.id === "model" || s.id === "agents"))
      out.push({ key: `setup:${s.id}`, kind: "setup", title: s.label, detail: s.action ? `${s.detail}; ${s.action}` : s.detail, updated: EPOCH });

  const ret = await retentionSuggest(ctx, o.now ? { today: o.now } : {});
  for (const x of ret.items)
    out.push({
      key: `retention:${x.ticket}`,
      kind: "retention",
      title: `Archive ${x.ticket}? Closed ${x.days} days ago`,
      detail: `${x.title}; hl ticket archive ${x.ticket} --dry-run`,
      ticket: x.ticket,
      id: x.ticket,
      updated: `${x.closed}T00:00:00.000Z`,
    });
  return out;
}

export async function inboxItems(runtime: Runtime, model: ReadModel, o: { home?: string } = {}): Promise<InboxItem[]> {
  const [items, state] = await Promise.all([deriveInbox(runtime, model, o), readState(runtime)]);
  return items
    .map((it) => {
      const s = state[it.key] ?? {};
      return {
        ...it,
        read: s.read_at !== undefined && !later(it.updated, s.read_at),
        archived: s.archived_at !== undefined && !later(it.updated, s.archived_at),
      };
    })
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated) || a.key.localeCompare(b.key));
}

let chain: Promise<unknown> = Promise.resolve();
/** Writes .hl-cache/inbox.json one at a time. */
export function setInboxState(runtime: Runtime, key: string, patch: { read?: boolean; archived?: boolean }, now = new Date()): Promise<InboxItemState> {
  const run = async (): Promise<InboxItemState> => {
    const state = await readState(runtime);
    const cur = { ...(state[key] ?? {}) };
    const ts = now.toISOString();
    if (patch.read === true) cur.read_at = ts;
    else if (patch.read === false) delete cur.read_at;
    if (patch.archived === true) cur.archived_at = ts;
    else if (patch.archived === false) delete cur.archived_at;
    if (cur.read_at === undefined && cur.archived_at === undefined) delete state[key];
    else state[key] = cur;
    await runtime.ctx.get("files").writeText(INBOX_STATE, `${JSON.stringify({ version: 1, items: state }, null, 2)}\n`);
    return { key, ...cur };
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

// ---------- routes ----------
export function registerKnowledgeRoutes(api: Hono, d: KnowledgeDeps): void {
  const get = (path: string, fn: (c: HonoContext) => Promise<unknown>) =>
    api.get(path, async (c) => {
      try {
        await d.ready();
        return okJson(c, await fn(c));
      } catch (e) {
        return failJson(c, e, d.log);
      }
    });
  get("/knowledge", () => knowledgeView(d.runtime));
  get("/knowledge/doc", (c) => knowledgeDoc(d.runtime, c.req.query("path")));
  get("/inbox", async () => inboxItems(d.runtime, await d.ready(), d.home ? { home: d.home } : {}));
  get("/setup", () => setupStatus(d.runtime, d.home ? { home: d.home } : {}));

  api.post("/inbox/:key", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      const key = decodeURIComponent(c.req.param("key") ?? "");
      if (!KEY_RE.test(key)) throw new ApiError(400, "bad-request", `not an inbox key: ${JSON.stringify(key)}`, { fix: "use a key from GET /api/v1/inbox" });
      const extra = Object.keys(body).filter((k) => k !== "read" && k !== "archived");
      if (extra.length) throw new ApiError(400, "bad-request", `unknown body key(s): ${extra.join(", ")}`);
      for (const k of ["read", "archived"] as const)
        if (body[k] !== undefined && typeof body[k] !== "boolean") throw new ApiError(400, "bad-request", `${k} must be true or false`);
      if (body.read === undefined && body.archived === undefined) throw new ApiError(400, "bad-request", "body needs { read?: boolean, archived?: boolean }");
      await d.ready();
      await currentPerson(d.runtime);
      const patch: { read?: boolean; archived?: boolean } = {};
      if (typeof body.read === "boolean") patch.read = body.read;
      if (typeof body.archived === "boolean") patch.archived = body.archived;
      return okJson(c, await setInboxState(d.runtime, key, patch));
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
}

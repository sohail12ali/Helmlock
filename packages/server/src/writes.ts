// Milestone 3: console writes. A write is a verb call through the SAME registry path as the CLI (F13a):
// runtime.run() -> guards, hooks, the verb, activity line, page refresh. No second write path.
// The request checks follow control-center console/server/verbs_feature.py (POST only, an allow-list, a gate check
// before the run) plus the usual browser CSRF defences: JSON only, a custom header, a same-origin Origin.
import {
  CONSOLE_VERBS,
  type ConsoleVerb,
  describeInput,
  type Runtime,
  type SettingsView,
  type TodoItem,
  type VerbCall,
  type VerbCallResult,
  type VerbField,
  type VerbInfo,
  type VerbResult,
  WRITE_HEADER,
} from "@helmlock/core";
import { buildSettingsView } from "@helmlock/plugins/settings/settings.ts";
import { ApiError } from "./errors.ts";

const ALLOWED = new Set<string>(CONSOLE_VERBS);

export const isConsoleVerb = (id: string): id is ConsoleVerb => ALLOWED.has(id);

/** "/api/v1/verbs/ticket/move" -> "ticket move". Undefined when a segment cannot be decoded or is empty. */
export function verbIdFromPath(path: string): string | undefined {
  const at = path.indexOf("/verbs/");
  if (at < 0) return undefined;
  const parts = path.slice(at + "/verbs/".length).split("/");
  try {
    const ids = parts.map((p) => decodeURIComponent(p));
    if (ids.some((p) => !p || /[\s/\\]/.test(p))) return undefined;
    return ids.join(" ");
  } catch {
    return undefined;
  }
}

/**
 * Refuse anything a cross-site page or a non-console client could send. Order: method, content type,
 * custom header, Origin (when present it must be this server's own origin). The Host check runs before (app.ts).
 */
export function checkWriteRequest(req: { method: string; header(name: string): string | undefined }, host: string): void {
  if (req.method !== "POST") throw new ApiError(405, "method-not-allowed", "verb calls are POST", { fix: "POST /api/v1/verbs/<noun>/<verb>" });
  const ct = (req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (ct !== "application/json")
    throw new ApiError(415, "bad-content-type", `verb calls need Content-Type: application/json, got ${JSON.stringify(ct ?? "")}`, {
      fix: "send the body as JSON",
    });
  if (req.header(WRITE_HEADER) !== "1")
    throw new ApiError(403, "write-header-missing", `verb calls need the header ${WRITE_HEADER}: 1`, { fix: "call verbs from the console (callVerb)" });
  const origin = req.header("origin");
  if (origin !== undefined && origin.toLowerCase() !== `http://${host.toLowerCase()}`)
    throw new ApiError(403, "bad-origin", `origin ${JSON.stringify(origin)} may not call verbs`, { fix: "open the console at its own address" });
}

/** Parse a VerbCall body. */
export function parseVerbCall(body: unknown): VerbCall {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ApiError(400, "bad-request", "body must be a JSON object { input, dry_run? }");
  const b = body as Record<string, unknown>;
  const input = b.input ?? {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new ApiError(400, "bad-request", "input must be an object");
  if (b.dry_run !== undefined && typeof b.dry_run !== "boolean") throw new ApiError(400, "bad-request", "dry_run must be true or false");
  const extra = Object.keys(b).filter((k) => k !== "input" && k !== "dry_run");
  if (extra.length) throw new ApiError(400, "bad-request", `unknown body key${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}`);
  return { input: input as Record<string, unknown>, ...(b.dry_run !== undefined ? { dry_run: b.dry_run as boolean } : {}) };
}

/** HTTP status for a verb result: 200 ok; 409 for code 2 and stale writes; 400 bad input; 403 unknown author; else 422. */
export function toVerbResponse(res: VerbResult): { status: number; body: VerbCallResult } {
  if (res.ok) return { status: 200, body: res.text === undefined ? { ok: true, data: res.data } : { ok: true, data: res.data, text: res.text } };
  const error = { ...res.error };
  let status = res.code === 2 ? 409 : 422;
  if (error.rule === "bad-input") status = 400;
  else if (error.rule === "unknown-author") status = 403;
  else if (error.rule === "stale-write") {
    status = 409;
    error.fix = "reload and retry";
  }
  const body: VerbCallResult = { ok: false, code: res.code, error };
  if (res.data !== undefined) body.data = res.data;
  return { status, body };
}

/** One write at a time in this process; the file layer's stale-write check covers other processes. */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => {});
    return next;
  };
}

/** GET /api/v1/verbs: the console verbs that are registered (their plugins mounted), with fields for forms. */
export function verbCatalog(runtime: Runtime): VerbInfo[] {
  const verbs = runtime.ctx.get("verbs");
  const out: VerbInfo[] = [];
  for (const id of CONSOLE_VERBS) {
    const def = verbs.get(id);
    if (!def) continue;
    out.push({
      id,
      summary: def.summary,
      examples: [...def.examples],
      writes: def.writes,
      args: (def.args ?? []).map((a) => a.replace(/^\.\.\./, "")),
      fields: describeInput(def.input).map((f): VerbField => {
        const { of, ...rest } = f;
        return of === undefined ? rest : { ...rest, of: of === "array" ? "unknown" : of };
      }),
    });
  }
  return out;
}

/** GET /api/v1/todos?status=&ticket=&scope=team|personal|private&all=1 (all = other people's personal lists too). */
export async function todoList(
  runtime: Runtime,
  status: string | undefined,
  ticket: string | undefined,
  more: { scope?: string | undefined; all?: string | undefined } = {},
): Promise<TodoItem[]> {
  if (status !== undefined && status !== "open" && status !== "done")
    throw new ApiError(400, "bad-request", `status must be open or done, got ${JSON.stringify(status)}`);
  const { scope, all } = more;
  if (scope !== undefined && scope !== "team" && scope !== "personal" && scope !== "private")
    throw new ApiError(400, "bad-request", `scope must be team, personal or private, got ${JSON.stringify(scope)}`);
  const filter: { status?: "open" | "done"; ticket?: string; scope?: "team" | "personal" | "private"; mine?: boolean } = {};
  if (status) filter.status = status;
  if (ticket) filter.ticket = ticket;
  if (scope) filter.scope = scope;
  if (all === "1" || all === "true") filter.mine = false;
  const rows = await runtime.ctx.get("todos").list(filter);
  return rows.map((t) => {
    const item: TodoItem = {
      id: t.id,
      text: t.text,
      status: t.status,
      priority: t.priority,
      created: t.created,
      author: t.author,
      scope: t.scope ?? "personal",
    };
    if (t.due) item.due = t.due;
    if (t.ticket) item.ticket = t.ticket;
    return item;
  });
}

/** GET /api/v1/settings: re-reads workspace.toml and workspace.local.toml on every call (config reload, F107). */
export async function settingsView(runtime: Runtime): Promise<SettingsView> {
  const files = runtime.ctx.get("files");
  const read = async (rel: string) => ((await files.exists(rel)) ? (await files.readTomlRaw(rel)).data : undefined);
  return buildSettingsView({ manifests: runtime.manifests, workspace: await read("workspace.toml"), local: await read("workspace.local.toml") });
}

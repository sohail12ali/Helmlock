// The read-only console API (milestone 2): every route of contracts/api.ts under /api/v1, plus SSE and the built UI.
// Route layout and the { ok, data } | { ok: false, error } envelope follow Paperclip server/src/app.ts and the hl CLI;
// localhost-only binding and the Host check follow control-center console/server/httpd.py.
// Milestone 3: POST /api/v1/verbs/<noun>/<verb> runs a console verb through the same registry as the CLI (writes.ts).
import type { ApiResponse, Runtime, TicketFilter } from "@helmlock/core";
import { Hono, type Context as HonoContext } from "hono";
import { registerApprovalRoutes } from "./approvals.ts";
import { mountChatRoutes } from "./chats.ts";
import { createReadModel, helmlockVersion, localDate, type ReadModel } from "./data.ts";
import { ApiError, toErrorBody } from "./errors.ts";
import { type ChangeHub, createChangeHub, sseStream } from "./events.ts";
import { registerKnowledgeRoutes } from "./knowledge.ts";
import { mountModelRoutes } from "./models.ts";
import { overridesRoute } from "./overrides.ts";
import { newHookToken, registerRunRoutes } from "./runs.ts";
import { DEFAULT_UI_DIR, serveUi } from "./static.ts";
import {
  checkWriteRequest,
  createWriteQueue,
  isConsoleVerb,
  parseVerbCall,
  settingsView,
  todoList,
  toVerbResponse,
  verbCatalog,
  verbIdFromPath,
} from "./writes.ts";

export interface AppOptions {
  /** The port the server listens on, for the Host check. Undefined accepts any port on a loopback name. */
  port?: () => number | undefined;
  /** Change source for /api/v1/events. Default: a watcher on the workspace root, created on first use. */
  hub?: ChangeHub;
  /** Built UI folder. Default packages/ui/dist. */
  uiDir?: string;
  /** Heartbeat interval for SSE (tests shorten it). */
  heartbeatMs?: number;
  log?: (line: string) => void;
  /** Secret for POST /api/v1/hooks/pretooluse (milestone 4); default a fresh random one per server. */
  hookToken?: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Host header must name this machine on our port: blocks DNS rebinding from other sites. */
export function hostAllowed(host: string | undefined, port: number | undefined): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim().toLowerCase());
  if (!m || !LOOPBACK.has(m[1] as string)) return false;
  if (port === undefined) return true;
  return Number(m[2] ?? 80) === port;
}

function ok<T>(c: HonoContext, data: T): Response {
  const body: ApiResponse<T> = { ok: true, data };
  return c.json(body);
}

function fail(c: HonoContext, e: unknown, log?: (l: string) => void): Response {
  const { status, error } = toErrorBody(e);
  if (status >= 500) log?.(`${c.req.method} ${c.req.path}: ${(e as Error)?.stack ?? String(e)}`);
  return c.json({ ok: false, error } satisfies ApiResponse<never>, status as 400);
}

function dateParam(c: HonoContext, name: string, fallback: string): string {
  const v = c.req.query(name);
  if (v === undefined || v === "") return fallback;
  if (!DATE_RE.test(v)) throw new ApiError(400, "bad-request", `${name} must be YYYY-MM-DD, got ${JSON.stringify(v)}`);
  return v;
}

function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - n);
  return localDate(d);
}

export function createApp(runtime: Runtime, opts: AppOptions = {}): Hono {
  const log = opts.log ?? ((l: string) => process.stderr.write(`hl serve: ${l}\n`));
  const uiDir = opts.uiDir ?? DEFAULT_UI_DIR;
  let hub = opts.hub;
  const hubOf = (): ChangeHub => {
    if (!hub) {
      const h = createChangeHub(runtime.info.root, { log });
      hub = h;
      void runtime.ctx.effect(() => () => h.close());
    }
    return hub;
  };

  // Mount every plugin once; requests share the mounted services (F109: never re-mount per request).
  let ready: Promise<ReadModel> | undefined;
  const model = (): Promise<ReadModel> => {
    if (!ready) {
      ready = (async () => {
        if (runtime.configError) throw runtime.configError;
        await runtime.mountAll();
        // Milestone 4: a console is attached, so approvals ask a person through the queue instead of denying.
        if (runtime.ctx.has("approvalQueue")) (runtime.ctx.get("approvalQueue") as { enableRemote?: () => void }).enableRemote?.();
        return createReadModel(runtime.ctx, await helmlockVersion(runtime.info.deliveryRoot));
      })();
      ready.catch(() => {
        ready = undefined; // retried on the next request
      });
    }
    return ready;
  };

  const app = new Hono();
  const serial = createWriteQueue();
  const hostOf = (c: HonoContext) => c.req.header("host") ?? new URL(c.req.url).host;

  app.use("*", async (c, next) => {
    const host = hostOf(c);
    if (!hostAllowed(host, opts.port?.())) {
      c.header("X-Content-Type-Options", "nosniff");
      return c.json(
        {
          ok: false,
          error: { rule: "bad-host", message: `host ${JSON.stringify(host)} is not allowed`, fix: "open the console at http://127.0.0.1:<port>/" },
        } satisfies ApiResponse<never>,
        403,
      );
    }
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
  });

  const api = new Hono();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const isVerbCall =
      c.req.method === "POST" &&
      (/^\/api\/v1\/(?:verbs\/|runs$|runs\/[^/]+\/cancel$|approvals\/[^/]+$|inbox\/[^/]+$|hooks\/pretooluse$)/.test(c.req.path) ||
        /^\/api\/v1\/(chats|models)(\/|$)/.test(c.req.path));
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && !isVerbCall)
      return c.json(
        {
          ok: false,
          error: { rule: "read-only", message: `${c.req.method} ${c.req.path} is not allowed`, fix: "change files with POST /api/v1/verbs/<noun>/<verb>" },
        } satisfies ApiResponse<never>,
        405,
      );
    await next();
  });

  const route = (path: string, fn: (m: ReadModel, c: HonoContext) => Promise<unknown>) =>
    api.get(path, async (c) => {
      try {
        return ok(c, await fn(await model(), c));
      } catch (e) {
        return fail(c, e, log);
      }
    });

  route("/workspace", (m) => m.workspace());
  route("/board", (m) => m.board());
  route("/overview", (m, c) => m.overview(dateParam(c, "date", localDate())));
  route("/tickets", (m, c) => {
    const f: TicketFilter = {};
    for (const k of ["stage", "project", "owner"] as const) {
      const v = c.req.query(k);
      if (v) f[k] = v;
    }
    const b = c.req.query("blocked");
    if (b === "true" || b === "1") f.blocked = true;
    else if (b === "false" || b === "0") f.blocked = false;
    else if (b) throw new ApiError(400, "bad-request", `blocked must be true or false, got ${JSON.stringify(b)}`);
    return m.tickets(f);
  });
  route("/tickets/:id", (m, c) => m.ticket(c.req.param("id") ?? ""));
  route("/tickets/:id/artifacts/:artifactId", (m, c) => m.artifact(c.req.param("id") ?? "", c.req.param("artifactId") ?? ""));
  route("/activity", (m, c) => m.activity(dateParam(c, "date", localDate()), c.req.query("author") || undefined));
  route("/worklog", (m, c) => {
    const to = dateParam(c, "to", localDate());
    const from = dateParam(c, "from", daysBefore(to, 6));
    if (from > to) throw new ApiError(400, "bad-request", `from ${from} is after to ${to}`);
    return m.worklog(from, to, c.req.query("author") || undefined);
  });
  const m4 = {
    runtime,
    ready: model,
    log,
    hostOf,
    hookToken: opts.hookToken ?? newHookToken(),
    ...(opts.port ? { port: opts.port } : {}),
    ...(opts.heartbeatMs ? { heartbeatMs: opts.heartbeatMs } : {}),
  };
  registerRunRoutes(api, m4);
  registerApprovalRoutes(api, m4);
  route("/skills", (m) => m.skills());
  route("/search", (m, c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) throw new ApiError(400, "bad-request", "search needs ?q=<text>");
    return m.search(q);
  });

  route("/verbs", async () => verbCatalog(runtime));
  route("/todos", async (_m, c) => todoList(runtime, c.req.query("status") || undefined, c.req.query("ticket") || undefined));
  route("/settings", async () => settingsView(runtime));
  route("/overrides", () => overridesRoute(runtime));

  // Milestone 4: models and the assistant (each POST runs the same write checks as verb calls).
  mountModelRoutes(api, m4);
  mountChatRoutes(api, m4);
  // Milestone 5: knowledge, inbox state and the first-run checklist.
  registerKnowledgeRoutes(api, m4);

  api.post("/verbs/*", async (c) => {
    try {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, hostOf(c));
      const id = verbIdFromPath(c.req.path);
      if (!id || !isConsoleVerb(id))
        throw new ApiError(403, "verb-not-allowed", `${id ? `"${id}"` : c.req.path} cannot be called from the console`, {
          fix: "run it with `hl` in a terminal; the console verbs are listed at GET /api/v1/verbs",
        });
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw new ApiError(400, "bad-request", "body is not valid JSON");
      }
      const call = parseVerbCall(raw);
      await model();
      const info = runtime.info;
      const person = info.author ? await runtime.ctx.get("roster").get(info.author) : undefined;
      if (!person)
        throw new ApiError(403, "unknown-author", info.author ? `author ${info.author} is not in people.toml` : "no author is set on this machine", {
          fix: "write your roster id to author.local and add yourself to people.toml (see `hl doctor`)",
        });
      const res = await serial(() =>
        runtime.run(id, call.input, {
          dryRun: call.dry_run ?? false,
          json: true,
          interactive: false,
          actor: { kind: "person", id: person.id, onBehalfOf: person.id },
        }),
      );
      const { status, body } = toVerbResponse(res);
      return c.json(body, status as 200);
    } catch (e) {
      return fail(c, e, log);
    }
  });

  api.get("/events", (c) => {
    const h = hubOf();
    return new Response(sseStream(h, c.req.raw.signal, opts.heartbeatMs), {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  api.all("*", (c) => fail(c, new ApiError(404, "not-found", `no route ${c.req.method} ${c.req.path}`, { fix: "see packages/core/src/contracts/api.ts" })));

  app.route("/api/v1", api);
  app.all("/api/*", (c) => fail(c, new ApiError(404, "not-found", `no route ${c.req.path}; the API lives under /api/v1`)));

  app.get("*", (c) => serveUi(uiDir, c.req.path));

  app.onError((e, c) => fail(c, e, log));
  return app;
}

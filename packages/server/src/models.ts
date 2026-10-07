// Milestone 4: GET /api/v1/models (ModelsView) and POST /api/v1/models/test { provider } (ModelProbe, F73).
// The probe saves what it learned to .hl-cache/models/<provider>.json (local); configured capabilities always win.
import type { ApiResponse, ModelProbe, ModelsView, Person, ProvidersService, Runtime } from "@helmlock/core";
import type { Hono, Context as HonoContext } from "hono";
import { ApiError, toErrorBody } from "./errors.ts";
import { checkWriteRequest } from "./writes.ts";

export interface M4RouteDeps {
  runtime: Runtime;
  /** Resolves once every plugin is mounted (app.ts model()). */
  ready: () => Promise<unknown>;
  hostOf: (c: HonoContext) => string;
  log: (line: string) => void;
  heartbeatMs?: number;
}

export function okJson<T>(c: HonoContext, data: T, status = 200): Response {
  return c.json({ ok: true, data } satisfies ApiResponse<T>, status as 200);
}

/** Rules from the providers and assistant plugins that are the caller's fault. */
const LOCAL_STATUS: Record<string, number> = { "unknown-model": 400 };

export function failJson(c: HonoContext, e: unknown, log?: (l: string) => void): Response {
  const body = toErrorBody(e);
  const status = LOCAL_STATUS[body.error.rule] ?? body.status;
  const { error } = body;
  if (status >= 500) log?.(`${c.req.method} ${c.req.path}: ${(e as Error)?.stack ?? String(e)}`);
  return c.json({ ok: false, error } satisfies ApiResponse<never>, status as 400);
}

/** The same request checks as verb calls (JSON, write header, same origin), then a JSON object body. */
export async function writeBody(c: HonoContext, hostOf: (c: HonoContext) => string): Promise<Record<string, unknown>> {
  checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, hostOf(c));
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "bad-request", "body is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiError(400, "bad-request", "body must be a JSON object");
  return raw as Record<string, unknown>;
}

/** The person at this keyboard, from author.local and the roster (never guessed). */
export async function currentPerson(runtime: Runtime): Promise<Person> {
  const info = runtime.info;
  const person = info.author ? await runtime.ctx.get("roster").get(info.author) : undefined;
  if (!person)
    throw new ApiError(403, "unknown-author", info.author ? `author ${info.author} is not in people.toml` : "no author is set on this machine", {
      fix: "write your roster id to author.local and add yourself to people.toml (see `hl doctor`)",
    });
  return person;
}

export function service<K extends "providers" | "assistant">(runtime: Runtime, key: K) {
  if (!runtime.ctx.has(key))
    throw new ApiError(503, "plugin-missing", `the ${key} plugin is not enabled in this workspace`, {
      fix: `add a [[plugin]] row with id = "${key}" (it is in the delivery-lite bundle) and restart hl serve`,
    });
  return runtime.ctx.get(key);
}

export function mountModelRoutes(api: Hono, d: M4RouteDeps): void {
  api.get("/models", async (c) => {
    try {
      await d.ready();
      const p: ProvidersService = service(d.runtime, "providers");
      const def = p.defaultModel();
      const view: ModelsView = { providers: p.providers(), models: p.models(), ...(def ? { default: def } : {}) };
      return okJson(c, view);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  api.post("/models/test", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      if (typeof body.provider !== "string" || !body.provider) throw new ApiError(400, "bad-request", "body needs { provider: <provider id> }");
      await d.ready();
      const r: ModelProbe = await service(d.runtime, "providers").probe(body.provider);
      return okJson(c, r);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });
}

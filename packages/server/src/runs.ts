// Milestone 4: agent runs from the console (api.ts "Milestone 4"). POST /runs, GET /runs/:id, GET /runs/:id/events
// (SSE: replay from ?from or Last-Event-ID, then live, then "end"), POST /runs/:id/cancel, and GET /runs merging the
// active runs into the run records. Writes carry the same protection as verb calls (checkWriteRequest).
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiResponse, Person, RunDetail, RunDiff, RunEventLine, RunMergeResult, RunSayResult, RunState, RunSummary, Runtime } from "@helmlock/core";
import { readRecord, recordToState } from "@helmlock/plugins/runtimes/run-record.ts";
import { HOOK_TOKEN_HEADER } from "@helmlock/plugins/runtimes/run-report.ts";
import type { Hono, Context as HonoContext } from "hono";
import { z } from "zod";
import type { ReadModel } from "./data.ts";
import { ApiError, toErrorBody } from "./errors.ts";
import { HEARTBEAT_MS } from "./events.ts";
import { projectCwd } from "./projects.ts";
import { checkWriteRequest } from "./writes.ts";

export interface M4Deps {
  runtime: Runtime;
  /** Mounts the plugins once (the app's read model). */
  ready: () => Promise<ReadModel>;
  log: (line: string) => void;
  hostOf: (c: HonoContext) => string;
  port?: () => number | undefined;
  /** Per-server secret for the PreToolUse hook of server-started runs (HL_HOOK_TOKEN). */
  hookToken: string;
  heartbeatMs?: number;
}

export const newHookToken = () => randomBytes(32).toString("hex");

/** Status codes for the rules the run manager and the approval queue throw. */
const STATUS: Record<string, number> = {
  "run-active": 409,
  "mode-not-allowed": 403,
  "bad-mode": 400,
  "bad-request": 400,
  "unknown-run": 404,
  "unknown-runtime": 422,
  "runtime-missing": 422,
  "unknown-approval": 404,
  "already-decided": 409,
  "local-only": 403,
  // milestone 8
  "no-worktree": 409,
  "run-cancelled": 409,
  "worktree-blocked": 409,
  "git-failed": 502,
};

export function failM4(c: HonoContext, e: unknown, log: (l: string) => void): Response {
  const rule = (e as { rule?: unknown })?.rule;
  const mapped = !(e instanceof ApiError) && typeof rule === "string" ? STATUS[rule] : undefined;
  const { status, error } = toErrorBody(mapped ? new ApiError(mapped, rule as string, (e as Error).message, { fix: (e as { fix?: string }).fix ?? "" }) : e);
  if (!error.fix) delete error.fix;
  if (status >= 500) log(`${c.req.method} ${c.req.path}: ${(e as Error)?.stack ?? String(e)}`);
  return c.json({ ok: false, error } satisfies ApiResponse<never>, status as 400);
}

/** The person at this machine; console writes act as them (F98). */
export async function currentPerson(runtime: Runtime): Promise<Person> {
  const info = runtime.info;
  const person = info.author ? await runtime.ctx.get("roster").get(info.author) : undefined;
  if (!person)
    throw new ApiError(403, "unknown-author", info.author ? `author ${info.author} is not in people.toml` : "no author is set on this machine", {
      fix: "write your roster id to author.local and add yourself to people.toml (see `hl doctor`)",
    });
  return person;
}

export async function jsonBody(c: HonoContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "bad-request", "body is not valid JSON");
  }
}

const RunStartBody = z
  .object({
    task: z.string().trim().min(1, "say what to do"),
    // Milestone 8: any registered engine id (claude-code, cursor, loop, ...); an unknown one is a 422 from the manager.
    runtime: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "an engine id")
      .optional(),
    agent: z.string().min(1).optional(),
    ticket: z.string().min(1).optional(),
    mode: z.string().optional(),
    model: z.string().min(1).optional(),
    project: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "a project id")
      .optional(),
  })
  .strict();

export function summaryOf(s: RunState): RunSummary {
  const r: RunSummary = { id: s.id, runtime: s.runtime, mode: s.mode, started: s.started };
  if (s.ticket) r.ticket = s.ticket;
  if (s.agent) r.agent = s.agent;
  if (s.ended) r.ended = s.ended;
  if (s.status !== "running") r.ok = s.status === "done";
  if (s.failure_class) r.failure_class = s.failure_class;
  if (s.first_result_line) r.first_result_line = s.first_result_line;
  if (s.usage) r.usage = s.usage;
  return r;
}

/** A finished run's record as a RunState (GET /runs/:id after the server restarted). */
async function stateFromRecord(runtime: Runtime, id: string): Promise<RunState | undefined> {
  const raw = await readRecord(runtime.ctx.get("files"), id);
  return raw ? recordToState(raw, id) : undefined;
}

/** GET /runs rows: the RunState plus RunSummary's `ok`, so the milestone 4 views keep working. */
export function listRow(s: RunState): RunState & { ok?: boolean } {
  return s.status === "running" || s.status === "queued" ? s : { ...s, ok: s.status === "done" };
}

const ROLE = /^[a-z][a-z0-9-]*$/;
const SayBody = z.object({ text: z.string().trim().min(1, "say something").max(8000) }).strict();
const ResetBody = z.object({ role: z.string().regex(ROLE, "a role id"), ticket: z.string().min(1) }).strict();
const ReportBody = z
  .object({
    run_id: z.string().min(1),
    by: z.string().optional(),
    outcome: z.enum(["done", "review", "blocked", "needs-input"]),
    summary: z.string().trim().min(1).max(2000),
    next: z.string().trim().min(1).max(500).optional(),
    next_role: z.string().regex(ROLE).optional(),
  })
  .strict();

function tokenMatches(given: string | undefined, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function badBody(issues: readonly { path: readonly PropertyKey[]; message: string }[]): ApiError {
  return new ApiError(400, "bad-request", issues.map((i) => `${i.path.map(String).join(".") || "body"}: ${i.message}`).join("; "));
}

function sseHeaders(): Record<string, string> {
  return { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" };
}

/** "event" frames (id = seq) from the iterator, then "end" with the final RunDetail. */
export function runEventStream(
  lines: AsyncIterable<RunEventLine>,
  final: () => RunState | undefined,
  signal: AbortSignal | undefined,
  heartbeatMs = HEARTBEAT_MS,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let stop = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          stop();
        }
      };
      const beat = setInterval(() => send(": ping\n\n"), heartbeatMs);
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        signal?.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          /* closed by the client */
        }
      };
      signal?.addEventListener("abort", stop);
      send("retry: 2000\n\n");
      void (async () => {
        try {
          for await (const l of lines) {
            if (closed) return;
            send(`id: ${l.seq}\nevent: event\ndata: ${JSON.stringify(l)}\n\n`);
          }
          send(`event: end\ndata: ${JSON.stringify(final() ?? null)}\n\n`);
        } finally {
          stop();
        }
      })();
    },
    cancel() {
      stop();
    },
  });
}

export function registerRunRoutes(api: Hono, d: M4Deps): void {
  const { runtime, log } = d;
  const manager = () => runtime.ctx.get("runManager");
  const handle = (fn: (c: HonoContext) => Promise<Response>) => async (c: HonoContext) => {
    try {
      await d.ready();
      return await fn(c);
    } catch (e) {
      return failM4(c, e, log);
    }
  };

  // Milestone 8: RunState[] (live, queued and recorded runs) with ?ticket=&role=&limit=; each row also carries `ok`.
  api.get(
    "/runs",
    handle(async (c) => {
      const limitQ = c.req.query("limit");
      if (limitQ !== undefined && limitQ !== "" && !/^\d+$/.test(limitQ))
        throw new ApiError(400, "bad-request", `limit must be a number, got ${JSON.stringify(limitQ)}`);
      const ticket = c.req.query("ticket") || undefined;
      const role = c.req.query("role") || undefined;
      const list = await manager().list({
        ...(ticket ? { ticket } : {}),
        ...(role ? { role } : {}),
        ...(limitQ ? { limit: Number(limitQ) } : {}),
      });
      return c.json({ ok: true, data: list.map(listRow) } satisfies ApiResponse<RunState[]>);
    }),
  );

  api.post(
    "/runs/:id/say",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const parsed = SayBody.safeParse(await jsonBody(c));
      if (!parsed.success) throw badBody(parsed.error.issues);
      const person = await currentPerson(runtime);
      const delivered = await manager().say(c.req.param("id") ?? "", parsed.data.text, person.id);
      return c.json({ ok: true, data: { delivered } } satisfies ApiResponse<RunSayResult>);
    }),
  );

  api.get(
    "/runs/:id/diff",
    handle(async (c) => {
      const data = await manager().diff(c.req.param("id") ?? "");
      return c.json({ ok: true, data } satisfies ApiResponse<RunDiff>);
    }),
  );

  api.post(
    "/runs/:id/merge",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const person = await currentPerson(runtime);
      const data = await manager().merge(c.req.param("id") ?? "", person.id);
      return c.json({ ok: true, data } satisfies ApiResponse<RunMergeResult>, data.merged ? 200 : 409);
    }),
  );

  api.post(
    "/sessions/reset",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const parsed = ResetBody.safeParse(await jsonBody(c));
      if (!parsed.success) throw badBody(parsed.error.issues);
      await currentPerson(runtime);
      await manager().resetSession(parsed.data.role, parsed.data.ticket);
      return c.body(null, 204);
    }),
  );

  // Internal: `hl run report` from inside a server-started run (HL_SERVER_URL, HL_HOOK_TOKEN). The token comes first.
  api.post("/hooks/run-report", async (c) => {
    if (!tokenMatches(c.req.header(HOOK_TOKEN_HEADER), d.hookToken))
      return c.json({ ok: false, error: { rule: "hook-token", message: "missing or wrong hook token" } } satisfies ApiResponse<never>, 403);
    try {
      await d.ready();
      const ct = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (ct !== "application/json") throw new ApiError(415, "bad-content-type", "hook calls are JSON");
      const parsed = ReportBody.safeParse(await jsonBody(c));
      if (!parsed.success) throw badBody(parsed.error.issues);
      const { run_id, by, ...rest } = parsed.data;
      const m = manager();
      const live = m.get(run_id);
      if (!live) throw new ApiError(404, "unknown-run", `run ${run_id} is not in this console`);
      const outcome = {
        outcome: rest.outcome,
        summary: rest.summary,
        ...(rest.next ? { next: rest.next } : {}),
        ...(rest.next_role ? { next_role: rest.next_role } : {}),
      };
      // The verb writes its own activity line; the manager adds the outcome event and the ticket comment.
      const report = m.report as (id: string, o: typeof outcome, by: string, opts?: { activity?: boolean }) => Promise<RunState>;
      const data = await report.call(m, run_id, outcome, by ?? live.role ?? live.runtime, { activity: false });
      return c.json({ ok: true, data } satisfies ApiResponse<RunDetail>);
    } catch (e) {
      return failM4(c, e, log);
    }
  });

  api.post(
    "/runs",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const parsed = RunStartBody.safeParse(await jsonBody(c));
      if (!parsed.success) throw new ApiError(400, "bad-request", parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
      const b = parsed.data;
      if (b.mode === "force") throw new ApiError(403, "mode-not-allowed", 'mode "force" stays in the terminal', { fix: "hl run --mode force" });
      if (b.mode !== undefined && !["plan", "ask", "auto-review"].includes(b.mode))
        throw new ApiError(400, "bad-request", `mode must be plan, ask or auto-review, got ${JSON.stringify(b.mode)}`);
      const person = await currentPerson(runtime);
      if (b.ticket) await runtime.ctx.get("tickets").get(b.ticket); // unknown-ticket -> 404
      // Milestone 7: the active project's repo folder (a folder of this workspace file only) is the run's cwd.
      const cwd = b.project ? await projectCwd(runtime, b.project) : undefined;
      const port = d.port?.();
      const serverUrl = port ? `http://127.0.0.1:${port}` : `http://${d.hostOf(c)}`;
      const state = await manager().start({
        prompt: b.task,
        origin: "console",
        actor: { kind: "person", id: person.id, onBehalfOf: person.id },
        env: { HL_SERVER_URL: serverUrl, HL_HOOK_TOKEN: d.hookToken },
        ...(b.runtime ? { runtime: b.runtime } : {}),
        ...(b.agent ? { agent: b.agent } : {}),
        ...(b.ticket ? { ticket: b.ticket } : {}),
        ...(b.mode ? { mode: b.mode as RunState["mode"] } : {}),
        ...(b.model ? { model: b.model } : {}),
        ...(cwd ? { cwd } : {}),
      });
      return c.json({ ok: true, data: state } satisfies ApiResponse<RunDetail>, 201);
    }),
  );

  api.get(
    "/runs/:id",
    handle(async (c) => {
      const id = c.req.param("id") ?? "";
      const s = manager().get(id) ?? (await stateFromRecord(runtime, id));
      if (!s) throw new ApiError(404, "unknown-run", `no run ${id}`);
      return c.json({ ok: true, data: s } satisfies ApiResponse<RunDetail>);
    }),
  );

  api.get(
    "/runs/:id/events",
    handle(async (c) => {
      const id = c.req.param("id") ?? "";
      const fromQ = c.req.query("from");
      const lastId = c.req.header("last-event-id");
      let from = 0;
      if (fromQ !== undefined && fromQ !== "") {
        if (!/^\d+$/.test(fromQ)) throw new ApiError(400, "bad-request", `from must be a sequence number, got ${JSON.stringify(fromQ)}`);
        from = Number(fromQ);
      } else if (lastId && /^\d+$/.test(lastId)) from = Number(lastId) + 1;
      const m = manager();
      let lines: AsyncIterable<RunEventLine>;
      if (m.get(id)) lines = m.events(id, from);
      else {
        // A finished run from an earlier server: no events kept, only the end frame.
        const s = await stateFromRecord(runtime, id);
        if (!s) throw new ApiError(404, "unknown-run", `no run ${id}`);
        lines = (async function* () {})();
        return new Response(
          runEventStream(lines, () => s, c.req.raw.signal, d.heartbeatMs),
          { headers: sseHeaders() },
        );
      }
      return new Response(
        runEventStream(lines, () => m.get(id), c.req.raw.signal, d.heartbeatMs),
        { headers: sseHeaders() },
      );
    }),
  );

  api.post(
    "/runs/:id/cancel",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const id = c.req.param("id") ?? "";
      const person = await currentPerson(runtime);
      await manager().cancel(id, person.id);
      return c.json({ ok: true, data: manager().get(id) as RunState } satisfies ApiResponse<RunDetail>);
    }),
  );
}

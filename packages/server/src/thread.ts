// Milestone 8: the ticket thread (Blueprint 33, mockup 15). GET /tickets/:id/thread merges the ticket's comments and
// runs by time, GET /tickets/:id/next is the Next step, POST /tickets/:id/handoff hands the ticket to a role and
// POST /tickets/:id/say is the composer (steer, queue, @role, comment). Writes carry the same checks as verb calls;
// runs record the person at this machine as responsible (actor.onBehalfOf).
import type { ApiResponse, HandoffBody, NextStep, RunState, Runtime, SayResult, ThreadItem, TicketThread } from "@helmlock/core";
import type { Hono, Context as HonoContext } from "hono";
import { z } from "zod";
import { allRuns, crewOf, failCrew } from "./crew.ts";
import type { ReadModel } from "./data.ts";
import { ApiError } from "./errors.ts";
import { currentPerson, jsonBody } from "./runs.ts";
import { checkWriteRequest } from "./writes.ts";

export interface ThreadDeps {
  runtime: Runtime;
  ready: () => Promise<ReadModel>;
  log: (line: string) => void;
  hostOf: (c: HonoContext) => string;
  port?: () => number | undefined;
  /** Per-server secret for the PreToolUse hook of server-started runs (HL_HOOK_TOKEN). */
  hookToken: string;
}

const isLive = (r: RunState) => r.status === "running" || r.status === "queued";

const HandoffSchema = z
  .object({
    role: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "a role id")
      .optional(),
    engine: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    message: z.string().optional(),
    fresh: z.boolean().optional(),
  })
  .strict();
const SaySchema = z.object({ text: z.string().trim().min(1, "say something") }).strict();

const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, "bad-request", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
};

/** Comments and runs of one ticket, oldest first; a comment and a run at the same instant keep the comment first. */
export function mergeThread(comments: { ts: string; author: string; text: string; run?: unknown }[], runs: RunState[]): ThreadItem[] {
  const items: ThreadItem[] = [
    ...comments.map(
      (c): ThreadItem => ({ kind: "comment", ts: c.ts, author: c.author, text: c.text, ...(typeof c.run === "string" && c.run ? { run: c.run } : {}) }),
    ),
    ...runs.map((r): ThreadItem => ({ kind: "run", ts: r.started, run: r })),
  ];
  const rank = (i: ThreadItem) => (i.kind === "comment" ? 0 : 1);
  return items
    .map((item, n) => ({ item, n }))
    .sort((a, b) => a.item.ts.localeCompare(b.item.ts) || rank(a.item) - rank(b.item) || a.n - b.n)
    .map((x) => x.item);
}

export async function ticketThread(runtime: Runtime, id: string): Promise<TicketThread> {
  const t = await runtime.ctx.get("tickets").get(id); // unknown-ticket -> 404
  const tid = t.ticket.id;
  const [comments, runs, next] = await Promise.all([
    runtime.ctx.get("tickets").comments(tid),
    allRuns(runtime, { ticket: tid }),
    runtime.ctx.has("crew") ? crewOf(runtime).next(tid) : Promise.resolve(undefined),
  ]);
  const live = runs.find(isLive);
  return { ticket: tid, items: mergeThread(comments, runs), next: next ?? null, ...(live ? { live } : {}) };
}

export function registerThreadRoutes(api: Hono, d: ThreadDeps): void {
  const { runtime, log } = d;
  const handle = (fn: (c: HonoContext) => Promise<Response>) => async (c: HonoContext) => {
    try {
      await d.ready();
      return await fn(c);
    } catch (e) {
      return failCrew(c, e, log);
    }
  };
  const runEnv = (c: HonoContext) => {
    const port = d.port?.();
    return { HL_SERVER_URL: port ? `http://127.0.0.1:${port}` : `http://${d.hostOf(c)}`, HL_HOOK_TOKEN: d.hookToken };
  };

  api.get(
    "/tickets/:id/thread",
    handle(async (c) => c.json({ ok: true, data: await ticketThread(runtime, c.req.param("id") ?? "") } satisfies ApiResponse<TicketThread>)),
  );

  api.get(
    "/tickets/:id/next",
    handle(async (c) => {
      const t = await runtime.ctx.get("tickets").get(c.req.param("id") ?? "");
      const next = await crewOf(runtime).next(t.ticket.id);
      return c.json({ ok: true, data: next ?? null } satisfies ApiResponse<NextStep | null>);
    }),
  );

  api.post(
    "/tickets/:id/handoff",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const body: HandoffBody = parse(HandoffSchema, await jsonBody(c));
      const person = await currentPerson(runtime);
      const state = await crewOf(runtime).handoff(
        { ...body, ticket: c.req.param("id") ?? "" },
        { kind: "person", id: person.id, onBehalfOf: person.id },
        "console",
        { env: runEnv(c) },
      );
      return c.json({ ok: true, data: state } satisfies ApiResponse<RunState>, 201);
    }),
  );

  api.post(
    "/tickets/:id/say",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const { text } = parse(SaySchema, await jsonBody(c));
      const person = await currentPerson(runtime);
      const res = await crewOf(runtime).say(c.req.param("id") ?? "", text, { kind: "person", id: person.id, onBehalfOf: person.id }, { env: runEnv(c) });
      return c.json({ ok: true, data: res } satisfies ApiResponse<SayResult>);
    }),
  );
}

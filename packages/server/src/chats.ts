// Milestone 4: the assistant over HTTP. POST /chats/:id/messages answers 202 and runs the turn in the background; the
// turn streams over GET /chats/:id/events as SSE "assistant" frames (AssistantEvent). A subscriber that joins late gets
// the current (or last) turn replayed first. Writes use the same request checks as verb calls.
import type { AssistantEvent, AssistantService, ChatDetail, ChatSummary, PlanDecision, PlanDecisionResult } from "@helmlock/core";
import { type Planner, parseDecision } from "@helmlock/plugins/assistant/plan.ts";
import type { Hono } from "hono";
import { ApiError } from "./errors.ts";
import { currentPerson, failJson, type M4RouteDeps, okJson, service, writeBody } from "./models.ts";

const HEARTBEAT_MS = 15_000;
const MAX_TEXT = 20_000;

interface TurnState {
  events: AssistantEvent[];
  running: boolean;
  listeners: Set<(e: AssistantEvent | null) => void>;
  abort?: AbortController;
}

/** Per-chat turn buffers and listeners (in memory; the JSONL file is the record). */
export function createTurnHub() {
  const chats = new Map<string, TurnState>();
  const stateOf = (id: string): TurnState => {
    let s = chats.get(id);
    if (!s) {
      s = { events: [], running: false, listeners: new Set() };
      chats.set(id, s);
    }
    return s;
  };
  return {
    running: (id: string) => chats.get(id)?.running ?? false,
    /** Runs one turn: resets the buffer, fans every event out, marks the end. */
    async run(id: string, events: AsyncIterable<AssistantEvent>, abort: AbortController): Promise<void> {
      const s = stateOf(id);
      s.events = [];
      s.running = true;
      s.abort = abort;
      try {
        for await (const e of events) {
          s.events.push(e);
          for (const l of s.listeners) l(e);
        }
      } finally {
        s.running = false;
        delete s.abort;
      }
    },
    subscribe(id: string, fn: (e: AssistantEvent | null) => void): { replay: AssistantEvent[]; stop: () => void } {
      const s = stateOf(id);
      s.listeners.add(fn);
      return { replay: [...s.events], stop: () => s.listeners.delete(fn) };
    },
    cancelAll() {
      for (const s of chats.values()) s.abort?.abort();
    },
  };
}
export type TurnHub = ReturnType<typeof createTurnHub>;

function sse(hub: TurnHub, id: string, signal: AbortSignal | undefined, heartbeatMs: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let cleanup = () => {};
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
      const frame = (e: AssistantEvent) => send(`event: assistant\ndata: ${JSON.stringify(e)}\n\n`);
      const sub = hub.subscribe(id, (e) => (e ? frame(e) : stop()));
      const beat = setInterval(() => send(": ping\n\n"), heartbeatMs);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        sub.stop();
        signal?.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      signal?.addEventListener("abort", stop);
      cleanup = stop;
      send("retry: 2000\n\n");
      for (const e of sub.replay) frame(e);
    },
    cancel() {
      cleanup();
    },
  });
}

export function mountChatRoutes(api: Hono, d: M4RouteDeps, hub: TurnHub = createTurnHub()): TurnHub {
  const assistant = async () => {
    await d.ready();
    return service(d.runtime, "assistant");
  };

  api.get("/chats", async (c) => {
    try {
      const list: ChatSummary[] = await (await assistant()).list();
      return okJson(c, list);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  api.post("/chats", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      for (const k of ["title", "model"] as const)
        if (body[k] !== undefined && typeof body[k] !== "string") throw new ApiError(400, "bad-request", `${k} must be a string`);
      const a = await assistant();
      await currentPerson(d.runtime);
      const s: ChatSummary = await a.create({
        channel: "console",
        ...(body.title ? { title: body.title as string } : {}),
        ...(body.model ? { model: body.model as string } : {}),
      });
      return okJson(c, s, 201);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  api.get("/chats/:id", async (c) => {
    try {
      const detail: ChatDetail = await (await assistant()).get(c.req.param("id") ?? "");
      return okJson(c, detail);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  api.post("/chats/:id/model", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      if (typeof body.model !== "string" || !body.model) throw new ApiError(400, "bad-request", "body needs { model: <provider>/<model> }");
      const s: ChatSummary = await (await assistant()).setModel(c.req.param("id") ?? "", body.model);
      return okJson(c, s);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  api.post("/chats/:id/messages", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new ApiError(400, "bad-request", "body needs { text } with the message");
      if (text.length > MAX_TEXT) throw new ApiError(413, "too-large", `a message is at most ${MAX_TEXT} characters`);
      const id = c.req.param("id") ?? "";
      const a = await assistant();
      await a.get(id); // 404 before 202
      if (hub.running(id)) throw new ApiError(409, "turn-running", "this chat is still answering", { fix: "wait for the done event, then send again" });
      const person = await currentPerson(d.runtime);
      const abort = new AbortController();
      const events = a.send(id, text, { actor: { kind: "person", id: person.id, onBehalfOf: person.id }, channel: "console", signal: abort.signal });
      hub.run(id, events, abort).catch((e) => d.log(`chat ${id}: ${(e as Error)?.stack ?? String(e)}`));
      return okJson(c, { chat: id, accepted: true }, 202);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  // Milestone 8: decide a plan card. Approved steps become crew hand-offs (one live run per ticket); "revise" is sent
  // back to the assistant as the next user turn and streams like a normal message.
  api.post("/chats/:id/plans/:plan", async (c) => {
    try {
      const body = await writeBody(c, d.hostOf);
      const decision: PlanDecision = parseDecision(body);
      const id = c.req.param("id") ?? "";
      const a = (await assistant()) as AssistantService & { plans?: Planner };
      if (!a.plans) throw new ApiError(501, "not-supported", "this assistant has no plan cards");
      await a.get(id);
      if (decision.revise && hub.running(id))
        throw new ApiError(409, "turn-running", "this chat is still answering", { fix: "wait for the done event, then revise" });
      if (Object.values(decision.decisions).includes("approve") && !d.runtime.ctx.has("crew"))
        throw new ApiError(503, "plugin-missing", "the crew plugin is not enabled in this workspace, so no runs can start", {
          fix: 'add a [[plugin]] row with id = "crew" and restart hl serve',
        });
      const person = await currentPerson(d.runtime);
      const actor = { kind: "person" as const, id: person.id, onBehalfOf: person.id };
      const card: PlanDecisionResult = await a.plans.decide(id, c.req.param("plan") ?? "", decision, actor);
      if (decision.revise) {
        const abort = new AbortController();
        const text = `About the plan "${card.title}": ${decision.revise}`;
        const events = a.send(id, text, { actor, channel: "console", signal: abort.signal });
        hub.run(id, events, abort).catch((e) => d.log(`chat ${id}: ${(e as Error)?.stack ?? String(e)}`));
      }
      return okJson(c, card);
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  api.get("/chats/:id/events", async (c) => {
    try {
      const id = c.req.param("id") ?? "";
      await (await assistant()).get(id);
      return new Response(sse(hub, id, c.req.raw.signal, d.heartbeatMs ?? HEARTBEAT_MS), {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    } catch (e) {
      return failJson(c, e, d.log);
    }
  });

  return hub;
}

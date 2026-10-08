// Test helper: a fake Telegram Bot API on 127.0.0.1 that records every call and serves scripted updates.
// getUpdates long-polls: it parks until an update is pushed, the client gives up, or the server closes.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { TgUpdate } from "./api.ts";

export interface FakeCall {
  method: string;
  params: Record<string, unknown>;
}

export interface FakeBotApi {
  base: string;
  token: string;
  calls: FakeCall[];
  callsTo(method: string): FakeCall[];
  /** Queue updates (update_id is filled in when omitted). */
  push(...updates: Omit<TgUpdate, "update_id">[]): void;
  /** The next n getUpdates calls answer with this HTTP status. */
  failNext(status: number, n?: number): void;
  /** Resolves when pred holds over the recorded calls (polls every 10 ms). */
  waitFor(pred: (calls: FakeCall[]) => boolean, ms?: number): Promise<void>;
  close(): Promise<void>;
}

export async function startFakeBotApi(token = "123:TEST"): Promise<FakeBotApi> {
  const calls: FakeCall[] = [];
  const queue: TgUpdate[] = [];
  const parked: { res: ServerResponse; timer: NodeJS.Timeout }[] = [];
  let nextUpdate = 1;
  let nextMessage = 100;
  let failures: number[] = [];

  const json = (res: ServerResponse, status: number, body: unknown) => {
    if (res.writableEnded) return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const flush = () => {
    while (parked.length && queue.length) {
      const p = parked.shift() as (typeof parked)[number];
      clearTimeout(p.timer);
      json(p.res, 200, { ok: true, result: queue.splice(0) });
    }
  };

  const handle = (req: IncomingMessage, res: ServerResponse, raw: string) => {
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "");
    if (!m || m[1] !== token) return json(res, 404, { ok: false, error_code: 404, description: "Not Found" });
    const method = m[2] as string;
    const params = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    calls.push({ method, params });
    if (method === "getUpdates") {
      if (params.offset === -1) return json(res, 200, { ok: true, result: [] });
      const fail = failures.shift();
      if (fail) {
        res.writeHead(fail, { "content-type": "text/html" });
        return res.end("<html>Bad Gateway</html>");
      }
      const offset = typeof params.offset === "number" ? params.offset : 0;
      for (let i = queue.length - 1; i >= 0; i--) if ((queue[i] as TgUpdate).update_id < offset) queue.splice(i, 1);
      if (queue.length) return json(res, 200, { ok: true, result: queue.splice(0) });
      const timer = setTimeout(
        () => {
          const i = parked.findIndex((p) => p.res === res);
          if (i >= 0) parked.splice(i, 1);
          json(res, 200, { ok: true, result: [] });
        },
        Math.min(Number(params.timeout ?? 0), 5) * 1000,
      );
      parked.push({ res, timer });
      res.on("close", () => {
        clearTimeout(timer);
        const i = parked.findIndex((p) => p.res === res);
        if (i >= 0) parked.splice(i, 1);
      });
      return;
    }
    if (method === "sendMessage") {
      const chat = params.chat_id as number;
      return json(res, 200, { ok: true, result: { message_id: nextMessage++, chat: { id: chat, type: "private" }, text: params.text } });
    }
    return json(res, 200, { ok: true, result: true });
  };

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => {
      raw += c.toString("utf8");
    });
    req.on("end", () => handle(req, res, raw));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  return {
    base: `http://127.0.0.1:${port}`,
    token,
    calls,
    callsTo: (method) => calls.filter((c) => c.method === method),
    push(...updates) {
      for (const u of updates) queue.push({ update_id: nextUpdate++, ...u });
      flush();
    },
    failNext(status, n = 1) {
      failures = [...failures, ...Array.from({ length: n }, () => status)];
    },
    async waitFor(pred, ms = 15000) {
      const end = Date.now() + ms;
      while (!pred(calls)) {
        if (Date.now() > end) throw new Error(`fake bot api: condition not met; calls: ${JSON.stringify(calls.map((c) => c.method))}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    close() {
      for (const p of parked.splice(0)) {
        clearTimeout(p.timer);
        json(p.res, 200, { ok: true, result: [] });
      }
      return new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
    },
  };
}

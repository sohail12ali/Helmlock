import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import type { ApiResponse, ChangeEvent, SnapshotEvent, WorkspaceSummary } from "@helmlock/core";
import { createTestWorkspace, type TestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { PortBusyError, type RunningServer, startServer } from "./server.ts";

let ws: TestWorkspace;
let srv: RunningServer;

before(async () => {
  ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  srv = await startServer({ runtime: ws.runtime, port: 0, log: () => {} });
});
after(async () => {
  await srv.close();
  await ws.cleanup();
});

/** Reads SSE frames from a fetch body. */
function sseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  return {
    async next(timeoutMs = 5000): Promise<{ event: string; data: unknown }> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const end = buf.indexOf("\n\n");
        if (end >= 0) {
          const frame = buf.slice(0, end);
          buf = buf.slice(end + 2);
          const lines = frame.split("\n");
          const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
          if (event) return { event, data: data ? JSON.parse(data) : undefined };
          continue; // comment or retry-only frame
        }
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no SSE event within ${timeoutMs} ms; buffer: ${buf}`);
        let timer: NodeJS.Timeout | undefined;
        const r = await Promise.race([
          reader.read(),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error(`no SSE event within ${timeoutMs} ms`)), left);
          }),
        ]).finally(() => clearTimeout(timer));
        if (r.done) throw new Error("stream ended");
        buf += dec.decode(r.value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

test("listens on 127.0.0.1 and serves the API", async () => {
  assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const res = await fetch(`${srv.url}api/v1/workspace`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as ApiResponse<WorkspaceSummary>;
  assert.equal(body.ok, true);
});

test("a Host header for another port or name is refused", async () => {
  const { request } = await import("node:http");
  const status = await new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path: "/api/v1/workspace", headers: { host: "rebind.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
  const other = await new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path: "/api/v1/workspace", headers: { host: `localhost:${srv.port + 1}` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(other, 403);
});

test("SSE: snapshot, then one batched change for a comment", async () => {
  const ac = new AbortController();
  const res = await fetch(`${srv.url}api/v1/events`, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const sse = sseReader(res.body!);
  const snap = await sse.next();
  assert.equal(snap.event, "snapshot");
  const v0 = (snap.data as SnapshotEvent).version;
  assert.equal(typeof v0, "number");

  // Let the watcher settle, then write through the service (comment + a second write in the same batch window).
  await new Promise((r) => setTimeout(r, 100));
  const actor = { kind: "person" as const, id: "sam", onBehalfOf: "sam" };
  // Written together so both land in one batch window even on a busy machine.
  await Promise.all([
    ws.runtime.ctx.get("tickets").comment("T-001-sa", "Live update check", actor),
    ws.runtime.ctx.get("tickets").comment("T-001-sa", "Second line in the same batch", actor),
  ]);

  const change = await sse.next();
  assert.equal(change.event, "change");
  const e = change.data as ChangeEvent;
  assert.equal(e.version, v0 + 1);
  assert.ok(e.areas.includes("tickets"), JSON.stringify(e));
  assert.deepEqual(e.tickets, ["T-001-sa"]);
  assert.ok(e.paths.includes("artifacts/T-001-sa/comments.jsonl"), JSON.stringify(e.paths));
  // Both writes landed in one batch: nothing else arrives in the next 400 ms.
  await assert.rejects(sse.next(400), /no SSE event/);
  ac.abort();
  await sse.cancel().catch(() => {});
});

test("a busy port is reported with a fix", async () => {
  const blocker = createServer();
  await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
  const port = (blocker.address() as { port: number }).port;
  try {
    await assert.rejects(startServer({ runtime: ws.runtime, port, log: () => {} }), (e: unknown) => {
      assert.ok(e instanceof PortBusyError);
      assert.match(e.fix, /--port/);
      return true;
    });
  } finally {
    blocker.close();
  }
});

// Test helper: a local fake OpenAI-compatible server (node:http). Each request is answered by a handler that returns
// a status, headers and either a JSON body or SSE chunks (sent one write per chunk, so parsers see real splits).
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}
export interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  /** Raw SSE writes; use sse() to build them. Each element is written separately. */
  sse?: string[];
}
export interface FakeServer {
  url: string;
  requests: FakeRequest[];
  close(): Promise<void>;
}

export async function startFakeOpenAI(handler: (req: FakeRequest, n: number) => FakeReply | Promise<FakeReply>): Promise<FakeServer> {
  const requests: FakeRequest[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => {
      raw += c.toString("utf8");
    });
    req.on("end", async () => {
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        // keep {}
      }
      const fr: FakeRequest = { method: req.method ?? "GET", path: req.url ?? "/", headers: req.headers, body };
      requests.push(fr);
      const r = await handler(fr, requests.length);
      const status = r.status ?? 200;
      if (r.sse) {
        res.writeHead(status, { "content-type": "text/event-stream", "cache-control": "no-cache", ...r.headers });
        for (const part of r.sse) {
          res.write(part);
          await new Promise((ok) => setImmediate(ok));
        }
        res.end();
        return;
      }
      res.writeHead(status, { "content-type": "application/json", ...r.headers });
      res.end(r.json === undefined ? "" : JSON.stringify(r.json));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/** SSE writes for a text reply split into the given pieces, then usage and [DONE]. */
export function sseText(pieces: string[], usage = { prompt_tokens: 12, completion_tokens: 5 }): string[] {
  return [
    chunk({ role: "assistant", content: "" }),
    ...pieces.map((p) => chunk({ content: p })),
    chunk({}, "stop"),
    `data: ${JSON.stringify({ id: "c1", choices: [], usage })}\n\n`,
    "data: [DONE]",
  ];
}

/** SSE writes for one or more tool calls whose arguments arrive in pieces (and a line split mid-JSON). */
export function sseToolCalls(calls: { id: string; name: string; args: string }[], usage = { prompt_tokens: 20, completion_tokens: 9 }): string[] {
  const out: string[] = [chunk({ role: "assistant", content: null })];
  calls.forEach((c, index) => {
    out.push(chunk({ tool_calls: [{ index, id: c.id, type: "function", function: { name: c.name, arguments: "" } }] }));
    const mid = Math.floor(c.args.length / 2);
    for (const piece of [c.args.slice(0, mid), c.args.slice(mid)]) {
      const line = chunk({ tool_calls: [{ index, function: { arguments: piece } }] });
      // Split the SSE line itself across two writes.
      out.push(line.slice(0, 20), line.slice(20));
    }
  });
  out.push(chunk({}, "tool_calls"), `data: ${JSON.stringify({ id: "c1", choices: [], usage })}\n\n`, "data: [DONE]\n\n");
  return out;
}

/** The last message of a chat-completions request body. */
export const lastMessage = (b: Record<string, unknown>) => (b.messages as { role: string; content: string | null }[]).at(-1);

/** A [[plugin]] providers row for workspace.toml pointing at a fake server: fake/m1 (tools) and fake/plain (no tools). */
export function providersToml(url: string, extra = ""): string {
  return `
[[plugin]]
id = "providers"

[plugin.config]
default_model = "fake/m1"
providers = [{ id = "fake", preset = "custom", base_url = "${url}", retries = 2${extra} }]
models = [{ id = "fake/m1", context_window = 32768, tool_calls = true }, { id = "fake/plain", context_window = 2048 }]
`;
}

// Start the console on 127.0.0.1 only. Used by `hl serve` and by tests (port 0 picks a free port).
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Runtime } from "@helmlock/core";
import { createAdaptorServer } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createChangeHub } from "./events.ts";

export const DEFAULT_PORT = 4317;
export const HOST = "127.0.0.1";

export interface StartOptions {
  runtime: Runtime;
  port?: number;
  uiDir?: string;
  heartbeatMs?: number;
  log?: (line: string) => void;
}

export interface RunningServer {
  url: string;
  port: number;
  /** Stops the watcher, ends open event streams and closes the socket. */
  close(): Promise<void>;
}

export class PortBusyError extends Error {
  readonly rule = "port-busy";
  readonly fix: string;
  constructor(port: number) {
    super(`port ${port} on ${HOST} is already in use (another hl serve may be running)`);
    this.fix = `open http://${HOST}:${port}/ if that is the console, or run \`hl serve --port ${port + 1}\``;
  }
}

export async function startServer(o: StartOptions): Promise<RunningServer> {
  const log = o.log ?? ((l: string) => process.stderr.write(`hl serve: ${l}\n`));
  const hub = createChangeHub(o.runtime.info.root, { log });
  let bound: number | undefined;
  const app = createApp(o.runtime, {
    hub,
    port: () => bound,
    log,
    ...(o.uiDir ? { uiDir: o.uiDir } : {}),
    ...(o.heartbeatMs ? { heartbeatMs: o.heartbeatMs } : {}),
  });
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  const want = o.port ?? DEFAULT_PORT;
  try {
    await new Promise<void>((resolveListen, reject) => {
      const onError = (e: NodeJS.ErrnoException) => reject(e.code === "EADDRINUSE" ? new PortBusyError(want) : e);
      server.once("error", onError);
      server.listen(want, HOST, () => {
        server.off("error", onError);
        resolveListen();
      });
    });
  } catch (e) {
    hub.close();
    throw e;
  }
  bound = (server.address() as AddressInfo).port;
  const url = `http://${HOST}:${bound}/`;
  let closing: Promise<void> | undefined;
  return {
    url,
    port: bound,
    close() {
      closing ??= new Promise<void>((done) => {
        hub.close();
        server.close(() => done());
        server.closeIdleConnections?.();
        setTimeout(() => server.closeAllConnections?.(), 1000).unref();
      });
      return closing;
    },
  };
}

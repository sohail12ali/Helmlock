// Live changes: one recursive watcher on the knowledge repo, batched into at most one change per 250 ms (F109).
// Snapshot-then-follow after control-center console/server/httpd.py: a client gets {version} first, then changes.
import { type FSWatcher, watch } from "node:fs";
import type { ChangeEvent } from "@helmlock/core";

export type Area = ChangeEvent["areas"][number];

export const BATCH_MS = 250;
export const HEARTBEAT_MS = 25_000;

const TICKET_RE = /^T-\d{3,}-[a-z]{2,3}$/;
const RECORD_FOLDERS = new Set(["decisions", "questions", "bugs", "gaps"]);
const WORKSPACE_FILES = new Set(["workspace.toml", "workspace.local.toml", "people.toml", "author.local", "template.toml"]);

/** True for paths the console never reports (git internals, dependencies, caches, temp and lock files). */
export function ignored(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.some((p) => p === ".git" || p === "node_modules" || p === ".hl-cache")) return true;
  const name = parts[parts.length - 1] ?? "";
  if (name.endsWith(".lock") || name.includes(".tmp-") || name.endsWith(".tmp") || name.endsWith("~")) return true;
  return false;
}

/** Areas and ticket id a changed path touches. Unknown paths count as "workspace". */
export function classifyPath(rel: string): { areas: Area[]; ticket?: string } {
  const parts = rel.split("/");
  const [first, second, third] = parts;
  if (first === "artifacts" && second && TICKET_RE.test(second)) {
    const ticket = second;
    if (!third) return { areas: ["tickets"], ticket };
    if (third === "tasks.toml") return { areas: ["tasks", "tickets"], ticket };
    if (RECORD_FOLDERS.has(third)) return { areas: ["records", "tickets"], ticket };
    return { areas: ["tickets"], ticket };
  }
  if (first === "artifacts") return { areas: ["tickets"] };
  if (first === "logs") return { areas: ["worklog"] };
  if (first === "activity") return { areas: ["activity"] };
  if (first === "runs") return { areas: ["runs"] };
  if (first === "todos") return { areas: ["todos"] };
  if (first === "approvals") return { areas: ["approvals"] };
  if (first === "chats") return { areas: ["chats"] };
  if (parts.includes("skills") || parts.includes("agents")) return { areas: ["skills"] };
  if (parts.length === 1 && (WORKSPACE_FILES.has(first as string) || (first as string).endsWith(".code-workspace"))) return { areas: ["workspace"] };
  return { areas: ["workspace"] };
}

export interface ChangeHub {
  readonly version: number;
  /** `onEnd` runs when the hub closes, so open streams can end and the server can shut down. */
  subscribe(fn: (e: ChangeEvent) => void, onEnd?: () => void): () => void;
  /** Feed one changed path (relative, "/" separators); exposed for tests and other sources. */
  push(rel: string): void;
  close(): void;
}

export function createChangeHub(root: string, opts: { batchMs?: number; log?: (line: string) => void; watch?: boolean } = {}): ChangeHub {
  const batchMs = opts.batchMs ?? BATCH_MS;
  const subs = new Set<(e: ChangeEvent) => void>();
  const ends = new Map<(e: ChangeEvent) => void, () => void>();
  let version = 0;
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;

  const flush = () => {
    timer = undefined;
    if (!pending.size) return;
    const paths = [...pending].sort();
    pending = new Set();
    const areas = new Set<Area>();
    const tickets = new Set<string>();
    for (const p of paths) {
      const c = classifyPath(p);
      for (const a of c.areas) areas.add(a);
      if (c.ticket) tickets.add(c.ticket);
    }
    version++;
    const e: ChangeEvent = { version, areas: [...areas].sort(), tickets: [...tickets].sort(), paths };
    for (const fn of subs) {
      try {
        fn(e);
      } catch (err) {
        opts.log?.(`change subscriber failed: ${(err as Error).message}`);
      }
    }
  };

  const push = (rel: string) => {
    if (!rel || ignored(rel)) return;
    pending.add(rel);
    timer ??= setTimeout(flush, batchMs);
  };

  if (opts.watch !== false) {
    try {
      watcher = watch(root, { recursive: true, persistent: false }, (_type, name) => {
        if (name) push(String(name).replaceAll("\\", "/"));
      });
      watcher.on("error", (err) => opts.log?.(`watcher error: ${err.message}`));
    } catch (err) {
      opts.log?.(`cannot watch ${root}: ${(err as Error).message}; live updates are off`);
    }
  }

  return {
    get version() {
      return version;
    },
    subscribe(fn, onEnd) {
      subs.add(fn);
      if (onEnd) ends.set(fn, onEnd);
      return () => {
        subs.delete(fn);
        ends.delete(fn);
      };
    },
    push,
    close() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      watcher?.close();
      watcher = undefined;
      const enders = [...ends.values()];
      subs.clear();
      ends.clear();
      for (const end of enders) end();
    },
  };
}

/** A text/event-stream body: snapshot first, then each change, and a comment heartbeat. */
export function sseStream(hub: ChangeHub, signal: AbortSignal | undefined, heartbeatMs = HEARTBEAT_MS): ReadableStream<Uint8Array> {
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
      const unsubscribe = hub.subscribe(
        (e) => send(`id: ${e.version}\nevent: change\ndata: ${JSON.stringify(e)}\n\n`),
        () => stop(),
      );
      const beat = setInterval(() => send(": ping\n\n"), heartbeatMs);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(beat);
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const onAbort = () => stop();
      signal?.addEventListener("abort", onAbort);
      cleanup = stop;
      send(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify({ version: hub.version })}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });
}

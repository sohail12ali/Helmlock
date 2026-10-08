// One engine session per (role, ticket) (F155, Paperclip agent_task_sessions): runs/sessions.json, local and gitignored
// with runs/. A session is resumed only on the same engine, the same cwd and the same role instructions (a hash of the
// role's agent file); anything else starts fresh, as does a session the engine no longer knows.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FileLayer } from "@helmlock/core";

/** In a sub folder so the runs/*.json record listings never see it. */
export const SESSIONS_FILE = "runs/sessions/sessions.json";

export interface SessionEntry {
  engine: string;
  session_id: string;
  cwd: string;
  instructions_hash: string;
  updated: string;
}

export const sessionKey = (role: string, ticket: string) => `${role}:${ticket}`;

const norm = (p: string) => resolve(p).replaceAll("\\", "/").toLowerCase();

/**
 * Hash of the role's agent file: the generated .claude/agents/<role>.md in the workspace (the layer winner after
 * `hl harness sync`), else the delivery repo's. "none" when neither exists.
 */
export function instructionsHash(roots: readonly string[], role: string): string {
  for (const r of roots) {
    const f = join(r, ".claude", "agents", `${role}.md`);
    if (existsSync(f)) return createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
  }
  return "none";
}

export interface SessionStore {
  get(role: string, ticket: string): Promise<SessionEntry | undefined>;
  set(role: string, ticket: string, entry: Omit<SessionEntry, "updated">): Promise<void>;
  delete(role: string, ticket: string): Promise<boolean>;
  /** The session to resume, or undefined with the reason a fresh one is started. */
  resumable(role: string, ticket: string, want: { engine: string; cwd: string; instructions_hash: string }): Promise<{ session?: string; reason: string }>;
}

export function createSessionStore(files: () => FileLayer): SessionStore {
  // Writes are serialised so two runs ending together cannot drop each other's entry.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const read = async (): Promise<Record<string, SessionEntry>> => {
    const f = files();
    if (!(await f.exists(SESSIONS_FILE))) return {};
    try {
      const raw = JSON.parse(await f.readText(SESSIONS_FILE)) as unknown;
      return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, SessionEntry>) : {};
    } catch {
      return {}; // a broken file only costs a fresh session
    }
  };
  const write = async (all: Record<string, SessionEntry>) => {
    const f = files();
    if (!(await f.exists("runs/.gitignore"))) await f.writeText("runs/.gitignore", "*\n");
    await f.writeText(SESSIONS_FILE, `${JSON.stringify(all, null, 2)}\n`);
  };
  return {
    async get(role, ticket) {
      return (await read())[sessionKey(role, ticket)];
    },
    set(role, ticket, entry) {
      return serial(async () => {
        const all = await read();
        all[sessionKey(role, ticket)] = { ...entry, updated: new Date().toISOString() };
        await write(all);
      });
    },
    delete(role, ticket) {
      return serial(async () => {
        const all = await read();
        const k = sessionKey(role, ticket);
        if (!(k in all)) return false;
        delete all[k];
        await write(all);
        return true;
      });
    },
    async resumable(role, ticket, want) {
      const e = (await read())[sessionKey(role, ticket)];
      if (!e) return { reason: "no earlier session" };
      if (e.engine !== want.engine) return { reason: `the last session ran on ${e.engine}` };
      if (norm(e.cwd) !== norm(want.cwd)) return { reason: "the working folder changed" };
      if (e.instructions_hash !== want.instructions_hash) return { reason: `the ${role} instructions changed` };
      return { session: e.session_id, reason: "resumed" };
    },
  };
}

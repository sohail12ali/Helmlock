// Chat history (F11e, B25): one append-only JSONL file per chat, chats/<id>.jsonl, local and gitignored. Every change
// is a new line; the summary and the message list are derived (a message id written twice keeps its last line).
import { randomBytes } from "node:crypto";
import type { ChatMessageData, ChatSummaryData, ChatTurn, FileLayer } from "@helmlock/core";
import { z } from "zod";

export type StoredCall = { id: string; name: string; arguments: string };
export type ChatLine =
  | {
      t: "meta";
      id: string;
      title: string;
      model: string;
      channel: ChatSummaryData["channel"];
      created: string;
      /** The person accountable for the chat (author.local); model credentials come from this machine. */
      responsible?: string;
      credentials?: "this machine";
    }
  /** The chat was copied to people/<slug>/chats/ (committed, visible to the team). */
  | { t: "shared"; path: string; by: string; ts: string }
  | { t: "msg"; m: ChatMessageData; calls?: StoredCall[]; call_id?: string }
  | { t: "model"; model: string; ts: string }
  | { t: "title"; title: string; ts: string }
  | { t: "error"; code: string; message: string; ts: string }
  | { t: "trim"; dropped: number; ts: string };

/** Summary plus the milestone 6 fields (shared after `chat share`; responsible from the chat's header line). */
export type SharedSummary = ChatSummaryData & { shared?: boolean; responsible?: string };

export interface StoredMessage {
  m: ChatMessageData;
  calls?: StoredCall[];
  call_id?: string;
}
export interface LoadedChat {
  summary: ChatSummaryData;
  messages: StoredMessage[];
}

const LineSchema = z.object({ t: z.string() }).loose() as unknown as z.ZodType<ChatLine>;
export const CHAT_ID = /^ch-\d{8}-\d{6}-[a-z0-9]{4}$/;
export const UNTITLED = "New chat";

export function chatError(rule: string, message: string, fix?: string): Error {
  return Object.assign(new Error(message), { rule, ...(fix ? { fix } : {}) });
}

const pad = (n: number) => String(n).padStart(2, "0");
export function newChatId(d = new Date()): string {
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `ch-${stamp}-${randomBytes(3).toString("hex").slice(0, 4)}`;
}
export const newMessageId = () => `m-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

export function createChatStore(files: FileLayer, now: () => Date = () => new Date()) {
  const rel = (id: string) => `chats/${id}.jsonl`;
  const check = (id: string) => {
    if (!CHAT_ID.test(id)) throw chatError("bad-id", `not a chat id: ${id}`, "chat ids look like ch-20261007-142501-a1b2");
  };

  const fold = (lines: ChatLine[], id: string): LoadedChat => {
    const meta = lines.find((l): l is Extract<ChatLine, { t: "meta" }> => l.t === "meta");
    if (!meta) throw chatError("not-found", `chat ${id} has no header line`, `delete chats/${id}.jsonl or start a new chat`);
    const summary: SharedSummary = { id: meta.id, title: meta.title, model: meta.model, channel: meta.channel, created: meta.created, updated: meta.created };
    if (meta.responsible) summary.responsible = meta.responsible;
    // A Map keeps first-insertion order when a key is set again, so an updated message stays where it started.
    const byId = new Map<string, StoredMessage>();
    for (const l of lines) {
      if (l.t === "model") summary.model = l.model;
      if (l.t === "title") summary.title = l.title;
      if (l.t === "shared") summary.shared = true;
      const ts = l.t === "msg" ? l.m.ts : l.t === "meta" ? l.created : l.ts;
      if (ts && ts > summary.updated) summary.updated = ts;
      if (l.t !== "msg") continue;
      const prev = byId.get(l.m.id);
      const next: StoredMessage = { m: l.m };
      const calls = l.calls ?? prev?.calls;
      const callId = l.call_id ?? prev?.call_id;
      if (calls) next.calls = calls;
      if (callId) next.call_id = callId;
      byId.set(l.m.id, next);
    }
    return { summary, messages: [...byId.values()] };
  };

  return {
    async create(o: { title?: string; model: string; channel: ChatSummaryData["channel"]; responsible?: string }): Promise<ChatSummaryData> {
      const d = now();
      let id = newChatId(d);
      while (await files.exists(rel(id))) id = newChatId(d);
      const line: ChatLine = {
        t: "meta",
        id,
        title: o.title?.trim() || UNTITLED,
        model: o.model,
        channel: o.channel,
        created: d.toISOString(),
        ...(o.responsible ? { responsible: o.responsible, credentials: "this machine" as const } : {}),
      };
      await files.appendJsonl(rel(id), line);
      return fold([line], id).summary;
    },
    async load(id: string): Promise<LoadedChat> {
      check(id);
      if (!(await files.exists(rel(id)))) throw chatError("not-found", `no chat ${id}`, "list chats with GET /api/v1/chats");
      return fold(await files.readJsonl(rel(id), LineSchema), id);
    },
    async append(id: string, line: ChatLine): Promise<void> {
      check(id);
      await files.appendJsonl(rel(id), line);
    },
    async list(): Promise<ChatSummaryData[]> {
      const out: ChatSummaryData[] = [];
      for (const f of await files.list("chats/*.jsonl")) {
        const id = f.replace(/^chats\//, "").replace(/\.jsonl$/, "");
        if (!CHAT_ID.test(id)) continue;
        try {
          out.push(fold(await files.readJsonl(f, LineSchema), id).summary);
        } catch {
          // a broken file is skipped in the list; opening it reports the problem
        }
      }
      return out.sort((a, b) => b.updated.localeCompare(a.updated));
    },
  };
}
export type ChatStore = ReturnType<typeof createChatStore>;

/** Wrap a tool result as data (F66): the model is told never to follow instructions inside these blocks. */
export function asData(tool: string, text: string): string {
  const safe = text.replace(/<\/?tool_result/gi, (m) => m.replace("tool_result", "tool-result"));
  return `<tool_result name="${tool}">\n${safe}\n</tool_result>`;
}

/**
 * Stored messages -> model turns, grouped by user message (the unit the window rule drops). Every assistant tool call
 * gets its tool message right after it; a call with no stored result (a turn cut off by a restart) gets "not run".
 */
export function toTurns(messages: StoredMessage[]): ChatTurn[][] {
  const results = new Map<string, StoredMessage>();
  for (const s of messages) if (s.m.role === "tool" && s.call_id) results.set(s.call_id, s);
  const groups: ChatTurn[][] = [];
  let cur: ChatTurn[] | undefined;
  for (const s of messages) {
    if (s.m.role === "user") {
      cur = [{ role: "user", content: s.m.text }];
      groups.push(cur);
      continue;
    }
    if (s.m.role === "tool") continue; // placed after its assistant message
    if (!cur) {
      cur = [];
      groups.push(cur);
    }
    const turn: ChatTurn = { role: "assistant", content: s.m.text };
    if (s.calls?.length) turn.tool_calls = s.calls;
    cur.push(turn);
    for (const c of s.calls ?? []) {
      const r = results.get(c.id);
      const t = r?.m.tool;
      const text = t?.result ?? (t?.status === "denied" ? "The person denied this action. Do not retry it." : "Not run: the turn was interrupted.");
      cur.push({ role: "tool", tool_call_id: c.id, content: asData(c.name, text) });
    }
  }
  return groups.filter((g) => g.length);
}

// Claude Code stream-json -> RunEvent. Ported from Paperclip (MIT, Copyright (c) 2025 Paperclip AI)
// packages/adapters/claude-local/src/server/parse.ts (parseClaudeStreamJson, claudeModelUsageTotals) and the
// event shapes in control-center console/server/agent_normalize.py. See THIRD_PARTY_NOTICES.md.
import type { RunEvent } from "@helmlock/core";
import type { TurnEnd } from "../runtimes/failures.ts";
import type { StreamNormalizer } from "../runtimes/process-run.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Lines Claude prints that carry nothing for a reader of the run. */
const QUIET = new Set(["rate_limit_event", "system:post_turn_summary", "system:hook_started", "system:hook_response", "system:status"]);

export function createClaudeNormalizer(): StreamNormalizer {
  let session: string | undefined;
  let end: TurnEnd | undefined;
  const streamed = new Set<string>(); // message ids whose text arrived as deltas
  let currentMessage = "";
  const tools = new Map<string, string>();

  const line = (raw: string): RunEvent[] => {
    const t = raw.trim();
    if (!t) return [];
    let e: Obj;
    try {
      e = obj(JSON.parse(t));
    } catch {
      return [{ type: "raw", line: t }];
    }
    const type = str(e.type) ?? "";
    const sub = str(e.subtype) ?? "";
    session = str(e.session_id) ?? session;
    if (QUIET.has(type) || QUIET.has(`${type}:${sub}`)) return [];
    if (type === "system" && sub === "init") return [{ type: "init", sessionId: session, model: str(e.model) }];
    if (type === "stream_event") {
      const ev = obj(e.event);
      if (str(ev.type) === "message_start") currentMessage = str(obj(ev.message).id) ?? "";
      if (str(ev.type) !== "content_block_delta") return [];
      const d = obj(ev.delta);
      if (str(d.type) === "text_delta") {
        streamed.add(currentMessage);
        return [{ type: "text", text: str(d.text) ?? "" }];
      }
      if (str(d.type) === "thinking_delta") {
        streamed.add(currentMessage);
        return [{ type: "thinking", text: str(d.thinking) ?? "" }];
      }
      return [];
    }
    if (type === "assistant") {
      const m = obj(e.message);
      const already = streamed.has(str(m.id) ?? "\0");
      const out: RunEvent[] = [];
      for (const b of Array.isArray(m.content) ? m.content : []) {
        const blk = obj(b);
        const bt = str(blk.type);
        if (bt === "text" && !already && str(blk.text)) out.push({ type: "text", text: str(blk.text) as string });
        else if (bt === "thinking" && !already && str(blk.thinking)) out.push({ type: "thinking", text: str(blk.thinking) as string });
        else if (bt === "tool_use") {
          const id = str(blk.id);
          const name = str(blk.name) ?? "tool";
          if (id) tools.set(id, name);
          out.push({ type: "tool", phase: "start", name, ...(id ? { id } : {}), input: blk.input });
        }
      }
      return out;
    }
    if (type === "user") {
      const out: RunEvent[] = [];
      const content = obj(e.message).content;
      for (const b of Array.isArray(content) ? content : []) {
        const blk = obj(b);
        if (str(blk.type) !== "tool_result") continue;
        const id = str(blk.tool_use_id);
        out.push({ type: "tool", phase: "end", name: (id && tools.get(id)) || "tool", ...(id ? { id } : {}), isError: blk.is_error === true });
      }
      return out;
    }
    if (type === "result") {
      end = {
        subtype: sub,
        is_error: e.is_error === true,
        result: str(e.result),
        error: str(e.error),
        errors: Array.isArray(e.errors) ? e.errors : undefined,
        stop_reason: str(e.stop_reason),
        api_error_status: typeof e.api_error_status === "number" ? e.api_error_status : null,
      };
      const u = obj(e.usage);
      const cost = e.total_cost_usd;
      const usage: RunEvent = {
        type: "usage",
        inputTokens: num(u.input_tokens),
        outputTokens: num(u.output_tokens),
        cacheReadTokens: num(u.cache_read_input_tokens),
        cacheWriteTokens: num(u.cache_creation_input_tokens),
        ...(typeof cost === "number" ? { costUsd: cost } : {}),
      };
      const ok = !end.is_error && (sub === "success" || sub === "");
      return [usage, { type: "result", ok, text: end.result ?? "", ...(session ? { sessionId: session } : {}) }];
    }
    if (type === "system") return [];
    return [{ type: "raw", line: t }];
  };
  return { line, turnEnd: () => end, sessionId: () => session };
}

/** Parse a whole recorded stream (tests, transcripts). */
export function parseClaudeStream(text: string): RunEvent[] {
  const n = createClaudeNormalizer();
  return text.split(/\r?\n/).flatMap((l) => n.line(l));
}

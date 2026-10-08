// Cursor CLI stream-json -> RunEvent. Ported from Paperclip (MIT, Copyright (c) 2025 Paperclip AI)
// packages/adapters/cursor-local/src/server/parse.ts (parseCursorJsonl, camelCase usage) and
// src/shared/stream.ts (normalizeCursorStreamLine), plus the tool_call "<name>ToolCall" handling from
// lc-wms .kanban/agents/normalize.py. See THIRD_PARTY_NOTICES.md.
import type { RunEvent } from "@helmlock/core";
import { PATCH_CAP, todoItems } from "../runtimes/event-vocab.ts";
import type { TurnEnd } from "../runtimes/failures.ts";
import type { StreamNormalizer } from "../runtimes/process-run.ts";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (...vs: unknown[]): number => {
  for (const v of vs) if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
};

/** Strip an optional "stdout:" / "stderr:" prefix some wrappers add (Paperclip normalizeCursorStreamLine). */
export function normalizeCursorStreamLine(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^(stdout|stderr)\s*[:=]?\s*([[{].*)$/i);
  return m ? (m[2] ?? "").trim() : t;
}

function textOf(message: unknown): string {
  if (typeof message === "string") return message;
  const m = obj(message);
  const parts: string[] = [];
  if (str(m.text)) parts.push(m.text as string);
  for (const p of Array.isArray(m.content) ? m.content : []) {
    const part = obj(p);
    if ((part.type === "text" || part.type === "output_text") && str(part.text)) parts.push(part.text as string);
  }
  return parts.join("");
}

function errorText(v: unknown): string {
  if (typeof v === "string") return v;
  const r = obj(v);
  return str(r.message) ?? str(r.error) ?? str(r.code) ?? str(r.detail) ?? (Object.keys(r).length ? JSON.stringify(r) : "");
}

export function createCursorNormalizer(): StreamNormalizer {
  let session: string | undefined;
  let end: TurnEnd | undefined;
  let lastError: string | undefined;

  const line = (raw: string): RunEvent[] => {
    const t = normalizeCursorStreamLine(raw);
    if (!t) return [];
    let e: Obj;
    try {
      e = obj(JSON.parse(t));
    } catch {
      return [{ type: "raw", line: t }];
    }
    const type = str(e.type) ?? "";
    const sub = str(e.subtype) ?? "";
    session = str(e.session_id) ?? str(e.sessionId) ?? session;
    switch (type) {
      case "system":
        if (sub === "init") return [{ type: "init", sessionId: session, model: str(e.model) }];
        if (sub === "error") lastError = errorText(e.message ?? e.error ?? e.detail);
        return [];
      case "user":
        return [];
      case "thinking":
        return sub === "delta" && str(e.text) ? [{ type: "thinking", text: e.text as string }] : [];
      case "assistant": {
        const text = textOf(e.message);
        return text ? [{ type: "text", text }] : [];
      }
      case "tool_call": {
        const call = obj(e.tool_call);
        const key = Object.keys(call).find((k) => k.endsWith("ToolCall")) ?? Object.keys(call)[0] ?? "";
        const body = obj(call[key]);
        const name = key.replace(/ToolCall$/, "") || "tool";
        const id = str(e.call_id) ?? str(call.toolCallId);
        if (sub === "started") {
          const out: RunEvent[] = [{ type: "tool", phase: "start", name, ...(id ? { id } : {}), input: body.args }];
          // Todo and plan tools (names vary across Cursor builds: updateTodos, todoWrite, createPlan, ...).
          if (/todo/i.test(name)) {
            const items = todoItems(body.args);
            if (items) out.push({ type: "todo", items });
          } else if (/plan/i.test(name)) {
            const plan = str(obj(body.args).plan);
            if (plan) out.push({ type: "plan", text: plan });
          }
          return out;
        }
        if (sub === "completed") {
          const result = obj(body.result);
          const isError = "error" in result || "failure" in result || "rejected" in result;
          const out: RunEvent[] = [{ type: "tool", phase: "end", name, ...(id ? { id } : {}), isError }];
          // Edits report their own line counts and a diff string on success.
          const ok = obj(result.success);
          const file = str(ok.path) ?? str(obj(body.args).path);
          if (!isError && file && (typeof ok.linesAdded === "number" || typeof ok.linesRemoved === "number")) {
            const patch = str(ok.diffString);
            out.push({
              type: "diff",
              file,
              added: num(ok.linesAdded),
              removed: num(ok.linesRemoved),
              ...(patch && patch.length <= PATCH_CAP ? { patch } : {}),
            });
          }
          return out;
        }
        return [];
      }
      case "error":
        lastError = errorText(e.message ?? e.error ?? e.detail);
        return [{ type: "error", message: lastError }];
      case "result": {
        const isError = e.is_error === true || sub === "error";
        end = {
          subtype: isError && sub === "success" ? "error" : sub || (isError ? "error" : "success"),
          is_error: isError,
          result: str(e.result),
          error: isError ? errorText(e.error ?? e.message ?? lastError ?? "") || undefined : undefined,
        };
        const u = obj(e.usage);
        const usage: RunEvent = {
          type: "usage",
          inputTokens: num(u.inputTokens, u.input_tokens),
          outputTokens: num(u.outputTokens, u.output_tokens),
          cacheReadTokens: num(u.cacheReadTokens, u.cachedInputTokens, u.cache_read_input_tokens),
          cacheWriteTokens: num(u.cacheWriteTokens, u.cache_creation_input_tokens),
        };
        const result: RunEvent = { type: "result", ok: !isError, text: end.result ?? end.error ?? "", ...(session ? { sessionId: session } : {}) };
        // An error event already said why; a bare error result says it here.
        return isError && !lastError ? [usage, { type: "error", message: end.error ?? `the run ended with ${end.subtype}` }, result] : [usage, result];
      }
      default:
        return [{ type: "raw", line: t }];
    }
  };
  return {
    line,
    turnEnd: () => end ?? (lastError ? { subtype: "error", is_error: true, error: lastError } : undefined),
    sessionId: () => session,
  };
}

export function parseCursorStream(text: string): RunEvent[] {
  const n = createCursorNormalizer();
  return text.split(/\r?\n/).flatMap((l) => n.line(l));
}

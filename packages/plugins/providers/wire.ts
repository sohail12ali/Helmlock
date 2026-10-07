// The OpenAI chat-completions wire (F11b): SSE line parsing, chunk accumulation and error classification.
// Pure functions over text, so every awkward part (chunks split mid-line, tool-call arguments in pieces addressed by
// index, usage in a final chunk with no choices, [DONE] without a newline) is tested without a network.
// Shape follows control-center console/server/openai_client.py (parse_sse, Accumulator).
import type { CompletionDelta, ProbeResult } from "@helmlock/core";

export type ErrorCode = NonNullable<ProbeResult["error"]>["code"];

/** A failed model call with a stable code (F75). */
export class ProviderError extends Error {
  readonly rule: string;
  readonly code: ErrorCode;
  readonly status: number | undefined;
  /** Seconds the server asked us to wait (Retry-After). */
  readonly retryAfter: number | undefined;
  constructor(code: ErrorCode, message: string, extra: { status?: number; retryAfter?: number } = {}) {
    super(message);
    this.code = code;
    this.rule = `model-${code.replace(/_/g, "-")}`;
    this.status = extra.status;
    this.retryAfter = extra.retryAfter;
  }
  get retryable(): boolean {
    return this.code === "rate_limit" || this.code === "server" || this.code === "timeout" || this.code === "network";
  }
}

const CONTEXT_RE = /context(_length|[ _-]window)?[ _-]?(exceeded|length|too long)|maximum context|too many tokens|prompt is too long/i;

/** Classify by HTTP status first (Blueprint 12), the body only to tell context overflow from other 400s. */
export function classifyStatus(status: number, body: string): ErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status === 413) return "context_exceeded";
  if (status >= 500) return "server";
  if (CONTEXT_RE.test(body)) return "context_exceeded";
  return "bad_request";
}

/** Retry-After as seconds (number or HTTP date); undefined when absent or unreadable. */
export function parseRetryAfter(v: string | null | undefined, now = Date.now()): number | undefined {
  if (!v) return undefined;
  const n = Number(v.trim());
  if (Number.isFinite(n) && n >= 0) return n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.max(0, (t - now) / 1000);
}

/** The provider's own message from an error body, when it sends JSON. */
export function errorMessage(body: string, status: number): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
    if (m) return `HTTP ${status}: ${m}`;
  } catch {
    // not JSON
  }
  const t = body.trim().slice(0, 300);
  return t ? `HTTP ${status}: ${t}` : `HTTP ${status}`;
}

/** Splits a text stream into SSE `data:` payloads. Feed chunks; call end() for a last line without a newline. */
export class SseLines {
  private buf = "";
  feed(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let i = this.buf.indexOf("\n");
    while (i >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const p = payload(line);
      if (p !== undefined) out.push(p);
      i = this.buf.indexOf("\n");
    }
    return out;
  }
  end(): string[] {
    const p = payload(this.buf);
    this.buf = "";
    return p === undefined ? [] : [p];
  }
}

function payload(raw: string): string | undefined {
  const line = raw.replace(/\r$/, "").trim();
  if (!line || line.startsWith(":") || !line.startsWith("data:")) return undefined;
  return line.slice(5).trim();
}

interface ChunkToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface Chunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: ChunkToolCall[] };
    message?: { content?: string | null; tool_calls?: ChunkToolCall[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
  error?: { message?: string; code?: number | string } | string;
}

/** Folds chunks into deltas: text as it arrives; tool calls and usage once the stream ends. */
export class Accumulator {
  private calls = new Map<number, { id: string; name: string; arguments: string }>();
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens?: number } | undefined;
  finish = "";
  text = "";

  /** One parsed chunk -> the text delta it carried (or ""). Throws ProviderError for an in-stream error object. */
  feed(c: Chunk): string {
    if (c.error) {
      const msg = typeof c.error === "string" ? c.error : (c.error.message ?? "stream error");
      const status = typeof c.error === "object" && typeof c.error.code === "number" ? c.error.code : 500;
      throw new ProviderError(classifyStatus(status, msg), msg, { status });
    }
    if (c.usage) {
      const u: { input_tokens: number; output_tokens: number; cache_read_tokens?: number } = {
        input_tokens: c.usage.prompt_tokens ?? 0,
        output_tokens: c.usage.completion_tokens ?? 0,
      };
      const cached = c.usage.prompt_tokens_details?.cached_tokens;
      if (typeof cached === "number") u.cache_read_tokens = cached;
      this.usage = u;
    }
    const ch = c.choices?.[0];
    if (!ch) return "";
    if (ch.finish_reason) this.finish = ch.finish_reason;
    const d = ch.delta ?? ch.message ?? {};
    for (const part of d.tool_calls ?? []) {
      const idx = typeof part.index === "number" ? part.index : this.calls.size;
      const call = this.calls.get(idx) ?? { id: "", name: "", arguments: "" };
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += call.name && call.name === part.function.name ? "" : part.function.name;
      if (part.function?.arguments) call.arguments += part.function.arguments;
      this.calls.set(idx, call);
    }
    const t = typeof d.content === "string" ? d.content : "";
    this.text += t;
    return t;
  }

  /** The closing deltas: assembled tool calls (in index order), usage, done. */
  close(): CompletionDelta[] {
    const out: CompletionDelta[] = [];
    for (const [idx, c] of [...this.calls.entries()].sort((a, b) => a[0] - b[0]))
      out.push({ type: "tool_call", id: c.id || `call_${idx}`, name: c.name, arguments: c.arguments || "{}" });
    if (this.usage) out.push({ type: "usage", ...this.usage });
    out.push({ type: "done", finish_reason: this.finish || (this.calls.size ? "tool_calls" : "stop") });
    return out;
  }
}

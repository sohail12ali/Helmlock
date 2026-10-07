// The provider service (F11a-c, F72-F78): one OpenAI-compatible adapter for every server in the providers table.
// complete() streams POST {base_url}/chat/completions, retries rate-limit/server/timeout/network failures that happen
// before the first delta (honouring Retry-After), and appends one usage line per call to usage/YYYY-MM-DD.jsonl
// (local, gitignored, B25). No automatic fallback to another model (F11c, F76).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChatTurn, CompletionDelta, FileLayer, ModelInfo, ProbeResult, ProvidersService, ToolSpec } from "@helmlock/core";
import { composeRows } from "@helmlock/core";
import { parse } from "smol-toml";
import { type ProviderRow, type ProvidersConfig, type Role, readProvidersConfig, splitModelId } from "./config.ts";
import { Accumulator, classifyStatus, errorMessage, ProviderError, parseRetryAfter, SseLines } from "./wire.ts";

export interface ProbeCache {
  provider: string;
  at: string;
  /** The model the probe ran against (full id). */
  model?: string;
  models: string[];
  chat: boolean;
  streaming: boolean;
  tool_calls: boolean;
}

export interface ProvidersOptions {
  /** Knowledge repo root (workspace.toml lives here). */
  root: string;
  files: FileLayer;
  /** Row config at mount time; used when the files cannot be read (and for config that came from launch flags). */
  mountConfig?: Record<string, unknown>;
  /** Prefer mountConfig over a fresh read (the row was set by launch flags). */
  pinned?: boolean;
  /** The plugin row id (default "providers"). */
  rowId?: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** First retry delay when the server sends no Retry-After (doubles each time). */
  retryBaseMs?: number;
  log?: (line: string) => void;
  now?: () => Date;
}

export const PROBE_DIR = ".hl-cache/models";
const MAX_RETRY_WAIT_MS = 60_000;

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Config re-read on every call (F11a), cached by file mtimes so it stays cheap. */
function configReader(o: ProvidersOptions): () => ProvidersConfig {
  let key = "";
  let cached: ProvidersConfig | undefined;
  const rowId = o.rowId ?? "providers";
  const read = (rel: string): { data?: Record<string, unknown>; stamp: string } => {
    const p = join(o.root, rel);
    if (!existsSync(p)) return { stamp: "-" };
    const st = statSync(p);
    return { data: parse(readFileSync(p, "utf8").replace(/^﻿/, "")) as Record<string, unknown>, stamp: `${st.mtimeMs}:${st.size}` };
  };
  return () => {
    if (o.pinned && o.mountConfig) {
      cached ??= readProvidersConfig(o.mountConfig);
      return cached;
    }
    try {
      const stamp = ["workspace.toml", "workspace.local.toml"]
        .map((f) => {
          const p = join(o.root, f);
          if (!existsSync(p)) return "-";
          const st = statSync(p);
          return `${st.mtimeMs}:${st.size}`;
        })
        .join("|");
      if (cached && stamp === key) return cached;
      const ws = read("workspace.toml");
      const local = read("workspace.local.toml");
      const { rows } = composeRows({ workspace: ws.data, local: local.data });
      const row = rows.find((r) => r.id === rowId) ?? rows.find((r) => r.use === "providers");
      cached = readProvidersConfig(row?.config ?? {});
      key = stamp;
      for (const p of cached.problems) o.log?.(`providers: ${p}`);
      return cached;
    } catch (e) {
      o.log?.(`providers: cannot read config (${(e as Error).message}); using the config from startup`);
      return readProvidersConfig(o.mountConfig ?? {});
    }
  };
}

function readProbe(root: string, provider: string): ProbeCache | undefined {
  const p = join(root, PROBE_DIR, `${provider}.json`);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ProbeCache;
  } catch {
    return undefined;
  }
}

/** OpenAI wire messages, with the compat switches applied. */
export function toWireMessages(messages: ChatTurn[], compat: Record<string, boolean>): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === "system") return { role: compat.developer_role ? "developer" : "system", content: m.content };
    if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id ?? "", content: m.content };
    if (m.role === "assistant" && m.tool_calls?.length)
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
      };
    return { role: m.role, content: m.content };
  });
}

export const toWireTools = (tools: ToolSpec[]) =>
  tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

interface Target {
  provider: ProviderRow;
  wire: string;
  model: ModelInfo;
}

export interface ProvidersImpl extends ProvidersService {
  /** The current tables (fresh read) and the refused rows. */
  config(): ProvidersConfig;
}

export function createProviders(o: ProvidersOptions): ProvidersImpl {
  const env = o.env ?? process.env;
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? (() => new Date());
  const log = o.log ?? (() => {});
  const current = configReader({ ...o, log });

  /** A configured model, with probe results filling capabilities the row does not set. */
  const withProbe = (m: ModelInfo, explicit: boolean): ModelInfo => {
    if (explicit) return m;
    const p = readProbe(o.root, m.provider);
    if (!p || p.model !== m.id) return m;
    return { ...m, capabilities: { ...m.capabilities, tool_calls: p.tool_calls, streaming: p.streaming } };
  };

  const models = (): ModelInfo[] => {
    const cfg = current();
    const raw = new Map<string, boolean>();
    for (const r of rawModelRows(cfg)) raw.set(r.id, r.explicit);
    return cfg.models.map((m) => withProbe(m, raw.get(m.id) ?? false));
  };

  const resolve = (id: string): Target => {
    const cfg = current();
    const split = splitModelId(id, cfg.providers);
    if (!split)
      throw new ProviderError("bad_request", `unknown model "${id}": model ids look like <provider>/<model>`, {
        status: 400,
      });
    const known = models().find((m) => m.id === id);
    const model: ModelInfo =
      known ?? withProbe({ id, provider: split.provider.id, label: split.wire, capabilities: { tool_calls: false, vision: false, streaming: true } }, false);
    return { provider: split.provider, wire: split.wire, model };
  };

  const headers = (p: ProviderRow): Record<string, string> => {
    const h: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const key = p.key_env ? env[p.key_env] : undefined;
    if (key) h.authorization = `Bearer ${key}`;
    else if (p.auth === "required")
      throw new ProviderError("auth", `provider ${p.id} needs a key: set the environment variable ${p.key_env ?? "(key_env not set)"}`, { status: 401 });
    return h;
  };

  /** One HTTP attempt, yielding deltas. Idle timeout covers connect, first byte and every gap between chunks. */
  async function* attempt(
    t: Target,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    stats: { ttft?: number; start: number },
  ): AsyncGenerator<CompletionDelta> {
    const ac = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, t.provider.timeout_ms);
    };
    const onAbort = () => ac.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort);
    arm();
    try {
      let res: Response;
      try {
        res = await doFetch(`${t.provider.base_url}/chat/completions`, {
          method: "POST",
          headers: headers(t.provider),
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (signal?.aborted) throw signal.reason ?? e;
        if (timedOut) throw new ProviderError("timeout", `no answer from ${t.provider.id} within ${t.provider.timeout_ms / 1000}s`);
        throw new ProviderError(
          "network",
          `cannot reach ${t.provider.base_url}: ${(e as Error).cause ? String((e as Error & { cause: unknown }).cause) : (e as Error).message}`,
        );
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProviderError(classifyStatus(res.status, text), errorMessage(text, res.status), {
          status: res.status,
          ...(parseRetryAfter(res.headers.get("retry-after")) !== undefined ? { retryAfter: parseRetryAfter(res.headers.get("retry-after")) } : {}),
        });
      }
      const acc = new Accumulator();
      const ctype = res.headers.get("content-type") ?? "";
      if (body.stream && ctype.includes("text/event-stream") && res.body) {
        const lines = new SseLines();
        const dec = new TextDecoder();
        const reader = res.body.getReader();
        let finished = false;
        const handle = function* (payloads: string[]): Generator<CompletionDelta> {
          for (const p of payloads) {
            if (p === "[DONE]") {
              finished = true;
              return;
            }
            let chunk: unknown;
            try {
              chunk = JSON.parse(p);
            } catch {
              continue; // one bad keep-alive must not end the reply
            }
            const text = acc.feed(chunk as Parameters<Accumulator["feed"]>[0]);
            if (text) {
              stats.ttft ??= Date.now() - stats.start;
              yield { type: "text", text };
            }
          }
        };
        try {
          while (!finished) {
            let r: Awaited<ReturnType<typeof reader.read>>;
            try {
              r = await reader.read();
            } catch (e) {
              if (signal?.aborted) throw signal.reason ?? e;
              if (timedOut) throw new ProviderError("timeout", `${t.provider.id} went silent for ${t.provider.timeout_ms / 1000}s`);
              throw new ProviderError("network", `stream from ${t.provider.id} broke: ${(e as Error).message}`);
            }
            arm();
            if (r.done) {
              yield* handle(lines.feed(dec.decode()).concat(lines.end()));
              break;
            }
            yield* handle(lines.feed(dec.decode(r.value, { stream: true })));
          }
        } finally {
          reader.cancel().catch(() => {});
        }
      } else {
        const text = await res.text();
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new ProviderError("server", `${t.provider.id} sent a reply that is not JSON`, { status: res.status });
        }
        const out = acc.feed(json as Parameters<Accumulator["feed"]>[0]);
        if (out) {
          stats.ttft ??= Date.now() - stats.start;
          yield { type: "text", text: out };
        }
      }
      yield* acc.close();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  const requestBody = (t: Target, messages: ChatTurn[], tools: ToolSpec[] | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const stream = t.model.capabilities.streaming !== false;
    const body: Record<string, unknown> = { ...(t.provider.extra_body ?? {}), model: t.wire, messages: toWireMessages(messages, t.provider.compat), stream };
    if (stream && t.provider.compat.usage_in_stream !== false) body.stream_options = { include_usage: true };
    if (tools?.length) body.tools = toWireTools(tools);
    if (t.model.max_tokens) body[t.provider.compat.max_completion_tokens ? "max_completion_tokens" : "max_tokens"] = t.model.max_tokens;
    return { ...body, ...extra };
  };

  const appendUsage = async (row: Record<string, unknown>) => {
    try {
      await o.files.appendJsonl(`usage/${localDate(now())}.jsonl`, row);
    } catch (e) {
      log(`providers: usage line not written: ${(e as Error).message}`);
    }
  };

  const service: ProvidersImpl = {
    config: () => current(),
    providers: () =>
      current().providers.map(({ id, label, base_url, key_env, preset, compat }) => ({
        id,
        label,
        base_url,
        ...(key_env ? { key_env } : {}),
        ...(preset ? { preset } : {}),
        compat,
      })),
    models,
    defaultModel(role?: Role) {
      const cfg = current();
      return (role ? cfg.roles[role] : undefined) ?? cfg.default_model ?? cfg.models[0]?.id;
    },

    async *complete(req) {
      const t = resolve(req.model);
      const body = requestBody(t, req.messages, req.tools);
      const stats: { ttft?: number; start: number } = { start: Date.now() };
      let retries = 0;
      let usage: { input_tokens: number; output_tokens: number; cache_read_tokens?: number } | undefined;
      let outChars = 0;
      const base = o.retryBaseMs ?? (t.provider.local ? 2000 : 1000);
      for (;;) {
        let yielded = false;
        try {
          for await (const d of attempt(t, body, req.signal, stats)) {
            yielded = true;
            if (d.type === "usage") usage = d;
            if (d.type === "text") outChars += d.text.length;
            yield d;
          }
          const ms = Date.now() - stats.start;
          await appendUsage({
            ts: now().toISOString(),
            provider: t.provider.id,
            model: t.model.id,
            billing: t.provider.billing,
            ok: true,
            input_tokens: usage?.input_tokens ?? null,
            output_tokens: usage?.output_tokens ?? null,
            cache_read_tokens: usage?.cache_read_tokens ?? null,
            estimated: !usage,
            ttft_ms: stats.ttft ?? null,
            duration_ms: ms,
            tokens_per_sec: ms > 0 ? Math.round(((usage?.output_tokens ?? Math.ceil(outChars / 4)) / ms) * 10000) / 10 : null,
            retries,
          });
          return;
        } catch (e) {
          const pe = e instanceof ProviderError ? e : undefined;
          if (!pe?.retryable || yielded || retries >= t.provider.retries || req.signal?.aborted) {
            await appendUsage({
              ts: now().toISOString(),
              provider: t.provider.id,
              model: t.model.id,
              billing: t.provider.billing,
              ok: false,
              error: pe?.code ?? "cancelled",
              duration_ms: Date.now() - stats.start,
              retries,
            });
            throw e;
          }
          const wait = Math.min(MAX_RETRY_WAIT_MS, pe.retryAfter !== undefined ? pe.retryAfter * 1000 : base * 2 ** retries);
          retries++;
          log(`providers: ${t.provider.id} ${pe.code} (${pe.message}); retry ${retries}/${t.provider.retries} in ${Math.round(wait)}ms`);
          await sleep(wait);
        }
      }
    },

    async probe(providerId) {
      const cfg = current();
      const p = cfg.providers.find((x) => x.id === providerId);
      const out: ProbeResult = { provider: providerId, reachable: false, models: [], chat: false, streaming: false, tool_calls: false };
      if (!p) {
        const why = cfg.problems.find((x) => x.startsWith(`provider ${providerId}:`));
        out.error = { code: "bad_request", message: why ?? `no provider "${providerId}" in the providers table` };
        return out;
      }
      const probeTimeout = Math.min(p.timeout_ms, p.local ? 120_000 : 30_000);
      const quick: ProviderRow = { ...p, timeout_ms: probeTimeout };
      const fail = (e: unknown) => {
        if (!out.error) out.error = e instanceof ProviderError ? { code: e.code, message: e.message } : { code: "network", message: (e as Error).message };
      };
      // 1. reach + list models
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), probeTimeout);
        try {
          const res = await doFetch(`${p.base_url}/models`, { headers: headers(p), signal: ac.signal });
          out.reachable = true;
          const text = await res.text();
          if (!res.ok) throw new ProviderError(classifyStatus(res.status, text), errorMessage(text, res.status), { status: res.status });
          const j = JSON.parse(text) as { data?: { id?: string }[]; models?: { id?: string; name?: string }[] };
          out.models = (j.data ?? j.models ?? []).map((m) => (m as { id?: string; name?: string }).id ?? (m as { name?: string }).name ?? "").filter(Boolean);
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        if (e instanceof ProviderError) fail(e);
        else fail(new ProviderError(ac_timeout(e) ? "timeout" : "network", `cannot reach ${p.base_url}: ${(e as Error).message}`));
        if (!out.reachable || out.error?.code === "auth") return out;
      }
      // 2-4. tiny prompt, streaming, tiny tool call, against the model the user will use
      const cfgModels = cfg.models.filter((m) => m.provider === p.id);
      const def = service.defaultModel();
      const modelId = (def && splitModelId(def, [p]) ? def : undefined) ?? cfgModels[0]?.id ?? (out.models[0] ? `${p.id}/${out.models[0]}` : undefined);
      if (!modelId) {
        out.error ??= { code: "bad_request", message: "the server lists no models and none is configured" };
        return out;
      }
      const split = splitModelId(modelId, [p]) as { wire: string };
      const t: Target = {
        provider: quick,
        wire: split.wire,
        model: { id: modelId, provider: p.id, label: split.wire, capabilities: { tool_calls: false, vision: false, streaming: true } },
      };
      const run = async (body: Record<string, unknown>) => {
        const deltas: CompletionDelta[] = [];
        for await (const d of attempt(t, body, undefined, { start: Date.now() })) deltas.push(d);
        return deltas;
      };
      const cap = (n: number) => ({ [p.compat.max_completion_tokens ? "max_completion_tokens" : "max_tokens"]: n });
      const ping: ChatTurn[] = [{ role: "user", content: "Reply with the single word OK." }];
      try {
        const d = await run({ ...requestBody(t, ping, undefined, cap(16)), stream: false, stream_options: undefined });
        out.chat = d.some((x) => x.type === "done");
      } catch (e) {
        fail(e);
      }
      try {
        const d = await run({ ...requestBody(t, ping, undefined, cap(16)), stream: true });
        out.streaming = d.some((x) => x.type === "text");
      } catch (e) {
        fail(e);
      }
      try {
        const tool: ToolSpec = {
          name: "ping",
          description: "Answer a connection test.",
          parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
        };
        const d = await run({
          ...requestBody(t, [{ role: "user", content: 'Call the ping tool with value "ok". Do not answer in text.' }], [tool], cap(64)),
          stream: out.streaming,
          stream_options: undefined,
        });
        out.tool_calls = d.some((x) => x.type === "tool_call" && x.name === "ping");
      } catch (e) {
        // A server without tool support usually answers 400: that is a finding, not a failure of the probe.
        if (!(e instanceof ProviderError && e.code === "bad_request")) fail(e);
      }
      const cache: ProbeCache = {
        provider: p.id,
        at: now().toISOString(),
        model: modelId,
        models: out.models,
        chat: out.chat,
        streaming: out.streaming,
        tool_calls: out.tool_calls,
      };
      try {
        const file = join(o.root, PROBE_DIR, `${p.id}.json`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`);
      } catch (e) {
        log(`providers: probe result not saved: ${(e as Error).message}`);
      }
      return out;
    },
  };
  return service;
}

const ac_timeout = (e: unknown) => (e as Error)?.name === "AbortError" || (e as Error)?.name === "TimeoutError";

/** Which model rows set tool_calls themselves (those are never overridden by a probe). */
function rawModelRows(cfg: ProvidersConfig): { id: string; explicit: boolean }[] {
  return cfg.models.map((m) => ({ id: m.id, explicit: cfg.explicitCaps.has(m.id) }));
}

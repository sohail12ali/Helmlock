// Milestone 4 client: agent runs from the console, the approval queue, models and the assistant chat.
// Types only from core (packages/core/src/contracts/api.ts, milestone 4). Writes carry WRITE_HEADER like verb calls.
import type {
  ApiResponse,
  ApprovalAnswer,
  ApprovalCard,
  ChangeEvent,
  ChatDetail,
  ChatEvent,
  ChatSummary,
  ModelProbe,
  ModelsView,
  RunDetail,
  RunEventLine,
  RunStart,
} from "@helmlock/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { API_BASE, ApiError, get } from "./client";
import { keys } from "./hooks";
import { WRITE_HEADER } from "./verbs";

/** POST with the write header. Accepts the API envelope, a bare body, or an empty 202/204. */
export async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json", [WRITE_HEADER]: "1" },
      body: JSON.stringify(body ?? {}),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("The console server is not reachable. Start it with `hl serve`.", "offline", 0);
  }
  const text = await res.text().catch(() => "");
  if (!text.trim()) {
    if (res.ok) return undefined as T;
    throw new ApiError(`Request failed (${res.status})`, "http", res.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(`Unexpected response (${res.status}) from ${path}`, "bad-response", res.status);
  }
  if (parsed && typeof parsed === "object" && "ok" in parsed) {
    const env = parsed as ApiResponse<T>;
    if (!env.ok) throw new ApiError(env.error.message, env.error.rule, res.status, env.error.fix);
    return env.data;
  }
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`, "http", res.status);
  return parsed as T;
}

const enc = encodeURIComponent;

export const m4 = {
  startRun: (body: RunStart) => post<RunDetail>("/runs", body),
  run: (id: string, s?: AbortSignal) => get<RunDetail>(`/runs/${enc(id)}`, undefined, s),
  cancelRun: (id: string) => post<RunDetail>(`/runs/${enc(id)}/cancel`, {}),
  runEventsUrl: (id: string, from = 0) => `${API_BASE}/runs/${enc(id)}/events${from ? `?from=${from}` : ""}`,
  approvals: (status: "pending" | "recent", s?: AbortSignal) => get<ApprovalCard[]>("/approvals", { status }, s),
  answer: (id: string, body: ApprovalAnswer) => post<ApprovalCard>(`/approvals/${enc(id)}`, body),
  models: (s?: AbortSignal) => get<ModelsView>("/models", undefined, s),
  testProvider: (provider: string) => post<ModelProbe>("/models/test", { provider }),
  chats: (s?: AbortSignal) => get<ChatSummary[]>("/chats", undefined, s),
  createChat: (body: { title?: string; model?: string }) => post<ChatSummary>("/chats", body),
  chat: (id: string, s?: AbortSignal) => get<ChatDetail>(`/chats/${enc(id)}`, undefined, s),
  send: (id: string, text: string) => post<unknown>(`/chats/${enc(id)}/messages`, { text }),
  setChatModel: (id: string, model: string) => post<ChatSummary>(`/chats/${enc(id)}/model`, { model }),
  chatEventsUrl: (id: string) => `${API_BASE}/chats/${enc(id)}/events`,
};

// ---------- queries ----------

export const useRunDetail = (id: string | undefined) =>
  useQuery({ queryKey: keys.run(id ?? ""), queryFn: ({ signal }) => m4.run(id!, signal), enabled: !!id, retry: false });

/** Pending approvals. A server without the queue (404) reads as "none"; a slow poll backs up the live stream. */
export const useApprovals = (status: "pending" | "recent" = "pending") =>
  useQuery({
    queryKey: keys.approvals(status),
    queryFn: async ({ signal }) => {
      try {
        return await m4.approvals(status, signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return [] as ApprovalCard[];
        throw e;
      }
    },
    refetchInterval: 30_000,
    retry: false,
  });

export const useModels = () => useQuery({ queryKey: keys.models, queryFn: ({ signal }) => m4.models(signal), staleTime: 30_000, retry: false });
export const useChats = () => useQuery({ queryKey: keys.chats, queryFn: ({ signal }) => m4.chats(signal), retry: false });
export const useChat = (id: string | undefined) =>
  useQuery({ queryKey: keys.chat(id ?? ""), queryFn: ({ signal }) => m4.chat(id!, signal), enabled: !!id, retry: false });

// ---------- mutations ----------

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunStart) => m4.startRun(body),
    onSuccess: (r) => {
      if (r?.id) qc.setQueryData(keys.run(r.id), r);
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useCancelRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => m4.cancelRun(id),
    onSuccess: (r) => {
      if (r?.id) qc.setQueryData(keys.run(id), r);
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useAnswerApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; answer: ApprovalAnswer }) => m4.answer(v.id, v.answer),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["approvals"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string; model?: string }) => m4.createChat(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["chats"] }),
  });
}

export function useSetChatModel(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => m4.setChatModel(id, model),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
      if (s) qc.setQueryData<ChatDetail>(keys.chat(id), (d) => (d ? { ...d, summary: s } : d));
    },
  });
}

export function useProbe() {
  return useMutation({ mutationFn: (provider: string) => m4.testProvider(provider) });
}

// ---------- server-sent events ----------

export type StreamState = "connecting" | "open" | "ended" | "unavailable";

/**
 * Open an EventSource and route named frames to handlers (JSON-parsed data). Returns a closer.
 * `onState("unavailable")` when the browser has no EventSource or the server refuses the stream.
 */
export function openStream(url: string, handlers: Record<string, (data: unknown) => void>, onState?: (s: StreamState) => void): () => void {
  if (typeof EventSource === "undefined") {
    onState?.("unavailable");
    return () => {};
  }
  const es = new EventSource(url);
  let opened = false;
  onState?.("connecting");
  es.onopen = () => {
    opened = true;
    onState?.("open");
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) onState?.(opened ? "ended" : "unavailable");
    else onState?.("connecting");
  };
  for (const [name, fn] of Object.entries(handlers)) {
    es.addEventListener(name, (e) => {
      const raw = (e as MessageEvent).data;
      let data: unknown = raw;
      if (typeof raw === "string" && raw.length) {
        try {
          data = JSON.parse(raw);
        } catch {
          /* keep raw text */
        }
      }
      fn(data);
    });
  }
  return () => es.close();
}

/** Follow one run's transcript (replay from seq 0, then live). Duplicate seqs after a reconnect are dropped. */
export function useRunStream(id: string | undefined): { lines: RunEventLine[]; state: StreamState } {
  const [lines, setLines] = useState<RunEventLine[]>([]);
  const [state, setState] = useState<StreamState>("connecting");
  const qc = useQueryClient();
  useEffect(() => {
    if (!id) return;
    setLines([]);
    setState("connecting");
    const seen = new Set<number>();
    let close = () => {};
    close = openStream(
      m4.runEventsUrl(id),
      {
        event: (d) => {
          const line = d as RunEventLine;
          if (!line || typeof line.seq !== "number" || seen.has(line.seq)) return;
          seen.add(line.seq);
          setLines((ls) => [...ls, line]);
        },
        end: () => {
          setState("ended");
          close();
          void qc.invalidateQueries({ queryKey: keys.run(id) });
          void qc.invalidateQueries({ queryKey: ["runs"] });
        },
      },
      (s) => setState((prev) => (prev === "ended" ? prev : s)),
    );
    return () => close();
  }, [id, qc]);
  return { lines, state };
}

/** Subscribe to a chat's assistant frames while it is open. */
export function useChatStream(id: string | undefined, onEvent: (e: ChatEvent) => void): StreamState {
  const [state, setState] = useState<StreamState>("connecting");
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    if (!id) return;
    return openStream(m4.chatEventsUrl(id), { assistant: (d) => d && typeof d === "object" && ref.current(d as ChatEvent) }, setState);
  }, [id]);
  return state;
}

/** The shared /events stream (live.ts) re-broadcasts each change; refresh the milestone 4 queries it touches. */
export function useM4Live(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const onChange = (e: Event) => {
      const ev = (e as CustomEvent<ChangeEvent>).detail;
      const areas = new Set<string>(ev?.areas ?? []);
      if (areas.has("runs")) {
        void qc.invalidateQueries({ queryKey: ["run"] });
        void qc.invalidateQueries({ queryKey: ["approvals"] });
      }
      if (areas.has("approvals")) {
        void qc.invalidateQueries({ queryKey: ["approvals"] });
        void qc.invalidateQueries({ queryKey: ["overview"] });
      }
      if (areas.has("chats")) {
        void qc.invalidateQueries({ queryKey: ["chats"] });
        void qc.invalidateQueries({ queryKey: ["chat"] });
      }
    };
    window.addEventListener("hl:change", onChange);
    return () => window.removeEventListener("hl:change", onChange);
  }, [qc]);
}

/** A clock for countdowns; ticks only while mounted. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

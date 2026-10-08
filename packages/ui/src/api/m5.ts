// Milestone 5 client: knowledge (shared area, projects, digests), inbox with per-person read and archive state, and
// the first-run setup checklist. Types only from core (packages/core/src/contracts/api.ts, milestone 5).
import type { ConsoleVerb, InboxItem, KnowledgeDoc, KnowledgeView, SetupStatus } from "@helmlock/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, get } from "./client";
import { keys } from "./hooks";
import { post } from "./m4";
import { callVerb } from "./verbs";

const enc = encodeURIComponent;

export const m5 = {
  knowledge: (s?: AbortSignal) => get<KnowledgeView>("/knowledge", undefined, s),
  doc: (path: string, s?: AbortSignal) => get<KnowledgeDoc>("/knowledge/doc", { path }, s),
  inbox: (s?: AbortSignal) => get<InboxItem[]>("/inbox", undefined, s),
  setInbox: (key: string, body: { read?: boolean; archived?: boolean }) => post<InboxItem | undefined>(`/inbox/${enc(key)}`, body),
  setup: (s?: AbortSignal) => get<SetupStatus>("/setup", undefined, s),
};

/** A server without the milestone 5 routes answers 404: read that as "not available" rather than an error. */
const missing = (e: unknown) => e instanceof ApiError && e.status === 404;

export const useKnowledge = () => useQuery({ queryKey: keys.knowledge, queryFn: ({ signal }) => m5.knowledge(signal), retry: false });
export const useKnowledgeDoc = (path: string | undefined) =>
  useQuery({ queryKey: keys.knowledgeDoc(path ?? ""), queryFn: ({ signal }) => m5.doc(path!, signal), enabled: !!path, retry: false });

export const useInbox = () =>
  useQuery({
    queryKey: keys.inbox,
    queryFn: ({ signal }) => m5.inbox(signal),
    retry: false,
    refetchInterval: 60_000,
  });

/** Unread, not archived. Undefined while loading or when the server has no inbox route. */
export function useInboxUnread(): number | undefined {
  const q = useInbox();
  if (!q.data) return undefined;
  return q.data.filter((i) => !i.read && !i.archived).length;
}

export const useSetup = () =>
  useQuery({
    queryKey: keys.setup,
    queryFn: async ({ signal }) => {
      try {
        return await m5.setup(signal);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

/** Mark read / archive. Optimistic: the list updates at once and rolls back when the server refuses. */
export function useInboxState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; read?: boolean; archived?: boolean }) => {
      const body: { read?: boolean; archived?: boolean } = {};
      if (v.read !== undefined) body.read = v.read;
      if (v.archived !== undefined) body.archived = v.archived;
      return m5.setInbox(v.key, body);
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: keys.inbox });
      const prev = qc.getQueryData<InboxItem[]>(keys.inbox);
      qc.setQueryData<InboxItem[]>(keys.inbox, (items) =>
        items?.map((i) =>
          i.key === v.key ? { ...i, ...(v.read !== undefined ? { read: v.read } : {}), ...(v.archived !== undefined ? { archived: v.archived } : {}) } : i,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.inbox, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.inbox }),
  });
}

/** The console verb that adds a provider row and its model rows. */
export const PROVIDER_ADD: ConsoleVerb = "provider add";
/** What a try-before-save probe found for one model (server name). */
export interface ModelProbeInfo {
  id: string;
  context_window?: number;
  tool_calls?: boolean;
  vision?: boolean;
}
export interface ProviderAddInput {
  id: string;
  preset?: string;
  base_url?: string;
  key_env?: string;
  /** One model (older form); `models` takes several. */
  model?: string;
  models?: string[];
  model_info?: ModelProbeInfo[];
  label?: string;
}
export const addProvider = (input: ProviderAddInput) => callVerb(PROVIDER_ADD, { ...input });

// Milestone 7: several models, the default, removal and machine secrets. All are console verbs (CONSOLE_VERBS).
export const addModels = (input: { provider: string; models: string[]; model_info?: ModelProbeInfo[] }) => callVerb("model add", { ...input });
export const removeModel = (input: { id: string; default?: string }) => callVerb("model remove", { ...input });
export const setDefaultModel = (id: string) => callVerb("model default", { id });
export const removeProvider = (input: { id: string; force?: boolean }) => callVerb("provider remove", { ...input });
/** Saves a secret to the machine's gitignored .env (the value is never echoed back). */
export const setSecret = (input: { name: string; value: string }) => callVerb("secret set", { ...input });

/** Query roots a model or provider change refreshes. */
export const MODEL_QUERIES = ["models", "setup", "settings"] as const;

/** Inbox, knowledge and setup follow the files: refresh them on any change from the shared /events stream. */
export function useM5Live(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const onChange = (e: Event) => {
      const areas = new Set<string>((e as CustomEvent<{ areas?: string[] }>).detail?.areas ?? []);
      if (["tickets", "records", "runs", "approvals", "workspace"].some((a) => areas.has(a))) void qc.invalidateQueries({ queryKey: keys.inbox });
      if (["tickets", "records", "workspace"].some((a) => areas.has(a))) void qc.invalidateQueries({ queryKey: ["knowledge"] });
      if (areas.has("workspace") || areas.has("tickets")) void qc.invalidateQueries({ queryKey: keys.setup });
    };
    window.addEventListener("hl:change", onChange);
    return () => window.removeEventListener("hl:change", onChange);
  }, [qc]);
}

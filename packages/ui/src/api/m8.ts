// Milestone 8 client: crew and engines (Blueprint 33, F152-F157). Types only from core (contracts/api.ts).
// Reads use get(); writes use post() with the write header; role settings go through the "crew set" verb.
import type {
  ChangeEvent,
  CrewView,
  HandoffBody,
  NextStep,
  RunDiff,
  RunMergeResult,
  RunSayResult,
  RunState,
  SayResult,
  TicketThread,
} from "@helmlock/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { get } from "./client";
import { keys } from "./hooks";
import { post } from "./m4";

const enc = encodeURIComponent;

export interface RunFilter {
  ticket?: string;
  role?: string;
  limit?: number;
}

export const m8keys = {
  crew: ["crew"] as const,
  thread: (ticket: string) => ["thread", ticket] as const,
  next: (ticket: string) => ["next", ticket] as const,
  /** Under the "runs" root so the shared change stream refreshes it with the other run views. */
  runList: (f: RunFilter) => ["runs", "filter", f] as const,
  diff: (run: string) => ["run-diff", run] as const,
};

export const m8 = {
  crew: (s?: AbortSignal) => get<CrewView>("/crew", undefined, s),
  thread: (ticket: string, s?: AbortSignal) => get<TicketThread>(`/tickets/${enc(ticket)}/thread`, undefined, s),
  next: (ticket: string, s?: AbortSignal) => get<NextStep | null>(`/tickets/${enc(ticket)}/next`, undefined, s),
  handoff: (ticket: string, body: HandoffBody) => post<RunState>(`/tickets/${enc(ticket)}/handoff`, body),
  say: (ticket: string, text: string) => post<SayResult>(`/tickets/${enc(ticket)}/say`, { text }),
  runs: (f: RunFilter, s?: AbortSignal) => get<RunState[]>("/runs", { ticket: f.ticket, role: f.role, limit: f.limit }, s),
  runSay: (run: string, text: string) => post<RunSayResult>(`/runs/${enc(run)}/say`, { text }),
  diff: (run: string, s?: AbortSignal) => get<RunDiff>(`/runs/${enc(run)}/diff`, undefined, s),
  merge: (run: string) => post<RunMergeResult>(`/runs/${enc(run)}/merge`, {}),
  resetSession: (role: string, ticket: string) => post<void>("/sessions/reset", { role, ticket }),
};

// ---------- queries ----------

export const useCrew = () => useQuery({ queryKey: m8keys.crew, queryFn: ({ signal }) => m8.crew(signal), retry: false });

export const useThread = (ticket: string | undefined) =>
  useQuery({ queryKey: m8keys.thread(ticket ?? ""), queryFn: ({ signal }) => m8.thread(ticket!, signal), enabled: !!ticket, retry: false });

export const useNextStep = (ticket: string | undefined) =>
  useQuery({ queryKey: m8keys.next(ticket ?? ""), queryFn: ({ signal }) => m8.next(ticket!, signal), enabled: !!ticket, retry: false });

export const useRunList = (f: RunFilter, enabled = true) =>
  useQuery({ queryKey: m8keys.runList(f), queryFn: ({ signal }) => m8.runs(f, signal), enabled, retry: false });

export const useRunDiff = (run: string, enabled: boolean) =>
  useQuery({ queryKey: m8keys.diff(run), queryFn: ({ signal }) => m8.diff(run, signal), enabled, retry: false });

// ---------- mutations ----------

function useRefresh() {
  const qc = useQueryClient();
  return (ticket?: string) => {
    for (const root of ["crew", "runs", "run", "overview"]) void qc.invalidateQueries({ queryKey: [root] });
    if (ticket) {
      void qc.invalidateQueries({ queryKey: m8keys.thread(ticket) });
      void qc.invalidateQueries({ queryKey: m8keys.next(ticket) });
      void qc.invalidateQueries({ queryKey: keys.ticket(ticket) });
    } else {
      void qc.invalidateQueries({ queryKey: ["thread"] });
      void qc.invalidateQueries({ queryKey: ["next"] });
    }
  };
}

/** A role takes a ticket (F152). */
export function useHandoff() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { ticket: string; body: HandoffBody }) => m8.handoff(v.ticket, v.body),
    onSuccess: (_r, v) => refresh(v.ticket),
  });
}

/** The ticket composer: steer, queue, hand off on @role, or comment. */
export function useTicketSay(ticket: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (text: string) => m8.say(ticket, text), onSuccess: () => refresh(ticket) });
}

export function useRunSay(run: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => m8.runSay(run, text),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.run(run) }),
  });
}

export function useMergeRun(run: string, ticket?: string) {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => m8.merge(run), onSuccess: () => refresh(ticket) });
}

export function useResetSession() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { role: string; ticket: string }) => m8.resetSession(v.role, v.ticket),
    onSuccess: (_r, v) => refresh(v.ticket),
  });
}

/** The shared /events stream (live.ts) re-broadcasts each change; refresh the crew views it touches. */
export function useM8Live(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const onChange = (e: Event) => {
      const areas = new Set<string>((e as CustomEvent<ChangeEvent>).detail?.areas ?? []);
      if (areas.has("runs") || areas.has("approvals") || areas.has("workspace")) void qc.invalidateQueries({ queryKey: ["crew"] });
      if (areas.has("runs") || areas.has("tickets") || areas.has("records")) {
        void qc.invalidateQueries({ queryKey: ["thread"] });
        void qc.invalidateQueries({ queryKey: ["next"] });
      }
    };
    window.addEventListener("hl:change", onChange);
    return () => window.removeEventListener("hl:change", onChange);
  }, [qc]);
}

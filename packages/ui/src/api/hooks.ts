import type { ChangeEvent } from "@helmlock/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./client";

/** Query keys; the first segment is what SSE invalidation targets. */
export const keys = {
  workspace: ["workspace"] as const,
  overview: ["overview"] as const,
  board: ["board"] as const,
  tickets: (q?: object) => ["tickets", q ?? {}] as const,
  ticket: (id: string) => ["ticket", id] as const,
  artifact: (ticket: string, id: string) => ["artifact", ticket, id] as const,
  activity: (q?: object) => ["activity", q ?? {}] as const,
  worklog: (q?: object) => ["worklog", q ?? {}] as const,
  todos: (q?: object) => ["todos", q ?? {}] as const,
  settings: ["settings"] as const,
  runs: ["runs"] as const,
  skills: ["skills"] as const,
  search: (q: string) => ["search", q] as const,
  // milestone 4
  run: (id: string) => ["run", id] as const,
  approvals: (status: "pending" | "recent" = "pending") => ["approvals", status] as const,
  models: ["models"] as const,
  chats: ["chats"] as const,
  chat: (id: string) => ["chat", id] as const,
};

type Area = ChangeEvent["areas"][number];

/** Which query roots each change area makes stale. */
export const AREA_KEYS: Record<Area, string[]> = {
  tickets: ["board", "tickets", "ticket", "artifact", "overview", "search"],
  records: ["ticket", "artifact", "board", "tickets", "overview", "search"],
  tasks: ["ticket", "artifact", "board", "tickets", "overview"],
  worklog: ["worklog", "overview"],
  activity: ["activity", "overview"],
  runs: ["runs", "overview", "ticket"],
  workspace: ["workspace", "overview", "board"],
  skills: ["skills"],
  todos: ["todos", "overview"],
  approvals: ["approvals", "overview"],
  chats: ["chats", "chat"],
};

export const useWorkspace = () => useQuery({ queryKey: keys.workspace, queryFn: ({ signal }) => api.workspace(signal), staleTime: 60_000 });
export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: ({ signal }) => api.overview(signal) });
export const useBoard = () => useQuery({ queryKey: keys.board, queryFn: ({ signal }) => api.board(signal) });
export const useTicket = (id: string | undefined) =>
  useQuery({ queryKey: keys.ticket(id ?? ""), queryFn: ({ signal }) => api.ticket(id!, signal), enabled: !!id });
export const useArtifact = (ticket: string | undefined, artifactId: string | undefined) =>
  useQuery({
    queryKey: keys.artifact(ticket ?? "", artifactId ?? ""),
    queryFn: ({ signal }) => api.artifact(ticket!, artifactId!, signal),
    enabled: !!ticket && !!artifactId,
  });
export const useRuns = () => useQuery({ queryKey: keys.runs, queryFn: ({ signal }) => api.runs(signal) });
export const useSkills = () => useQuery({ queryKey: keys.skills, queryFn: ({ signal }) => api.skills(signal), staleTime: 60_000 });
/** Stage id -> label from the workflow pack (the core never names a stage; the board does). */
export function useStageLabel(): (id: string) => string {
  const board = useBoard();
  const stages = board.data?.stages;
  return useCallback(
    (id: string) => {
      const s = stages?.find((x) => x.id === id);
      return s?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
    },
    [stages],
  );
}

export const useSearch = (q: string) =>
  useQuery({ queryKey: keys.search(q), queryFn: ({ signal }) => api.search(q, signal), enabled: q.trim().length > 1, staleTime: 10_000 });

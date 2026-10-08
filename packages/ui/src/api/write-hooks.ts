// Read hooks for the milestone 3 write surfaces: the verb catalog, todos and settings. Writes go through useVerb (verbs.ts).
import type { SettingsView, TodoList, VerbCatalog } from "@helmlock/core/api";
import { useQuery } from "@tanstack/react-query";
import { get } from "./client";
import { keys } from "./hooks";

export const verbsKey = ["verbs"] as const;

/** The console verbs with their inputs (F9c). Changes only when plugins change, so it is cached for a while. */
export const useVerbCatalog = () =>
  useQuery({ queryKey: verbsKey, queryFn: ({ signal }) => get<VerbCatalog>("/verbs", undefined, signal), staleTime: 5 * 60_000 });

export type TodoQuery = { status?: "open" | "done"; ticket?: string };
export const useTodos = (q: TodoQuery = {}) => useQuery({ queryKey: keys.todos(q), queryFn: ({ signal }) => get<TodoList>("/todos", q, signal) });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: ({ signal }) => get<SettingsView>("/settings", undefined, signal) });

/** Query roots each write surface refreshes on success (SSE refreshes the rest). */
export const INVALIDATE = {
  todos: ["todos", "overview"],
  worklog: ["worklog", "overview"],
  settings: ["settings", "workspace", "verbs"],
} as const;

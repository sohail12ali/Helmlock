// Milestone 6 client: people (who am I, roster, unclaimed git names), storage scopes on todos, and the agent and skill
// overrides after layer resolution. Types only from core (packages/core/src/contracts/api.ts, milestone 6). Writes go
// through console verbs: todo add/move, chat share, run attach, people add/claim.
import type { ChatSummary, OverridesView, PeopleView, TodoList } from "@helmlock/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api, get } from "./client";
import { keys } from "./hooks";

export const m6 = {
  people: (s?: AbortSignal) => get<PeopleView>("/people", undefined, s),
  overrides: (s?: AbortSignal) => get<OverridesView>("/overrides", undefined, s),
  /** `all` adds other people's personal todos (read-only for you). */
  todos: (q: { status?: "open" | "done"; all?: boolean }, s?: AbortSignal) => get<TodoList>("/todos", { status: q.status, all: q.all ? "true" : undefined }, s),
};

/** A server without the milestone 6 routes answers 404: read that as "not available" (null), not an error. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const usePeople = () => useQuery({ queryKey: keys.people, queryFn: ({ signal }) => orNull(m6.people(signal)), retry: false, staleTime: 30_000 });

export const useOverrides = () => useQuery({ queryKey: keys.overrides, queryFn: ({ signal }) => orNull(m6.overrides(signal)), retry: false });

export const useScopedTodos = (q: { status: "open" | "done"; all: boolean }) =>
  useQuery({ queryKey: keys.todos(q.all ? q : { status: q.status }), queryFn: ({ signal }) => m6.todos(q, signal) });

/** The ticket list for pickers (run attach). */
export const useTicketList = () => useQuery({ queryKey: keys.tickets(), queryFn: ({ signal }) => api.tickets(undefined, signal), staleTime: 30_000 });

/** ChatSummary.shared arrives with milestone 6 integration; read it as optional until then. */
export const isShared = (c: ChatSummary | undefined): boolean => !!(c as (ChatSummary & { shared?: boolean }) | undefined)?.shared;

/** Query roots each milestone 6 write refreshes on success (SSE refreshes the rest). */
export const INVALIDATE_M6 = {
  todos: ["todos", "overview"],
  chats: ["chats", "chat"],
  runs: ["runs", "run", "ticket", "artifact", "overview"],
  people: ["people", "workspace", "setup"],
} as const;

/** A person id (slug) suggested from a name: lowercase, ascii letters and digits joined by "-". */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Initials suggested from a name: first letter of the first and last word, upper case. */
export function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  const first = w[0]!.charAt(0);
  const last = w.length > 1 ? w[w.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

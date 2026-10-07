// Typed client for the frozen read-only API (packages/core/src/contracts/api.ts). Types only: no runtime code from core.
import type {
  ActivityFeed,
  ApiResponse,
  ArtifactContent,
  Board,
  Overview,
  RunList,
  SearchResults,
  SkillList,
  TicketDetail,
  TicketList,
  WorkLogRange,
  WorkspaceSummary,
} from "@helmlock/core/contracts";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly rule: string,
    readonly status: number,
    readonly fix?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function get<T>(path: string, q?: Query, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(q)}`, { headers: { accept: "application/json" }, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("The console server is not reachable. Start it with `hl serve`.", "offline", 0);
  }
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`Unexpected response (${res.status}) from ${path}`, "bad-response", res.status);
  }
  if (!body.ok) throw new ApiError(body.error.message, body.error.rule, res.status, body.error.fix);
  return body.data;
}

const enc = encodeURIComponent;

export const api = {
  workspace: (s?: AbortSignal) => get<WorkspaceSummary>("/workspace", undefined, s),
  overview: (s?: AbortSignal) => get<Overview>("/overview", undefined, s),
  board: (s?: AbortSignal) => get<Board>("/board", undefined, s),
  tickets: (q?: { stage?: string; project?: string; owner?: string; blocked?: boolean }, s?: AbortSignal) => get<TicketList>("/tickets", q, s),
  ticket: (id: string, s?: AbortSignal) => get<TicketDetail>(`/tickets/${enc(id)}`, undefined, s),
  artifact: (ticket: string, artifactId: string, s?: AbortSignal) => get<ArtifactContent>(`/tickets/${enc(ticket)}/artifacts/${enc(artifactId)}`, undefined, s),
  activity: (q?: { date?: string; author?: string }, s?: AbortSignal) => get<ActivityFeed>("/activity", q, s),
  worklog: (q?: { from?: string; to?: string; author?: string }, s?: AbortSignal) => get<WorkLogRange>("/worklog", q, s),
  runs: (s?: AbortSignal) => get<RunList>("/runs", undefined, s),
  skills: (s?: AbortSignal) => get<SkillList>("/skills", undefined, s),
  search: (q: string, s?: AbortSignal) => get<SearchResults>("/search", { q }, s),
};

export const EVENTS_URL = `${API_BASE}/events`;

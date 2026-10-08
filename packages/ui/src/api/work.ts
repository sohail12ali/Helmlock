// Work page reads. Every key starts with "worklog" so SSE changes to logs/ refresh them all.
import type { WorkConfigView, WorkDayView, WorkEvidence, WorkRangeView, WorkSearchResult, WorkSuggestions } from "@helmlock/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { get } from "./client";

export const workKeys = {
  config: ["worklog", "config"] as const,
  day: (date: string, author?: string) => ["worklog", "day", date, author ?? ""] as const,
  range: (start: string, end: string, author?: string) => ["worklog", "range", start, end, author ?? ""] as const,
  search: (q: string, author?: string) => ["worklog", "search", q, author ?? ""] as const,
  evidence: (date: string, author: string) => ["worklog", "evidence", date, author] as const,
  suggestions: (date: string) => ["worklog", "suggestions", date] as const,
};

export const useWorkConfig = () =>
  useQuery({ queryKey: workKeys.config, queryFn: ({ signal }) => get<WorkConfigView>("/worklog/config", undefined, signal), staleTime: 60_000 });

export const useWorkDay = (date: string, author?: string, enabled = true) =>
  useQuery({ queryKey: workKeys.day(date, author), queryFn: ({ signal }) => get<WorkDayView>("/worklog/day", { date, author }, signal), enabled });

export const useWorkRange = (start: string, end: string, author?: string, enabled = true) =>
  useQuery({
    queryKey: workKeys.range(start, end, author),
    queryFn: ({ signal }) => get<WorkRangeView>("/worklog/range", { start, end, author }, signal),
    enabled,
  });

export const useWorkSearch = (q: string, author?: string) =>
  useQuery({
    queryKey: workKeys.search(q, author),
    queryFn: ({ signal }) => get<WorkSearchResult>("/worklog/search", { q, author }, signal),
    enabled: q.trim() !== "",
  });

/** Scanning git is not free, so evidence loads only when asked (the "Check activity" button). */
export const useWorkEvidence = (date: string, author: string, enabled: boolean) =>
  useQuery({
    queryKey: workKeys.evidence(date, author),
    queryFn: ({ signal }) => get<WorkEvidence>("/worklog/evidence", { date, author }, signal),
    enabled,
    staleTime: 60_000,
  });

export const useWorkSuggestions = (date: string, enabled = true) =>
  useQuery({ queryKey: workKeys.suggestions(date), queryFn: ({ signal }) => get<WorkSuggestions>("/worklog/suggestions", { date }, signal), enabled });

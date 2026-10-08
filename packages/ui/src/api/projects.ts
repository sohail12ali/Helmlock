// Milestone 7 client: projects for the switcher and the other knowledge centers on this machine. Types only from core
// (packages/core/src/contracts/api.ts, milestone 7). Projects are added through the `project add` and `project import`
// console verbs (dry run first, then confirm).
import type { CentersView, ProjectsView } from "@helmlock/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get } from "./client";

export const projectKeys = {
  projects: ["projects"] as const,
  centers: ["centers"] as const,
};

/** Query roots an added project makes stale. */
export const PROJECT_INVALIDATE = ["projects", "knowledge", "setup", "workspace", "inbox"] as const;

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const projectsApi = {
  projects: (s?: AbortSignal) => get<ProjectsView>("/projects", undefined, s),
  centers: (s?: AbortSignal) => get<CentersView>("/centers", undefined, s),
};

/** null when the server has no /projects route (an older console). */
export const useProjects = () =>
  useQuery({ queryKey: projectKeys.projects, queryFn: ({ signal }) => orNull(projectsApi.projects(signal)), retry: false, staleTime: 30_000 });

/** Probes other consoles, so it loads only when the menu opens. */
export const useCenters = (enabled: boolean) =>
  useQuery({ queryKey: projectKeys.centers, queryFn: ({ signal }) => orNull(projectsApi.centers(signal)), enabled, retry: false, staleTime: 10_000 });

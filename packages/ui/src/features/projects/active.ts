// The active project (milestone 7): kept in the URL (?project=<id>, so a link carries it) and remembered in
// localStorage (hl.project) so it survives navigation and reloads. "" means all projects.
import type { TicketCard } from "@helmlock/core/contracts";
import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import { readPref, writePref } from "@/lib/prefs";

export const PROJECT_PARAM = "project";
const PREF = "project";

export function useActiveProject(): { project: string; setProject: (id: string) => void } {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(PROJECT_PARAM);
  const project = fromUrl ?? readPref(PREF, "");
  const setProject = useCallback(
    (id: string) => {
      writePref(PREF, id);
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (id) n.set(PROJECT_PARAM, id);
        else n.delete(PROJECT_PARAM);
        return n;
      });
    },
    [setParams],
  );
  return { project, setProject };
}

/** Mounted once in the shell: puts the remembered project back into the URL, and remembers one that arrives by link. */
export function useProjectUrlSync(): void {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(PROJECT_PARAM);
  useEffect(() => {
    if (fromUrl === null) {
      const stored = readPref(PREF, "");
      if (stored)
        setParams(
          (p) => {
            const n = new URLSearchParams(p);
            n.set(PROJECT_PARAM, stored);
            return n;
          },
          { replace: true },
        );
    } else if (fromUrl !== readPref(PREF, "")) writePref(PREF, fromUrl);
  }, [fromUrl, setParams]);
}

/**
 * Filter rule for items that point at a ticket (todos, runs): with a project active, hide the ones whose ticket belongs
 * to another project; keep the ones with no ticket or an unknown one (they carry no project).
 */
export function inProject<T>(items: T[], project: string, ticketOf: (item: T) => string | undefined, tickets: readonly TicketCard[] | undefined): T[] {
  if (!project || !tickets) return items;
  const projectOf = new Map(tickets.map((t) => [t.id, t.project]));
  return items.filter((i) => {
    const t = ticketOf(i);
    if (!t || !projectOf.has(t)) return true;
    return projectOf.get(t) === project;
  });
}

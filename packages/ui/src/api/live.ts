import type { ChangeEvent } from "@helmlock/core/contracts";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { EVENTS_URL } from "./client";
import { AREA_KEYS } from "./hooks";

export type LiveState = "connecting" | "live" | "offline";

/** Invalidate the query roots for a batch of change events at once (F109: live updates batched). */
export function invalidateAreas(qc: QueryClient, areas: Iterable<ChangeEvent["areas"][number]>): void {
  const roots = new Set<string>();
  for (const a of areas) for (const k of AREA_KEYS[a] ?? []) roots.add(k);
  for (const root of roots) void qc.invalidateQueries({ queryKey: [root] });
}

/**
 * Subscribe to /api/v1/events. The server already batches at 250 ms; we coalesce again per 300 ms window
 * so a burst of writes costs one refetch per query.
 */
export function useLiveUpdates(): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setState("offline");
      return;
    }
    const es = new EventSource(EVENTS_URL);
    const pending = new Set<ChangeEvent["areas"][number]>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastVersion = -1;

    const flush = () => {
      timer = undefined;
      invalidateAreas(qc, pending);
      pending.clear();
    };

    es.addEventListener("snapshot", (e) => {
      setState("live");
      try {
        const v = (JSON.parse((e as MessageEvent).data) as { version: number }).version;
        // Reconnected after missing changes: refresh everything once.
        if (lastVersion !== -1 && v !== lastVersion) void qc.invalidateQueries();
        lastVersion = v;
      } catch {
        /* ignore malformed snapshot */
      }
    });
    es.addEventListener("change", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as ChangeEvent;
        lastVersion = ev.version;
        for (const a of ev.areas) pending.add(a);
        // Milestone 4 views (runs, approvals, chats) follow the same stream without a second connection (src/api/m4.ts).
        window.dispatchEvent(new CustomEvent("hl:change", { detail: ev }));
        if (!timer) timer = setTimeout(flush, 300);
      } catch {
        /* ignore malformed change */
      }
    });
    es.onopen = () => setState("live");
    es.onerror = () => setState(es.readyState === EventSource.CLOSED ? "offline" : "connecting");

    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [qc]);

  return state;
}

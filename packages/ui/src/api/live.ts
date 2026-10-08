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
    const pending = new Set<ChangeEvent["areas"][number]>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastVersion = -1;
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let closed = false;

    const flush = () => {
      timer = undefined;
      invalidateAreas(qc, pending);
      pending.clear();
    };

    // Reconnect ourselves with exponential backoff (2 s doubling to 30 s) so a stopped server is not hammered.
    const connect = () => {
      if (closed) return;
      const src = new EventSource(EVENTS_URL);
      es = src;
      src.addEventListener("snapshot", (e) => {
        setState("live");
        attempt = 0;
        try {
          const v = (JSON.parse((e as MessageEvent).data) as { version: number }).version;
          // Reconnected after missing changes: refresh everything once.
          if (lastVersion !== -1 && v !== lastVersion) void qc.invalidateQueries();
          lastVersion = v;
        } catch {
          /* ignore malformed snapshot */
        }
      });
      src.addEventListener("change", (e) => {
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
      src.onopen = () => {
        attempt = 0;
        setState("live");
      };
      src.onerror = () => {
        src.close();
        if (closed) return;
        setState(attempt >= 3 ? "offline" : "connecting");
        const delay = Math.min(30_000, 2_000 * 2 ** attempt);
        attempt++;
        retry = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [qc]);

  return state;
}

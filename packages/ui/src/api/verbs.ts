// Shared write helper (milestone 3). Every console write is a verb call through the same registry as the CLI.
import type { ConsoleVerb, VerbCall, VerbCallResult } from "@helmlock/core/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "./client";

/** Must match WRITE_HEADER in packages/core/src/contracts/api.ts (type-only import keeps core out of the bundle). */
export const WRITE_HEADER = "X-Helmlock-Request";

/** "ticket move" -> /verbs/ticket/move ; "log-work" -> /verbs/log-work */
export const verbPath = (id: ConsoleVerb) => `${API_BASE}/verbs/${id.split(" ").map(encodeURIComponent).join("/")}`;

export async function callVerb(
  id: ConsoleVerb,
  input: Record<string, unknown>,
  opts: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<VerbCallResult> {
  const body: VerbCall = { input, ...(opts.dryRun ? { dry_run: true } : {}) };
  const res = await fetch(verbPath(id), {
    method: "POST",
    headers: { "Content-Type": "application/json", [WRITE_HEADER]: "1" },
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  try {
    return (await res.json()) as VerbCallResult;
  } catch {
    return { ok: false, code: 1, error: { rule: "bad-response", message: `HTTP ${res.status}` } };
  }
}

/**
 * Mutation for one verb. The promise resolves with the VerbCallResult (ok or not): a gate block (code 2) is a normal
 * outcome to show, not an exception. Query roots in `invalidate` are refreshed on success; SSE refreshes the rest.
 */
export function useVerb(id: ConsoleVerb, invalidate: readonly string[] = ["board", "tickets", "ticket", "overview"]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { input: Record<string, unknown>; dryRun?: boolean }) => callVerb(id, v.input, v.dryRun ? { dryRun: true } : {}),
    onSuccess: (r) => {
      if (r.ok) for (const k of invalidate) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
}

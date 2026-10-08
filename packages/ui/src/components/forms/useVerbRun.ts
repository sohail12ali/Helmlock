// useVerb plus the last result, for hand-built forms (quick add rows, settings fields) that show VerbResult inline.
import type { ConsoleVerb, VerbCallResult } from "@helmlock/core/api";
import { useState } from "react";
import { useVerb } from "@/api/verbs";

const OFFLINE: VerbCallResult = {
  ok: false,
  code: 1,
  error: { rule: "offline", message: "The console server is not reachable.", fix: "start it with hl serve" },
};

export function useVerbRun(id: ConsoleVerb, invalidate?: readonly string[]) {
  const m = useVerb(id, invalidate);
  const [last, setLast] = useState<{ result: VerbCallResult; preview: boolean }>();
  const run = async (input: Record<string, unknown>, dryRun = false): Promise<VerbCallResult> => {
    let result: VerbCallResult;
    try {
      result = await m.mutateAsync({ input, dryRun });
    } catch {
      result = OFFLINE;
    }
    setLast({ result, preview: dryRun });
    return result;
  };
  return { run, pending: m.isPending, last, clear: () => setLast(undefined) };
}

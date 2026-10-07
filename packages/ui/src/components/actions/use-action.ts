// One verb behind one control: send, preview (dry run), and the last failure to show inline.
import type { ConsoleVerb, VerbCallResult } from "@helmlock/core/api";
import { useState } from "react";
import { useVerb } from "@/api/verbs";
import type { VerbFailure } from "./result";

export interface Action {
  run: (input: Record<string, unknown>) => Promise<VerbCallResult>;
  preview: (input: Record<string, unknown>) => Promise<VerbCallResult>;
  pending: boolean;
  failure: VerbFailure | null;
  previewResult: VerbCallResult | null;
  reset: () => void;
}

const offline = (e: unknown): VerbFailure => ({
  ok: false,
  code: 1,
  error: { rule: "offline", message: (e as Error)?.message || "The console server is not reachable.", fix: "Start it with `hl serve`." },
});

export function useAction(id: ConsoleVerb): Action {
  const m = useVerb(id);
  const [failure, setFailure] = useState<VerbFailure | null>(null);
  const [previewResult, setPreview] = useState<VerbCallResult | null>(null);

  const call = async (input: Record<string, unknown>, dryRun: boolean): Promise<VerbCallResult> => {
    let r: VerbCallResult;
    try {
      r = await m.mutateAsync({ input, dryRun });
    } catch (e) {
      r = offline(e);
    }
    setFailure(r.ok ? null : r);
    setPreview(dryRun && r.ok ? r : null);
    return r;
  };

  return {
    run: (input) => call(input, false),
    preview: (input) => call(input, true),
    pending: m.isPending,
    failure,
    previewResult,
    reset: () => {
      setFailure(null);
      setPreview(null);
    },
  };
}

/** Split "a, b; c" or one per line into a list (options, ACs, rejected alternatives). */
export const splitList = (s: string): string[] =>
  s
    .split(/[\n,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

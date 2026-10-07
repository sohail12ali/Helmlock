// Interactive prompts (TTY only). @clack/prompts is imported lazily so it never costs start time when piped.
import type { AskFn, FieldInfo } from "@helmlock/core";

/** Approval prompt: yes, no, or no answer (cancel or timeout) which the gate treats as deny. */
export const clackAsk: AskFn = async (message, timeoutMs) => {
  const { confirm, isCancel } = await import("@clack/prompts");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await confirm({ message, initialValue: false, signal: ac.signal });
    return isCancel(r) || ac.signal.aborted ? undefined : r;
  } finally {
    clearTimeout(timer);
  }
};

/** Ask for missing required values; returns undefined when the person cancels. */
export async function askMissing(verb: string, missing: FieldInfo[]): Promise<Record<string, unknown> | undefined> {
  const { text, select, isCancel } = await import("@clack/prompts");
  const out: Record<string, unknown> = {};
  for (const f of missing) {
    const label = `${verb}: ${f.key.replace(/_/g, " ")}${f.description ? ` (${f.description})` : ""}`;
    const r = f.choices
      ? await select({ message: label, options: f.choices.map((c) => ({ value: c, label: c })) })
      : await text({ message: label, validate: (v) => (v?.trim() ? undefined : "required") });
    if (isCancel(r)) return undefined;
    const v = String(r);
    out[f.key] = f.kind === "number" ? Number(v) : f.kind === "array" ? [v] : v;
  }
  return out;
}

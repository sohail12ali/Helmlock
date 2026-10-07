// Turn form drafts (strings and booleans) into typed verb input, following VerbInfo.fields.
import type { VerbField, VerbInfo } from "@helmlock/core/api";

export type Draft = Record<string, string | boolean>;

export interface Coerced {
  input: Record<string, unknown>;
  /** Field key -> what is wrong; empty when the input can be sent. */
  problems: Record<string, string>;
}

/** Positional args first (CLI order), then the rest in catalog order. */
export function orderedFields(verb: Pick<VerbInfo, "args" | "fields">): VerbField[] {
  const pos = (k: string) => {
    const i = verb.args.indexOf(k);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return verb.fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => pos(a.f.key) - pos(b.f.key) || a.i - b.i)
    .map((x) => x.f);
}

export function emptyDraft(fields: readonly VerbField[], initial: Record<string, unknown> = {}): Draft {
  const d: Draft = {};
  for (const f of fields) {
    const v = initial[f.key];
    if (f.kind === "boolean") d[f.key] = v === true;
    else if (Array.isArray(v)) d[f.key] = v.join("\n");
    else d[f.key] = v === undefined || v === null ? "" : String(v);
  }
  return d;
}

function scalar(kind: VerbField["kind"] | undefined, raw: string): { value?: unknown; problem?: string } {
  if (kind === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n } : { problem: `"${raw}" is not a number` };
  }
  if (kind === "boolean") {
    if (raw === "true" || raw === "false") return { value: raw === "true" };
    return { problem: `"${raw}" is not true or false` };
  }
  if (kind === "unknown") {
    try {
      return { value: JSON.parse(raw) };
    } catch {
      return { value: raw };
    }
  }
  return { value: raw };
}

/** Empty optional fields are left out so the verb applies its own defaults. Arrays split on new lines or commas. */
export function coerce(fields: readonly VerbField[], draft: Draft): Coerced {
  const input: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  for (const f of fields) {
    const raw = draft[f.key];
    if (f.kind === "boolean") {
      if (raw === true) input[f.key] = true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (f.kind === "array") {
      const items = text
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (items.length === 0) {
        if (f.required) problems[f.key] = "required";
        continue;
      }
      const out: unknown[] = [];
      for (const it of items) {
        const r = scalar(f.of, it);
        if (r.problem) problems[f.key] = r.problem;
        else out.push(r.value);
      }
      input[f.key] = out;
      continue;
    }
    if (text === "") {
      if (f.required) problems[f.key] = "required";
      continue;
    }
    if (f.choices && f.choices.length > 0 && !f.choices.includes(text)) {
      problems[f.key] = `use one of ${f.choices.join(", ")}`;
      continue;
    }
    const r = scalar(f.kind, text);
    if (r.problem) problems[f.key] = r.problem;
    else input[f.key] = r.value;
  }
  return { input, problems };
}

/** "ticket move" -> "Ticket move"; field keys "day_hours" -> "Day hours". */
export const humanize = (s: string) => {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

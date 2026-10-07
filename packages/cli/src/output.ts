// Output: --json envelopes for agents, readable text for people. Colour only in a TTY (and never with NO_COLOR).
// Envelope idea from Paperclip cli/src/commands/client/common.ts printOutput (MIT, Copyright (c) 2025 Paperclip AI).
import { styleText } from "node:util";
import type { VerbError, VerbResult } from "@helmlock/core";

export interface Out {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  color: boolean;
}

type Style = Parameters<typeof styleText>[0];
const paint = (o: Out, style: Style, s: string) => (o.color ? styleText(style, s, { validateStream: false }) : s);

const cell = (v: unknown): string => (v === null || v === undefined ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** A plain table for arrays of flat objects, key: value lines for an object, JSON otherwise. */
export function formatData(data: unknown, o: Out): string {
  if (Array.isArray(data)) {
    if (!data.length) return paint(o, "dim", "(empty)");
    if (data.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      const cols = [...new Set(data.flatMap((r) => Object.keys(r as object)))];
      const rows = data.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])));
      const width = cols.map((c, i) => Math.min(48, Math.max(c.length, ...rows.map((r) => (r[i] as string).length))));
      const line = (cells: string[]) =>
        cells
          .map((c, i) => (c.length > (width[i] as number) ? `${c.slice(0, (width[i] as number) - 1)}…` : c.padEnd(width[i] as number)))
          .join("  ")
          .trimEnd();
      return [paint(o, "bold", line(cols)), ...rows.map(line)].join("\n");
    }
    return data.map(cell).join("\n");
  }
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    const w = Math.max(...entries.map(([k]) => k.length));
    return entries.map(([k, v]) => `${paint(o, "bold", k.padEnd(w))}  ${cell(v)}`).join("\n");
  }
  return cell(data);
}

export function errorText(e: VerbError, o: Out, code: number): string {
  const head = `${paint(o, code === 2 ? "yellow" : "red", code === 2 ? "blocked" : "error")} [${e.rule}] ${e.message}`;
  return [head, e.file ? `  file: ${e.file}` : "", e.fix ? `  fix:  ${e.fix}` : ""].filter(Boolean).join("\n");
}

/** Print a verb result; returns the exit code. */
export function printResult(res: VerbResult, json: boolean, o: Out): 0 | 1 | 2 {
  if (json) {
    const body = res.ok ? { ok: true, data: res.data } : { ok: false, code: res.code, error: res.error, ...(res.data !== undefined ? { data: res.data } : {}) };
    o.stdout(`${JSON.stringify(body, null, 2)}\n`);
    return res.ok ? 0 : res.code;
  }
  if (res.ok) {
    const text = res.text ?? formatData(res.data, o);
    if (text) o.stdout(`${o.color ? colorStatus(text, o) : text}\n`);
    return 0;
  }
  o.stderr(`${errorText(res.error, o, res.code)}\n`);
  return res.code;
}

/** Colour doctor-style status words at the start of lines. */
function colorStatus(text: string, o: Out): string {
  return text.replace(/^(ok {2}|warn|FAIL)(?= )/gm, (m) => paint(o, m === "FAIL" ? "red" : m === "warn" ? "yellow" : "green", m));
}

/** Errors that happen before a verb runs (unknown command, bad flags). */
export function printFailure(error: VerbError, code: 1 | 2, json: boolean, o: Out): 1 | 2 {
  return printResult({ ok: false, code, error }, json, o) as 1 | 2;
}

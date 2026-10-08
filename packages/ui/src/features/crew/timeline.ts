// The run as a timeline, not a transcript (Blueprint 33): fold RunEvent lines into grouped rows and a side rail.
// Pure functions, so the grouping is tested without rendering.
import type { RunEvent, RunOutcome } from "@helmlock/core/contracts";
import { previewInput } from "@/lib/run-flags";

export type ToolKind = "read" | "search" | "shell" | "edit" | "other";

export interface ToolCall {
  name: string;
  input?: unknown;
  done: boolean;
  isError?: boolean;
}

export type TimelineRow =
  | { kind: "tools"; key: string; tool: ToolKind; calls: ToolCall[] }
  | { kind: "diff"; key: string; file: string; added: number; removed: number; patch?: string }
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "plan"; key: string; text: string }
  | { kind: "approval"; key: string; id: string; status: "pending" | "allowed" | "denied"; summary: string }
  | { kind: "message"; key: string; text: string; by: string; delivered: "live" | "queued" }
  | { kind: "compaction"; key: string; before: number; after: number }
  | { kind: "error"; key: string; message: string; retryable?: boolean }
  | { kind: "stderr"; key: string; text: string }
  | { kind: "result"; key: string; ok: boolean; text: string; failureClass?: string };

export interface Timeline {
  rows: TimelineRow[];
  outcome?: RunOutcome;
  todos: { text: string; status: "pending" | "in_progress" | "done" }[];
  plan?: string;
  files: { file: string; added: number; removed: number }[];
  usage?: { input_tokens: number; output_tokens: number; cost_usd: number | null };
  model?: string;
}

const KINDS: [ToolKind, RegExp][] = [
  ["read", /^(read|view|cat|notebookread|read_file|open)$/i],
  ["search", /^(grep|glob|search|find|ls|list|websearch|codebase_search|grep_search|file_search|list_dir)$/i],
  ["shell", /^(bash|shell|run|exec|terminal|run_terminal_cmd|powershell)$/i],
  ["edit", /^(edit|write|multiedit|notebookedit|edit_file|write_file|apply_patch|search_replace)$/i],
];

export function toolKind(name: string): ToolKind {
  for (const [k, re] of KINDS) if (re.test(name)) return k;
  return "other";
}

const basename = (p: string) => p.split(/[\\/]/).pop() || p;

/** "Read 6 files", "Searched 3 times", "Ran pnpm test", "Edited 2 files", "Used WebFetch 2 times". */
export function toolsLabel(row: Extract<TimelineRow, { kind: "tools" }>): string {
  const n = row.calls.length;
  switch (row.tool) {
    case "read":
      return n === 1 ? `Read ${basename(previewInput(row.calls[0]!.input) || "a file")}` : `Read ${n} files`;
    case "search":
      return n === 1 ? "Searched once" : `Searched ${n} times`;
    case "shell":
      return `Ran ${previewInput(row.calls[0]!.input, 60) || row.calls[0]!.name}`;
    case "edit":
      return n === 1 ? `Edited ${basename(previewInput(row.calls[0]!.input) || "a file")}` : `Edited ${n} files`;
    default: {
      const names = [...new Set(row.calls.map((c) => c.name))];
      return names.length === 1 ? `Used ${names[0]}${n > 1 ? ` ${n} times` : ""}` : `Used ${n} tools`;
    }
  }
}

export function toolsState(row: Extract<TimelineRow, { kind: "tools" }>): "running" | "failed" | "ok" {
  if (row.calls.some((c) => c.isError)) return "failed";
  if (row.calls.some((c) => !c.done)) return "running";
  return "ok";
}

/**
 * Fold event lines: consecutive tool calls of one kind become one row (each shell command keeps its own row),
 * consecutive text joins, approvals update in place by id, edit tools are left to diff rows when the engine sends them.
 */
export function toTimeline(lines: { seq: number; event: RunEvent }[]): Timeline {
  const rows: TimelineRow[] = [];
  const t: Timeline = { rows, todos: [], files: [] };
  const hasDiffs = lines.some((l) => l.event.type === "diff");
  const openTools = new Map<string, ToolCall>();
  const approvals = new Map<string, Extract<TimelineRow, { kind: "approval" }>>();
  const files = new Map<string, { file: string; added: number; removed: number }>();
  let inT = 0;
  let outT = 0;
  let cost: number | null = null;

  for (const { seq, event: e } of lines) {
    const last = rows[rows.length - 1];
    const key = `${e.type}-${seq}`;
    switch (e.type) {
      case "tool": {
        const tool = toolKind(e.name);
        const id = e.id ?? e.name;
        if (e.phase === "end") {
          const open = openTools.get(id);
          if (open) {
            open.done = true;
            if (e.isError) open.isError = true;
            openTools.delete(id);
            break;
          }
        }
        if (tool === "edit" && hasDiffs) break;
        const call: ToolCall = { name: e.name, input: e.input, done: e.phase === "end", ...(e.isError ? { isError: true } : {}) };
        if (e.phase === "start") openTools.set(id, call);
        if (last?.kind === "tools" && last.tool === tool && tool !== "shell") last.calls.push(call);
        else rows.push({ kind: "tools", key, tool, calls: [call] });
        break;
      }
      case "diff": {
        rows.push({ kind: "diff", key, file: e.file, added: e.added, removed: e.removed, ...(e.patch ? { patch: e.patch } : {}) });
        const f = files.get(e.file) ?? { file: e.file, added: 0, removed: 0 };
        f.added += e.added;
        f.removed += e.removed;
        files.set(e.file, f);
        break;
      }
      case "text":
        if (last?.kind === "text") last.text += e.text;
        else rows.push({ kind: "text", key, text: e.text });
        break;
      case "thinking":
        if (last?.kind === "thinking") last.text += e.text;
        else rows.push({ kind: "thinking", key, text: e.text });
        break;
      case "plan":
        t.plan = e.text;
        rows.push({ kind: "plan", key, text: e.text });
        break;
      case "todo":
        t.todos = e.items;
        break;
      case "approval": {
        const seen = approvals.get(e.id);
        if (seen) {
          seen.status = e.status;
          if (e.summary) seen.summary = e.summary;
        } else {
          const row = { kind: "approval" as const, key, id: e.id, status: e.status, summary: e.summary };
          approvals.set(e.id, row);
          rows.push(row);
        }
        break;
      }
      case "message":
        rows.push({ kind: "message", key, text: e.text, by: e.by, delivered: e.delivered });
        break;
      case "compaction":
        rows.push({ kind: "compaction", key, before: e.beforeTokens, after: e.afterTokens });
        break;
      case "error":
        rows.push({ kind: "error", key, message: e.message, ...(e.retryable !== undefined ? { retryable: e.retryable } : {}) });
        break;
      case "outcome":
        t.outcome = e.outcome;
        break;
      case "usage":
        inT += e.inputTokens;
        outT += e.outputTokens;
        if (e.costUsd != null) cost = (cost ?? 0) + e.costUsd;
        break;
      case "result":
        rows.push({ kind: "result", key, ok: e.ok, text: e.text, ...(e.failureClass ? { failureClass: e.failureClass } : {}) });
        break;
      case "stderr":
        if (last?.kind === "stderr") last.text += `\n${e.text}`;
        else rows.push({ kind: "stderr", key, text: e.text });
        break;
      case "init":
        if (e.model) t.model = e.model;
        break;
      default:
        break;
    }
  }
  t.files = [...files.values()];
  if (inT || outT) t.usage = { input_tokens: inT, output_tokens: outT, cost_usd: cost };
  return t;
}

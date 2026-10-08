// Shared pieces of the milestone 8 event vocabulary (Blueprint 33): diff counts and small patches from edit tool
// inputs, and todo lists from TodoWrite-style tools. Used by the Claude and Cursor stream parsers.
import type { RunEvent } from "@helmlock/core";

/** Patches above this size are left out of the event (the worktree diff has the full one). */
export const PATCH_CAP = 4000;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const lines = (s: string): string[] => (s === "" ? [] : s.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n"));

/** Lines added and removed by replacing `before` with `after`: the common head and tail are not counted. */
export function lineChange(before: string, after: string): { added: number; removed: number; patch: string } {
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const gone = a.slice(head, a.length - tail);
  const come = b.slice(head, b.length - tail);
  const patch = [...gone.map((l) => `-${l}`), ...come.map((l) => `+${l}`)].join("\n");
  return { added: come.length, removed: gone.length, patch };
}

function diffEvent(file: string, parts: { added: number; removed: number; patch: string }[]): RunEvent | undefined {
  if (!file) return undefined;
  const added = parts.reduce((n, p) => n + p.added, 0);
  const removed = parts.reduce((n, p) => n + p.removed, 0);
  const patch = parts
    .map((p) => p.patch)
    .filter(Boolean)
    .join("\n@@\n");
  return { type: "diff", file, added, removed, ...(patch && patch.length <= PATCH_CAP ? { patch } : {}) };
}

/** A diff event from a Claude Code Edit, MultiEdit or Write tool input (undefined for other tools). */
export function claudeEditDiff(tool: string, input: unknown): RunEvent | undefined {
  const i = obj(input);
  const file = str(i.file_path) || str(i.path);
  if (tool === "Edit") return diffEvent(file, [lineChange(str(i.old_string), str(i.new_string))]);
  if (tool === "MultiEdit") {
    const edits = Array.isArray(i.edits) ? i.edits : [];
    return diffEvent(
      file,
      edits.map((e) => lineChange(str(obj(e).old_string), str(obj(e).new_string))),
    );
  }
  if (tool === "Write") return diffEvent(file, [lineChange("", str(i.content))]);
  return undefined;
}

export type TodoItem = Extract<RunEvent, { type: "todo" }>["items"][number];

function todoStatus(s: string): TodoItem["status"] {
  const v = s.toLowerCase();
  if (v.includes("progress")) return "in_progress";
  if (v.includes("complete") || v.includes("done") || v.includes("cancel")) return "done";
  return "pending";
}

/** Todo items from a TodoWrite-style input ({todos: [{content|text|title, status}]}). */
export function todoItems(input: unknown): TodoItem[] | undefined {
  const todos = obj(input).todos;
  if (!Array.isArray(todos)) return undefined;
  return todos
    .map((t) => {
      const o = obj(t);
      return { text: str(o.content) || str(o.text) || str(o.title) || str(o.activeForm), status: todoStatus(str(o.status)) };
    })
    .filter((t) => t.text);
}

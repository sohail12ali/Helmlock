// The session is an append-only JSONL event log (deepseek-harness): runs/loop-sessions/<id>.jsonl in the knowledge
// root (local, gitignored with runs/). The model history is rebuilt from it on every step, so resume is "load the log
// and append the next user message". Pruning and compaction are lines too, so a rebuild replays them exactly.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatTurn } from "@helmlock/core";

export type ToolCallData = { id: string; name: string; arguments: string };

export type SessionLine =
  | { t: "meta"; v: 1; session: string; created: string; model?: string; role?: string; cwd: string }
  | { t: "user"; content: string; ts: string; source?: "prompt" | "steer" | "reminder" | "note" }
  | { t: "assistant"; content: string; tool_calls?: ToolCallData[]; ts: string }
  | { t: "tool"; call_id: string; name: string; content: string; is_error?: boolean; ts: string }
  | { t: "prune"; call_ids: string[]; ts: string }
  | { t: "compact"; summary: string; dropped: number; before_tokens: number; after_tokens: number; ts: string }
  | { t: "end"; ok: boolean; reason: string; ts: string };

export const SESSIONS_DIR = "runs/loop-sessions";
export const SUMMARY_PREFIX = "Summary of the earlier conversation (compacted to fit the context window):\n\n";
export const PRUNE_HEAD = 4096;
export const PRUNE_TAIL = 1024;

export const newSessionId = () => {
  const d = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `ls-${d}-${randomBytes(3).toString("hex")}`;
};

export const validSessionId = (id: string) => /^[\w.-]{1,100}$/.test(id) && !id.startsWith(".");

/** Tool output beyond head 4 KB + tail 1 KB is cut (deepseek-harness tool-result pruner). */
export function pruneText(s: string): string {
  if (s.length <= PRUNE_HEAD + PRUNE_TAIL + 200) return s;
  return `${s.slice(0, PRUNE_HEAD)}\n[... ${s.length - PRUNE_HEAD - PRUNE_TAIL} characters pruned to save context ...]\n${s.slice(-PRUNE_TAIL)}`;
}

export class SessionLog {
  readonly id: string;
  readonly file: string;
  readonly lines: SessionLine[];
  constructor(dir: string, id: string) {
    this.id = id;
    this.file = join(dir, `${id}.jsonl`);
    this.lines = [];
    if (existsSync(this.file)) {
      for (const raw of readFileSync(this.file, "utf8").split("\n")) {
        if (!raw.trim()) continue;
        try {
          this.lines.push(JSON.parse(raw) as SessionLine);
        } catch {
          /* a torn last line after a crash: skipped */
        }
      }
    } else mkdirSync(dir, { recursive: true });
  }
  append(line: SessionLine): void {
    this.lines.push(line);
    appendFileSync(this.file, `${JSON.stringify(line)}\n`, "utf8");
  }
  history(): ChatTurn[] {
    return rebuild(this.lines);
  }
}

/** Replays the log into model messages, repairing tool-call pairing (a crash between a call and its result). */
export function rebuild(lines: readonly SessionLine[]): ChatTurn[] {
  let msgs: ChatTurn[] = [];
  for (const l of lines) {
    switch (l.t) {
      case "user":
        msgs.push({ role: "user", content: l.content });
        break;
      case "assistant":
        msgs.push({ role: "assistant", content: l.content, ...(l.tool_calls?.length ? { tool_calls: l.tool_calls } : {}) });
        break;
      case "tool":
        msgs.push({ role: "tool", content: l.content, tool_call_id: l.call_id });
        break;
      case "prune": {
        const ids = new Set(l.call_ids);
        msgs = msgs.map((m) => (m.role === "tool" && m.tool_call_id && ids.has(m.tool_call_id) ? { ...m, content: pruneText(m.content) } : m));
        break;
      }
      case "compact":
        // `dropped` counts messages of the repaired history the loop saw when it compacted.
        msgs = [{ role: "user", content: `${SUMMARY_PREFIX}${l.summary}` }, ...repairPairs(msgs).slice(l.dropped)];
        break;
      default:
        break;
    }
  }
  return repairPairs(msgs);
}

function repairPairs(msgs: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  let open: string[] = [];
  const close = () => {
    for (const id of open) out.push({ role: "tool", content: "error: the run stopped before this tool call finished", tool_call_id: id });
    open = [];
  };
  for (const m of msgs) {
    if (m.role === "tool") {
      if (!m.tool_call_id || !open.includes(m.tool_call_id)) continue; // orphan result: drop
      open = open.filter((x) => x !== m.tool_call_id);
      out.push(m);
      continue;
    }
    close();
    out.push(m);
    if (m.role === "assistant" && m.tool_calls?.length) open = m.tool_calls.map((c) => c.id);
  }
  close();
  return out;
}

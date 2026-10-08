// Context management (deepseek-harness compaction ladder): above 80% of the model's window, first prune old tool
// output to head 4 KB + tail 1 KB, then summarise the older history with the same model and keep the last ~16%
// verbatim. A context-length error from the provider forces both and the step is retried once.
import type { ChatTurn, ToolSpec } from "@helmlock/core";
import { PRUNE_HEAD, PRUNE_TAIL, pruneText } from "./session.ts";

export const DEFAULT_CONTEXT_WINDOW = 32_000;
export const THRESHOLD_RATIO = 0.8;
export const RETAIN_RATIO = 0.16;

/** About four characters per token, plus a little per message. */
export function estimateTokens(msgs: readonly ChatTurn[], tools?: readonly ToolSpec[]): number {
  let chars = 0;
  for (const m of msgs) {
    chars += m.content.length + 16;
    for (const c of m.tool_calls ?? []) chars += c.name.length + c.arguments.length + 16;
  }
  if (tools?.length) chars += JSON.stringify(tools).length;
  return Math.ceil(chars / 4);
}

/** Tool results outside the retained tail that are worth pruning. */
export function pruneCandidates(history: readonly ChatTurn[], retainTokens: number): string[] {
  const keepFrom = tailStart(history, retainTokens);
  const ids: string[] = [];
  for (const [i, m] of history.entries()) {
    if (i >= keepFrom) break;
    if (m.role === "tool" && m.tool_call_id && m.content.length > PRUNE_HEAD + PRUNE_TAIL + 200 && pruneText(m.content) !== m.content) ids.push(m.tool_call_id);
  }
  return ids;
}

/** Index where the verbatim tail starts: about `retainTokens` from the end (at least the last message), never on a tool result. */
export function tailStart(history: readonly ChatTurn[], retainTokens: number): number {
  let tokens = 0;
  let i = history.length;
  while (i > 0) {
    const t = estimateTokens([history[i - 1] as ChatTurn]);
    if (tokens + t > retainTokens && i < history.length) break;
    tokens += t;
    i--;
  }
  // Start the tail at a user or assistant message so tool calls stay paired with their results.
  while (i > 0 && history[i]?.role === "tool") i--;
  return i;
}

const SUMMARY_SYSTEM = [
  "You compact an agent's working conversation so it can continue with less context.",
  "Write a faithful summary of the conversation below for the same agent: the task and the person's requests,",
  "decisions made, files read and changed (paths), commands run and their results, errors met, the todo state,",
  "and what was about to happen next. Keep exact identifiers (paths, ticket ids, function names). No preamble.",
].join(" ");

/** The messages that ask the model for a summary of `old` (capped to fit the window). */
export function summaryRequest(old: readonly ChatTurn[], windowTokens: number): ChatTurn[] {
  const parts: string[] = [];
  for (const m of old) {
    const calls = m.tool_calls?.map((c) => `[call ${c.name} ${c.arguments.slice(0, 500)}]`).join("\n") ?? "";
    const body = m.role === "tool" ? pruneText(m.content) : m.content;
    parts.push(`### ${m.role}\n${body}${calls ? `\n${calls}` : ""}`);
  }
  let text = parts.join("\n\n");
  const maxChars = Math.floor(windowTokens * 0.6 * 4);
  if (text.length > maxChars) text = `[earliest part cut]\n${text.slice(-maxChars)}`;
  return [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content: `<conversation>\n${text}\n</conversation>\n\nWrite the summary now.` },
  ];
}

// Context window rule (F74): estimate tokens before each call; when the prompt passes about 80% of the model's window,
// drop the oldest whole turns (a user message with its replies and tool results, so tool calls stay paired).
// The newest turn is never dropped; if it alone does not fit, the call fails with context_exceeded.
import type { ChatTurn, ToolSpec } from "@helmlock/core";

/** Used when a model row has no context_window: small on purpose, so unknown local models are not overrun. */
export const DEFAULT_WINDOW = 8192;
export const WARN_RATIO = 0.8;

/** About four characters per token plus a small per-message overhead. Approximate on purpose. */
export function estimateTokens(messages: ChatTurn[], tools?: ToolSpec[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length + 16;
    for (const c of m.tool_calls ?? []) chars += c.name.length + c.arguments.length + 24;
  }
  if (tools?.length) chars += JSON.stringify(tools).length;
  return Math.ceil(chars / 4);
}

export interface FitResult {
  messages: ChatTurn[];
  /** Whole turns dropped from the front. */
  dropped: number;
  estimate: number;
  budget: number;
  /** True when even the newest turn alone does not fit. */
  over: boolean;
}

/** Budget = 80% of the window, and never more than the window minus room for the reply. */
export function budgetFor(window: number | undefined, maxTokens: number | undefined): number {
  const w = window ?? DEFAULT_WINDOW;
  const reserve = maxTokens ?? Math.min(1024, Math.floor(w / 4));
  return Math.max(256, Math.min(Math.floor(w * WARN_RATIO), w - reserve));
}

export function fitWindow(system: ChatTurn[], turns: ChatTurn[][], tools: ToolSpec[] | undefined, budget: number): FitResult {
  let start = 0;
  const build = () => [...system, ...turns.slice(start).flat()];
  let messages = build();
  let estimate = estimateTokens(messages, tools);
  while (estimate > budget && start < turns.length - 1) {
    start++;
    messages = build();
    estimate = estimateTokens(messages, tools);
  }
  return { messages, dropped: start, estimate, budget, over: estimate > budget };
}

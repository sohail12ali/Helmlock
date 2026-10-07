// Pure rules for the work log, ported from lc-wms .kanban/core/worklog.py (clean_text, norm_category,
// _duplicate, _allocate_pool) and control-center console/server/worklog.py (allocate_hours).
import type { WorkLogEntry } from "@helmlock/core";
import { Category } from "@helmlock/core";

export const CATEGORIES = Category.options;
export const DEFAULT_CATEGORY = "Development";
export const DEFAULT_WEIGHT = 3;
export const DEFAULT_DAY_HOURS = 8;
export const STEP = 0.25;
export const MAX_TEXT = 160;
/** Same author, day and ticket and at least this similar = duplicate (F93). */
export const DUPLICATE_RATIO = 0.7;

export interface RuleError extends Error {
  rule: string;
  fix?: string;
  file?: string;
}
export const ruleError = (rule: string, message: string, fix?: string, file?: string): RuleError => Object.assign(new Error(message), { rule, fix, file });

/** Symbols the timesheet will not carry (lc-wms _BANNED_TEXT): ; : | * # em and en dashes, apostrophes. */
const BANNED_SYMBOLS = /[;:|*#—–'‘’`]/;
/** Agent, host and skill words. The log is a timesheet for people (F93). */
const BANNED_WORDS = [
  "agent",
  "agents",
  "subagent",
  "subagents",
  "skill",
  "skills",
  "claude",
  "cursor",
  "codex",
  "copilot",
  "chatgpt",
  "gpt",
  "llm",
  "dispatcher",
  "analyst",
  "planner",
  "builder",
  "verifier",
  "fixer",
  "deployer",
];

/** One plain sentence: trimmed, single spaced, at most 160 characters, no banned symbols or agent words. */
export function cleanText(text: string): string {
  const t = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  if (!t) throw ruleError("worklog-text", "an entry needs one sentence saying what was done", 'hl log-work T-014-sa "Wrote the format map"');
  const sym = BANNED_SYMBOLS.exec(t);
  if (sym) throw ruleError("worklog-text", `the text contains "${sym[0]}"; work log text takes no ; : | * # dashes or apostrophes`, 'join clauses with "and"');
  if (t.length > MAX_TEXT) throw ruleError("worklog-text", `the text is ${t.length} characters; keep it to ${MAX_TEXT}`, "write one shorter sentence");
  const words = t.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const hit = words.find((w) => BANNED_WORDS.includes(w));
  if (hit)
    throw ruleError(
      "worklog-text",
      `the text names "${hit}"; the work log is a timesheet for people, so no agent, tool or skill names`,
      "say what was done, not who or what did it",
    );
  return t;
}

export function normCategory(value: string | undefined): WorkLogEntry["category"] {
  if (!value) return DEFAULT_CATEGORY;
  const hit = CATEGORIES.find((c) => c.toLowerCase() === value.trim().toLowerCase());
  if (!hit) throw ruleError("worklog-category", `"${value}" is not a category`, `use one of ${CATEGORIES.join(", ")}`);
  return hit;
}

export const roundQuarter = (h: number) => Math.round(h / STEP) * STEP;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

const normWords = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Similarity in [0, 1]: the higher of a normalized Levenshtein ratio over the lowercased words
 * (catches small edits) and the token-set Jaccard index (catches reordered words).
 */
export function similarity(a: string, b: string): number {
  const wa = normWords(a);
  const wb = normWords(b);
  const sa = wa.join(" ");
  const sb = wb.join(" ");
  if (!sa && !sb) return 1;
  const lev = 1 - levenshtein(sa, sb) / Math.max(sa.length, sb.length);
  const A = new Set(wa);
  const B = new Set(wb);
  const inter = [...A].filter((w) => B.has(w)).length;
  const jac = inter / (A.size + B.size - inter || 1);
  return Math.max(lev, jac);
}

export function findDuplicate<E extends { ticket: string; text: string }>(entries: readonly E[], ticket: string, text: string): E | undefined {
  return entries.find((e) => e.ticket === ticket && similarity(e.text, text) >= DUPLICATE_RATIO);
}

export interface Allocation {
  hours: number[];
  total: number;
  pinned: number;
  /** Day length used: the larger of day_hours and the pinned total. */
  length: number;
  /** True when pinned hours left no room, so each flexible entry got the minimum step. */
  inferred_length: boolean;
}

/**
 * Split a day across its entries (lc-wms _allocate_pool). Pinned hours stand; the rest of the day is
 * shared by weight, then rounded to quarter hours by largest remainder so the parts sum exactly.
 */
export function allocate(entries: readonly { weight?: number; hours?: number }[], dayHours = DEFAULT_DAY_HOURS): Allocation {
  const pinned = entries.reduce((s, e) => s + (e.hours ?? 0), 0);
  const flexIdx = entries.flatMap((e, i) => (e.hours === undefined ? [i] : []));
  let length = Math.max(dayHours, pinned);
  let remaining = length - pinned;
  let inferred = false;
  if (flexIdx.length && remaining < STEP * flexIdx.length) {
    remaining = STEP * flexIdx.length;
    length = pinned + remaining;
    inferred = true;
  }
  const hours = entries.map((e) => e.hours ?? 0);
  if (flexIdx.length) {
    const steps = Math.round(remaining / STEP);
    const weights = flexIdx.map((i) => Math.max(1, entries[i]?.weight ?? DEFAULT_WEIGHT));
    const totalW = weights.reduce((s, w) => s + w, 0);
    const raw = weights.map((w) => (steps * w) / totalW);
    const base = raw.map((x) => Math.floor(x));
    const left = steps - base.reduce((s, x) => s + x, 0);
    const order = raw.map((_, k) => k).sort((x, y) => raw[y]! - base[y]! - (raw[x]! - base[x]!) || weights[y]! - weights[x]! || x - y);
    for (const k of order.slice(0, left)) base[k] = base[k]! + 1;
    flexIdx.forEach((i, k) => {
      hours[i] = base[k]! * STEP;
    });
  }
  const total = hours.reduce((s, h) => s + h, 0);
  return { hours, total, pinned, length, inferred_length: inferred };
}

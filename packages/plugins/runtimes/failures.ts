// Run failure classification, pure. Ported from control-center console/server/run_failures.py (classify),
// whose markers come from Paperclip (MIT, Copyright (c) 2025 Paperclip AI)
// packages/adapters/claude-local/src/server/parse.ts. See THIRD_PARTY_NOTICES.md.
// Markers are applied only to the terminal fields of a FAILED run, never to assistant prose.

export const FAILURE_CLASSES = [
  "auth_required",
  "model_not_found",
  "max_turns",
  "unknown_session",
  "poisoned_session",
  "image_error",
  "refusal",
  "quota",
  "transient_upstream",
  "process_lost",
  "output_cap",
  "stalled",
  "timeout",
  "cancelled",
  "protected-path-write",
  "unclassified",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** The only classes a retry may follow; everything else is final. */
export const RETRYABLE: ReadonlySet<string> = new Set(["quota", "transient_upstream", "max_turns", "process_lost"]);

const LOGIN =
  /not\s+logged\s+in|please\s+log\s+in|please\s+run\s+(?:`?claude\s+login`?|\/login)|login\s+required|requires\s+login|unauthorized|authentication\s+required|invalid\s+api\s+key/i;
const AUTH_TOKEN =
  /authentication[_\s-](?:failed|error)|failed\s+to\s+authenticate|invalid\s+bearer\s+token|(?:invalid|expired|revoked)[\s\S]{0,40}(?:bearer|oauth|access)\s+token|(?:bearer|oauth|access)\s+token[\s\S]{0,40}(?:is\s+)?(?:invalid|expired|revoked)/i;
const MODEL = /model[\s_-]*(?:not[\s_-]*found|does not exist|unknown|invalid)|unknown[\s_-]*model|cannot use this model/i;
const UNKNOWN_SESSION =
  /no conversation found with session id|unknown session|session .* not found|not a valid UUID|--resume requires a valid session|is not a UUID|does not match any session title|unknown\s+chat|chat\s+.*\s+not\s+found|could\s+not\s+resume/i;
const POISONED = /diagnostics\.previous_message_id.*starts with `msg_`/i;
const IMAGE = /could not process image/i;
const QUOTA =
  /you(?:'|’)ve\s+hit\s+your\s+(?:\w+\s+)?limit|session\s+limit\s+(?:reached|exceeded)|out\s+of\s+extra\s+usage|extra\s+usage\b|claude\s+usage\s+limit\s+reached|5[-\s]?hour\s+limit\s+reached|weekly\s+limit\s+reached|usage\s+limit\s+reached|usage\s+cap\s+reached|servicequotaexceededexception|at\s+capacity|capacity\s+limit/i;
const TRANSIENT =
  /rate[-\s]?limit(?:ed)?|rate_limit_error|too\s+many\s+requests|\b429\b|overloaded(?:_error)?|server\s+overloaded|service\s+unavailable|\b503\b|\b529\b|high\s+demand|try\s+again\s+later|temporarily\s+unavailable|temporary\s+errors|throttl(?:ed|ing)|throttlingexception/i;

/** The final result line of a turn, as either CLI wrote it. */
export interface TurnEnd {
  subtype?: string;
  is_error?: boolean;
  result?: string;
  error?: string;
  errors?: unknown[];
  stop_reason?: string;
  api_error_status?: number | null;
}

export interface Verdict {
  class: FailureClass | "";
  retryable: boolean;
  detail: string;
}

const verdict = (cls: FailureClass | "", detail = ""): Verdict => ({ class: cls, retryable: RETRYABLE.has(cls), detail: detail.trim().slice(0, 200) });

function failed(te: TurnEnd | undefined, exitCode: number | null): boolean {
  if (exitCode) return true;
  if (!te) return true;
  return Boolean(te.is_error) || (te.subtype ?? "success") !== "success";
}

/** One failure class for a finished run; class "" when the run did not fail. */
export function classify(te: TurnEnd | undefined, exitCode: number | null, stderrTail = ""): Verdict {
  const stop = (te?.stop_reason ?? "").toLowerCase();
  const refused = stop === "refusal" || (te?.subtype ?? "").toLowerCase() === "refusal";
  const isFailed = failed(te, exitCode);
  if (!isFailed && !refused) return verdict("");
  const text = [te?.result ?? "", te?.error ?? "", ...(te?.errors ?? []).map((e) => (typeof e === "string" ? e : JSON.stringify(e)))]
    .filter(Boolean)
    .join("\n");
  const detail = text || stderrTail.trim() || `exit ${exitCode}`;
  const wide = `${text}\n${stderrTail}`;
  const status = te?.api_error_status;
  if (isFailed) {
    if (status === 401 || LOGIN.test(wide) || AUTH_TOKEN.test(text)) return verdict("auth_required", detail);
    if (MODEL.test(wide)) return verdict("model_not_found", detail);
    if (te?.subtype === "error_max_turns" || stop === "max_turns" || stop === "error_max_turns") return verdict("max_turns", detail);
    if (UNKNOWN_SESSION.test(wide)) return verdict("unknown_session", detail);
    if (POISONED.test(wide)) return verdict("poisoned_session", detail);
    if (IMAGE.test(wide)) return verdict("image_error", detail);
  }
  if (refused) return verdict("refusal", detail);
  if (QUOTA.test(wide)) return verdict("quota", detail);
  if ((status !== null && status !== undefined && [429, 503, 529].includes(status)) || TRANSIENT.test(wide)) return verdict("transient_upstream", detail);
  if (!te) return verdict("process_lost", detail);
  return verdict("unclassified", detail);
}

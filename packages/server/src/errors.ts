// The error envelope shared with the CLI: { ok: false, error: { rule, message, file?, fix? } }.
import type { ApiResponse } from "@helmlock/core";

export type ErrorBody = Extract<ApiResponse<never>, { ok: false }>["error"];

export class ApiError extends Error {
  readonly status: number;
  readonly rule: string;
  readonly fix: string | undefined;
  readonly file: string | undefined;
  constructor(status: number, rule: string, message: string, extra: { fix?: string; file?: string } = {}) {
    super(message);
    this.status = status;
    this.rule = rule;
    this.fix = extra.fix;
    this.file = extra.file;
  }
}

/** HTTP status for a rule thrown by a service (HlError and friends carry `rule`). */
const STATUS_BY_RULE: Record<string, number> = {
  "unknown-ticket": 404,
  "unknown-record": 404,
  "unknown-artifact": 404,
  "not-found": 404,
  "bad-id": 400,
  "bad-request": 400,
  "path-outside-ticket": 400,
  "too-large": 413,
};

/** Map any thrown value to a status and an error body. Unknown errors keep their message but no stack. */
export function toErrorBody(e: unknown): { status: number; error: ErrorBody } {
  const err = e as Partial<ApiError> & { message?: string };
  const rule = typeof err?.rule === "string" ? err.rule : "internal";
  const status = e instanceof ApiError ? e.status : (STATUS_BY_RULE[rule] ?? 500);
  const error: ErrorBody = { rule, message: err?.message ?? String(e) };
  if (err?.file) error.file = err.file;
  if (err?.fix) error.fix = err.fix;
  return { status, error };
}

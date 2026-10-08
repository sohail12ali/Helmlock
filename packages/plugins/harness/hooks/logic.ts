// Pure logic of the hook scripts (importable by tests; the scripts themselves run on import).
// Envelopes from lc-wms .cursor/hooks/*.py (Claude SessionStart hookSpecificOutput.additionalContext, Cursor
// additional_context, Stop decision/followup_message), control-center hooks/pretooluse.py (PreToolUse verdict),
// and lc-wms remind_log_work.py (when to remind).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { type Host, type Payload, readText } from "./common.ts";

export const MAX_CONTEXT = 2000;

export function sessionEnvelope(host: Host, context: string): unknown {
  return host === "claude" ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } } : { additional_context: context };
}

// ---------- post-edit
export interface Finding {
  level?: string;
  rule?: string;
  message?: string;
  file?: string;
  fix?: string;
}

/** Infrastructure failures of hl itself never block an edit. */
const NOT_A_FINDING = new Set(["unknown-verb", "bad-input", "error", "unknown-author", "pending-service"]);

export function editedFile(p: Payload): string | undefined {
  const ti = p.tool_input && typeof p.tool_input === "object" ? (p.tool_input as Record<string, unknown>) : {};
  const f = ti.file_path ?? ti.notebook_path ?? p.file_path;
  return typeof f === "string" && f ? f : undefined;
}

/** Findings from `hl validate --json` output: an array, {findings}, {data: {findings}} or a failed verb's error. */
export function findingsFrom(stdout: string): Finding[] {
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (Array.isArray(v)) return v as Finding[];
  const o = (v ?? {}) as { findings?: unknown; data?: { findings?: unknown }; ok?: boolean; error?: Finding };
  if (Array.isArray(o.findings)) return o.findings as Finding[];
  if (Array.isArray(o.data?.findings)) return o.data.findings as Finding[];
  if (o.ok === false && o.error && !NOT_A_FINDING.has(o.error.rule ?? "error")) return [{ level: "error", ...o.error }];
  return [];
}

export function editMessage(file: string, errors: Finding[]): string {
  const lines = errors.map((f) => `- [${f.rule ?? "validate"}] ${f.message ?? ""}${f.fix ? ` (fix: ${f.fix})` : ""}`);
  return `hl validate found problems in ${file}:\n${lines.join("\n")}\nState files change only through hl verbs; fix the file or undo the edit.`;
}

// ---------- stop
const WRITE_TOOLS = /"name"\s*:\s*"(?:Edit|Write|MultiEdit|NotebookEdit)"/;
const LOGGED = /hl(?:\.ts)?["\s]+log-work|\/log-work\b/;

export function stopText(policyFile: string): string | undefined {
  if (!existsSync(policyFile)) return undefined;
  const t = parse(readText(policyFile)) as { hooks?: { event?: string; text?: string }[] };
  return t.hooks?.find((h) => h.event === "stop" && typeof h.text === "string")?.text;
}

/** undefined = no transcript to judge by. */
export function transcriptVerdict(p: Payload): { wrote: boolean; logged: boolean } | undefined {
  const f = typeof p.transcript_path === "string" ? p.transcript_path : undefined;
  if (!f || !existsSync(f)) return undefined;
  const t = readText(f);
  return { wrote: WRITE_TOOLS.test(t), logged: LOGGED.test(t) };
}

/** True when this stop is a repeat, an aborted turn, or otherwise must stay silent. */
export function stopIsQuiet(p: Payload): boolean {
  if (p.stop_hook_active === true) return true;
  if (typeof p.loop_count === "number" && p.loop_count > 0) return true;
  return typeof p.status === "string" && ["aborted", "error"].includes(p.status);
}

export function stopEnvelope(host: Host, msg: string): unknown {
  return host === "claude" ? { decision: "block", reason: msg } : { followup_message: msg };
}

// ---------- pretool
export type Decision = "allow" | "ask" | "deny";

const prefix = (p: string) => p.replace(/^(?:Bash|Shell)\((.*?)(?::\*)?\)$/, "$1").trim();

/** Split on shell separators so `cd x && git push` is still caught; drop leading VAR=value. */
export function segments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ""))
    .filter(Boolean);
}

export function decide(command: string, policy: { ask?: string[]; deny_shell?: string[] }): { decision: Decision; reason: string } {
  const starts = (seg: string, p: string) => seg === p || seg.startsWith(`${p} `);
  for (const seg of segments(command)) {
    const d = (policy.deny_shell ?? []).map(prefix).find((p) => starts(seg, p));
    if (d) return { decision: "deny", reason: `"${d}" is denied by harness.toml` };
  }
  for (const seg of segments(command)) {
    const a = (policy.ask ?? []).map(prefix).find((p) => starts(seg, p));
    if (a) return { decision: "ask", reason: `"${a}" needs a person's OK (harness.toml ask)` };
  }
  return { decision: "allow", reason: "" };
}

export function shellEnvelope(host: Host, d: Decision, reason: string): unknown {
  if (host === "claude") return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d, permissionDecisionReason: reason } };
  return { permission: d, user_message: reason, agent_message: reason, userMessage: reason, agentMessage: reason };
}

export function commandOf(p: Payload): string | undefined {
  if (typeof p.command === "string") return p.command;
  const ti = p.tool_input && typeof p.tool_input === "object" ? (p.tool_input as Record<string, unknown>) : {};
  return typeof ti.command === "string" ? ti.command : undefined;
}

// ---------- pretool, server mode
/** permissions.deny_shell from every <root>/harness/harness.toml (a union; unreadable layers are skipped). */
export function denyShellOf(roots: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of roots) {
    const f = join(r, "harness", "harness.toml");
    if (!existsSync(f)) continue;
    try {
      const d = (parse(readText(f)) as { permissions?: { deny_shell?: unknown } }).permissions?.deny_shell;
      if (Array.isArray(d)) for (const x of d) if (typeof x === "string") out.add(x);
    } catch {
      /* skipped */
    }
  }
  return [...out];
}

export const HOOK_TOKEN_HEADER = "X-Helmlock-Hook-Token";

/**
 * POST the tool call to the console and wait for a person (control-center hooks/pretooluse.py). Fail-closed: a missing
 * URL, token or run id, a network error, a timeout, a non-2xx answer or an unreadable body all deny.
 */
export async function askServer(
  p: Payload,
  o: { url: string | undefined; token: string | undefined; runId: string | undefined; timeoutMs: number },
): Promise<{ decision: "allow" | "deny"; reason: string }> {
  const deny = (reason: string) => ({ decision: "deny" as const, reason: `${reason}; denied fail-closed` });
  if (!o.url || !o.token) return deny("HL_SERVER_URL or HL_HOOK_TOKEN is not set");
  if (!o.runId) return deny("HL_RUN_ID is not set");
  const body = {
    run_id: o.runId,
    tool_name: typeof p.tool_name === "string" ? p.tool_name : "",
    tool_input: p.tool_input ?? {},
    ...(typeof p.tool_use_id === "string" ? { tool_use_id: p.tool_use_id } : {}),
  };
  let res: Response;
  try {
    res = await fetch(new URL("/api/v1/hooks/pretooluse", o.url), {
      method: "POST",
      headers: { "content-type": "application/json", [HOOK_TOKEN_HEADER]: o.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs),
    });
  } catch (e) {
    return deny(`the Helmlock console is unreachable (${(e as Error).name})`);
  }
  let v: unknown;
  try {
    v = await res.json();
  } catch {
    return deny(`the Helmlock console answered ${res.status} without JSON`);
  }
  const env = (v ?? {}) as {
    ok?: boolean;
    data?: { decision?: unknown; reason?: unknown };
    decision?: unknown;
    reason?: unknown;
    error?: { message?: string };
  };
  if (!res.ok || env.ok === false) return deny(`the Helmlock console refused the hook call (${res.status}: ${env.error?.message ?? "error"})`);
  const d = env.data ?? env;
  const reason = typeof d.reason === "string" ? d.reason : "";
  if (d.decision === "allow") return { decision: "allow", reason };
  return { decision: "deny", reason: reason || "denied by a person" };
}

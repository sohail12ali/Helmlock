// Shared plumbing for the hook scripts. One script per hook, `--host claude|cursor` picks the JSON envelope
// (lc-wms .cursor/hooks pattern). A hook never breaks the session: on an internal error it prints nothing and
// exits 0, except pretool, which fails closed (deny).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type Host = "claude" | "cursor";
export type Payload = Record<string, unknown>;

export interface HookArgs {
  host: Host;
  /** Every `--policy` in order: the system harness.toml first, then the workspace's, in a knowledge repo. */
  policies: string[];
  /** hl arguments after `--`. */
  hl: string[];
}

export function parseArgs(argv: string[]): HookArgs {
  const dd = argv.indexOf("--");
  const own = dd >= 0 ? argv.slice(0, dd) : argv;
  const hl = dd >= 0 ? argv.slice(dd + 1) : [];
  const get = (k: string) => {
    const i = own.indexOf(k);
    return i >= 0 ? own[i + 1] : undefined;
  };
  const host = get("--host") === "cursor" ? "cursor" : "claude";
  const policies = own.flatMap((a, i) => (a === "--policy" && own[i + 1] ? [own[i + 1] as string] : []));
  return { host, hl, policies };
}

export async function readPayload(): Promise<Payload> {
  if (process.stdin.isTTY) return {};
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  if (!text.trim()) return {};
  const v = JSON.parse(text) as unknown;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : {};
}

/**
 * The Cursor CLI also loads Claude-format hooks, so a hook may fire twice. Each hook is emitted to one place per
 * host; a script called for the other host's payload stays silent.
 */
export function isForeign(host: Host, p: Payload): boolean {
  const ev = typeof p.hook_event_name === "string" ? p.hook_event_name : "";
  if (host === "claude") return "cursor_version" in p || "workspace_roots" in p || /^[a-z]/.test(ev);
  return /^[A-Z]/.test(ev);
}

export function projectDir(p: Payload): string {
  const roots = Array.isArray(p.workspace_roots) ? (p.workspace_roots as unknown[]) : [];
  const first = roots.find((r): r is string => typeof r === "string");
  const fromCursor = first?.replace(/^\/([a-zA-Z]):\//, "$1:/");
  return process.env.CLAUDE_PROJECT_DIR || fromCursor || (typeof p.cwd === "string" ? p.cwd : "") || process.cwd();
}

export function resolvePolicy(p: Payload, policy: string): string {
  return isAbsolute(policy) ? policy : join(projectDir(p), policy);
}

/** Delivery root: hooks live in <delivery>/packages/plugins/harness/hooks. */
export const DELIVERY = resolve(import.meta.dirname, "../../../..");

export interface HlResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `hl <args>` with node (HL_HOOK_HL overrides the script, for tests). */
export function runHl(args: string[], cwd: string, timeoutMs = 25000): Promise<HlResult> {
  const script = process.env.HL_HOOK_HL ?? join(DELIVERY, "packages", "cli", "bin", "hl.ts");
  return new Promise((res) => {
    execFile(process.execPath, [script, ...args], { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code as number) : 1) : 0;
      res({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export function print(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

export function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/** Run a hook body; on an internal error do `onError` (default: print nothing) and exit 0. */
export async function guarded(body: () => Promise<number | undefined>, onError?: (e: unknown) => void): Promise<void> {
  try {
    process.exitCode = (await body()) ?? 0;
  } catch (e) {
    if (process.env.HL_HOOK_DEBUG) process.stderr.write(`${(e as Error).stack}\n`);
    onError?.(e);
    process.exitCode = 0;
  }
}

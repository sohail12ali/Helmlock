// Child processes for the loop's shell, hl and grep tools: no implicit shell (cmd /d /s /c on Windows, /bin/sh -c
// elsewhere, spawned explicitly), a timeout, output capped to head + tail, and a tree kill on timeout or cancel.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { killTree } from "../runtimes/spawn.ts";

export interface ProcResult {
  code: number | null;
  out: string;
  timedOut: boolean;
  /** Set when the program could not be started (e.g. ENOENT). */
  spawnError?: string;
}

export interface ProcOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Output kept: the first part and the last 4 KB. */
  maxChars?: number;
  verbatim?: boolean;
}

export const OUTPUT_MAX = 30_000;
const TAIL = 4_000;

/** Collects interleaved stdout and stderr, keeping the head and a rolling tail. */
class Capped {
  head = "";
  tail = "";
  dropped = 0;
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  add(s: string): void {
    const room = this.max - TAIL - this.head.length;
    if (room > 0) {
      this.head += s.slice(0, room);
      s = s.slice(room);
    }
    if (!s) return;
    this.tail += s;
    if (this.tail.length > TAIL) {
      this.dropped += this.tail.length - TAIL;
      this.tail = this.tail.slice(-TAIL);
    }
  }
  text(): string {
    return this.dropped ? `${this.head}\n[... ${this.dropped} characters cut ...]\n${this.tail}` : this.head + this.tail;
  }
}

export function runProcess(file: string, args: string[], o: ProcOptions): Promise<ProcResult> {
  const isWin = process.platform === "win32";
  return new Promise((resolveP) => {
    const out = new Capped(o.maxChars ?? OUTPUT_MAX);
    let timedOut = false;
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        cwd: o.cwd,
        env: o.env,
        windowsHide: true,
        windowsVerbatimArguments: Boolean(o.verbatim),
        detached: !isWin,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolveP({ code: null, out: "", timedOut: false, spawnError: (e as Error).message });
      return;
    }
    const finish = (r: ProcResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
      resolveP(r);
    };
    child.stdout?.setEncoding("utf8").on("data", (d: string) => out.add(d));
    child.stderr?.setEncoding("utf8").on("data", (d: string) => out.add(d));
    const timer = setTimeout(() => {
      timedOut = true;
      void killTree(child, 1000);
    }, o.timeoutMs);
    const onAbort = () => void killTree(child, 500);
    o.signal?.addEventListener("abort", onAbort);
    child.on("error", (e) => finish({ code: null, out: out.text(), timedOut, spawnError: e.message }));
    child.on("close", (code) => finish({ code, out: out.text(), timedOut }));
  });
}

/** A shell command line: cmd.exe /d /s /c on Windows, /bin/sh -c elsewhere. */
export function runShell(command: string, o: ProcOptions): Promise<ProcResult> {
  if (process.platform === "win32") {
    const cmd = o.env.ComSpec ?? o.env.COMSPEC ?? join(o.env.SystemRoot ?? process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    return runProcess(cmd, ["/d", "/s", "/c", `"${command}"`], { ...o, verbatim: true });
  }
  return runProcess("/bin/sh", ["-c", command], o);
}

/** Splits an hl command line into arguments ("double", 'single' quotes and backslash-escaped quotes). */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === "\\" && quote === '"' && (line[i + 1] === '"' || line[i + 1] === "\\")) {
        cur += line[++i];
      } else if (c === quote) quote = undefined;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (has || cur) out.push(cur);
  return out;
}

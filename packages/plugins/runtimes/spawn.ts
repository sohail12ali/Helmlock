// Child process spawning for agent CLIs, shared by every runtime adapter.
// Ported from Paperclip (MIT, Copyright (c) 2025 Paperclip AI):
//   packages/adapter-utils/src/server-utils.ts (resolveCommandPath, quoteForCmd, resolveWindowsCmdShell,
//   runChildProcess, terminal-result cleanup, MAX_CAPTURE_BYTES, Claude nesting env strip)
// and from control-center console/server (procs.py kill_tree and iter_capped_lines, run_config.py env_strip,
// run_watchdog.py silence measured from the last output). See THIRD_PARTY_NOTICES.md.
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";

export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
export const MAX_LINE_CHARS = 1024 * 1024;
export const MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;
export const LINE_TRUNCATED = " ...[line truncated]";

/** Session identity and nesting variables (control-center DEFAULT_ENV_STRIP). Never auth variables. */
export const ENV_STRIP = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION",
  "CLAUDE_CODE_PARENT_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
] as const;

const isWin = process.platform === "win32";

export function cleanEnv(base: Record<string, string | undefined>, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !(ENV_STRIP as readonly string[]).includes(k)) out[k] = v;
  return { ...out, ...extra };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, isWin ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH lookup with PATHEXT on Windows (Paperclip resolveCommandPath). */
export async function resolveCommand(command: string, env: Record<string, string | undefined> = process.env, cwd = process.cwd()): Promise<string | null> {
  if (command.includes("/") || command.includes("\\")) {
    const abs = isAbsolute(command) ? command : resolve(cwd, command);
    return (await pathExists(abs)) ? abs : null;
  }
  const pathValue = env.PATH ?? env.Path ?? "";
  const exts = isWin ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  const hasExt = isWin && extname(command).length > 0;
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    const candidates = isWin ? (hasExt ? [join(dir, command)] : exts.map((e) => join(dir, `${command}${e}`))) : [join(dir, command)];
    for (const c of candidates) if (await pathExists(c)) return c;
  }
  return null;
}

/** Quote one argument for a cmd.exe command line (Paperclip quoteForCmd). */
export function quoteForCmd(arg: string): string {
  if (!arg.length) return '""';
  const escaped = arg.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

export interface SpawnTarget {
  command: string;
  args: string[];
  verbatim: boolean;
}

/** A .cmd/.bat shim runs through cmd.exe /d /s /c "<line>" with verbatim arguments; anything else is spawned directly. */
export function spawnTarget(executable: string, args: string[], env: Record<string, string | undefined> = process.env): SpawnTarget {
  if (isWin && /\.(cmd|bat)$/i.test(executable)) {
    const shell = join(env.SystemRoot ?? process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    const line = [quoteForCmd(executable), ...args.map(quoteForCmd)].join(" ");
    return { command: shell, args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
  }
  return { command: executable, args, verbatim: false };
}

const run = (file: string, args: string[]) =>
  new Promise<number | null>((res) => {
    execFile(file, args, { windowsHide: true }, (err) => res(err ? ((err as { code?: number }).code ?? 1) : 0));
  });

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * End a process and its descendants: ask, wait `graceMs`, force (control-center kill_tree).
 * Windows: taskkill /T, then /T /F. taskkill /F often exits 1 because conhost cannot be terminated
 * even though the tree is gone, so the exit code is ignored and the exit event decides.
 */
export async function killTree(child: ChildProcess, graceMs = 3000): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((r) => child.once("close", () => r()));
  const wait = (ms: number) => Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
  if (isWin) {
    await run("taskkill", ["/PID", String(pid), "/T"]);
    if (await wait(graceMs)) return;
    await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    await wait(5000);
    return;
  }
  for (const [sig, ms] of [
    ["SIGTERM", graceMs],
    ["SIGKILL", 5000],
  ] as const) {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* gone */
      }
    }
    if (await wait(ms)) return;
  }
}

export interface ProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Written to stdin, then stdin is closed. The prompt always travels this way, never on the command line. */
  stdin: string;
  /** Keep stdin open after writing `stdin` (a live session takes more lines with write(); endStdin() closes it). */
  keepStdinOpen?: boolean;
  timeoutSec?: number;
  /** Kill after this many seconds without any output (measured from the last output). */
  silenceSec?: number;
  /** After `isTerminal` saw the final line, kill a process that lingers this long. */
  lingerMs?: number;
  graceMs?: number;
  onLine(stream: "stdout" | "stderr", line: string): void;
  isTerminal?(line: string): boolean;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stalled: boolean;
  outputCapped: boolean;
  lingerKilled: boolean;
  cancelled: boolean;
  stderrTail: string;
  pid: number | undefined;
}

export interface ProcessHandle {
  pid: number | undefined;
  cancel(): Promise<void>;
  /** Write to an open stdin (keepStdinOpen); false when it is closed or the process is gone. */
  write(text: string): boolean;
  /** Close stdin: how a live session asks the CLI to exit. */
  endStdin(): void;
  done: Promise<ProcessResult>;
}

/** Line splitter with a per-line cap (control-center iter_capped_lines). */
function lineSplitter(emit: (line: string) => void) {
  let buf = "";
  let dropping = false;
  return {
    push(chunk: string) {
      buf += chunk;
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (dropping) dropping = false;
        else emit(line);
      }
      if (buf.length > MAX_LINE_CHARS) {
        if (!dropping) emit(buf.slice(0, MAX_LINE_CHARS) + LINE_TRUNCATED);
        dropping = true;
        buf = "";
      }
    },
    flush() {
      if (buf && !dropping) emit(buf.replace(/\r$/, ""));
      buf = "";
    },
  };
}

/** Spawn with shell:false, prompt on stdin, caps, silence watchdog, timeout, linger kill and tree kill (Paperclip runChildProcess). */
export function startProcess(o: ProcessOptions): ProcessHandle {
  const target = spawnTarget(o.command, o.args, o.env);
  const child = spawn(target.command, target.args, {
    cwd: o.cwd,
    env: o.env,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: target.verbatim,
    detached: !isWin,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = { timedOut: false, stalled: false, outputCapped: false, lingerKilled: false, cancelled: false };
  let total = 0;
  let stderrTail = "";
  let lastOutput = Date.now();
  let terminalSeen = false;
  let lingerTimer: NodeJS.Timeout | undefined;
  let killing: Promise<void> | undefined;
  const kill = () => {
    killing ??= killTree(child, o.graceMs ?? 3000);
    return killing;
  };

  const handle = (stream: "stdout" | "stderr") =>
    lineSplitter((line) => {
      if (stream === "stderr") stderrTail = `${stderrTail}${line}\n`.slice(-4000);
      o.onLine(stream, line);
      if (stream === "stdout" && !terminalSeen && o.isTerminal?.(line)) {
        terminalSeen = true;
        if (o.lingerMs !== undefined)
          lingerTimer = setTimeout(() => {
            state.lingerKilled = true;
            void kill();
          }, o.lingerMs);
      }
    });
  const out = handle("stdout");
  const err = handle("stderr");
  const onData = (split: ReturnType<typeof lineSplitter>) => (chunk: Buffer) => {
    lastOutput = Date.now();
    total += chunk.length;
    if (total > MAX_TOTAL_OUTPUT_BYTES) {
      if (!state.outputCapped) {
        state.outputCapped = true;
        void kill();
      }
      return;
    }
    split.push(chunk.toString("utf8"));
  };
  child.stdout?.on("data", onData(out));
  child.stderr?.on("data", onData(err));

  const timers: NodeJS.Timeout[] = [];
  if (o.timeoutSec && o.timeoutSec > 0)
    timers.push(
      setTimeout(() => {
        state.timedOut = true;
        void kill();
      }, o.timeoutSec * 1000),
    );
  if (o.silenceSec && o.silenceSec > 0) {
    const ms = o.silenceSec * 1000;
    const tick = setInterval(
      () => {
        if (Date.now() - lastOutput >= ms && !terminalSeen) {
          state.stalled = true;
          void kill();
        }
      },
      Math.min(1000, ms),
    );
    timers.push(tick);
  }

  let stdinOpen = Boolean(o.keepStdinOpen);
  child.stdin?.on("error", () => {
    stdinOpen = false;
  });
  if (o.keepStdinOpen) child.stdin?.write(o.stdin, "utf8");
  else child.stdin?.end(o.stdin, "utf8");

  const done = new Promise<ProcessResult>((res, rej) => {
    child.once("error", (e) => {
      for (const t of timers) clearTimeout(t);
      rej(new Error(`failed to start ${o.command}: ${e.message}`));
    });
    child.once("close", (code, signal) => {
      stdinOpen = false;
      for (const t of timers) clearTimeout(t);
      if (lingerTimer) clearTimeout(lingerTimer);
      out.flush();
      err.flush();
      res({ exitCode: code, signal, ...state, stderrTail, pid: child.pid });
    });
  });
  return {
    pid: child.pid,
    async cancel() {
      state.cancelled = true;
      await kill();
    },
    write(text) {
      if (!stdinOpen || !child.stdin || child.stdin.destroyed || child.exitCode !== null) return false;
      child.stdin.write(text, "utf8");
      return true;
    },
    endStdin() {
      if (!stdinOpen) return;
      stdinOpen = false;
      child.stdin?.end();
    },
    done,
  };
}

/** An async iterable fed by push(); end() finishes it. */
export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  end(): void {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

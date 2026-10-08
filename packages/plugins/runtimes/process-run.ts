// Turns one agent CLI process into a RunHandle: lines in, normalised RunEvents out, a classified result at the end.
import { randomBytes } from "node:crypto";
import type { RunEvent, RunHandle, RunOptions } from "@helmlock/core";
import { classify, type FailureClass, type TurnEnd } from "./failures.ts";
import { guardProtected } from "./protect.ts";
import { EventQueue, type ProcessResult, startProcess } from "./spawn.ts";

/** Parses one stdout line into events; keeps its own state between lines. */
export interface StreamNormalizer {
  line(line: string): RunEvent[];
  /** The final result line, as the CLI wrote it, for failure classification. */
  turnEnd(): TurnEnd | undefined;
  sessionId(): string | undefined;
}

export interface Attempt {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  prompt: string;
  timeoutSec?: number;
  silenceSec?: number;
  lingerMs?: number;
  normalizer: StreamNormalizer;
  /**
   * A live session (stdin held open, control-center LiveSession): every message, the prompt included, is encoded as
   * one stdin line and acknowledged by the CLI on stdout. A result line ends the run only when every message sent so
   * far was acknowledged; otherwise the CLI starts another turn for the late message and the run goes on.
   */
  live?: LiveProtocol;
}

export interface LiveProtocol {
  /** One stdin line (with its newline) carrying a user message. */
  encode(text: string): string;
  /** True for a stdout line that acknowledges a user message the CLI took in. */
  isAck(line: string): boolean;
}

export interface ProcessRunOptions {
  /** Run id chosen by the caller (the run manager); default a fresh one. */
  id?: string;
  /** Builds attempt n (0, 1, ...). Return undefined to stop retrying. */
  attempt(n: number, prev?: { failureClass: string; sessionId?: string }): Attempt | undefined;
  /** The handle gets steer(): messages go into a live attempt's stdin (Attempt.live). */
  steerable?: boolean;
  /** Failure classes that start the next attempt (e.g. unknown_session -> fresh session). */
  retryOn?: readonly string[];
  /** Workspace root and globs for the protected-path guard; omitted = no guard. */
  protect?: { root: string; globs?: readonly string[] };
}

export const newRunId = () => {
  const d = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `run-${d}-${randomBytes(2).toString("hex")}`;
};

/**
 * RunOptions plus what the run manager (server-started runs) adds. Not part of the frozen contract: adapters that
 * do not know a field ignore it.
 */
export interface ManagedRunOptions extends RunOptions {
  /** Use this id for the RunHandle, the run record and HL_RUN_ID. */
  runId?: string;
  /** Extra CLI arguments, e.g. `--settings <file>` with the PreToolUse approval hook. */
  extraArgs?: string[];
  /** A PreToolUse hook asks a person for gated tools: "ask" mode may then use the host's default permission mode. */
  approvalHook?: boolean;
  /** Milestone 8: hold stdin open so messages can steer the run (adapters with capabilities.steer only). */
  live?: boolean;
}

const isResultLine = (line: string) => line.startsWith("{") && /"type"\s*:\s*"result"/.test(line);

function classOf(r: ProcessResult): FailureClass | undefined {
  if (r.cancelled) return "cancelled";
  if (r.timedOut) return "timeout";
  if (r.stalled) return "stalled";
  if (r.outputCapped) return "output_cap";
  return undefined;
}

export async function startProcessRun(o: ProcessRunOptions): Promise<RunHandle> {
  const id = o.id ?? newRunId();
  const events = new EventQueue<RunEvent>();
  const guard = o.protect ? await guardProtected(o.protect.root, o.protect.globs) : undefined;
  let cancelCurrent: (() => Promise<void>) | undefined;
  let cancelled = false;
  /** Writes one more message into the live attempt; undefined when no live attempt is taking messages. */
  let liveWrite: ((text: string) => boolean) | undefined;

  const done = (async () => {
    let prev: { failureClass: string; sessionId?: string } | undefined;
    let last = { ok: false, exitCode: null as number | null, timedOut: false };
    for (let n = 0; ; n++) {
      const a = o.attempt(n, prev);
      if (!a || cancelled) break;
      const results: RunEvent[] = [];
      const live = a.live;
      // Messages written to stdin and not yet acknowledged; acks counts acknowledgements seen at all, so a CLI that
      // never acknowledges falls back to "the first result ends the run".
      let pending = live ? 1 : 0;
      let acks = 0;
      const proc = startProcess({
        command: a.command,
        args: a.args,
        cwd: a.cwd,
        env: a.env,
        stdin: live ? live.encode(a.prompt) : a.prompt,
        keepStdinOpen: Boolean(live),
        timeoutSec: a.timeoutSec,
        silenceSec: a.silenceSec,
        lingerMs: a.lingerMs ?? 5000,
        isTerminal(line) {
          if (!isResultLine(line)) return false;
          if (!live) return true;
          if (pending > 0 && acks > 0) return false; // a late message: the CLI runs another turn for it
          liveWrite = undefined;
          proc.endStdin();
          return true;
        },
        onLine(stream, line) {
          if (stream === "stderr") {
            if (line.trim()) events.push({ type: "stderr", text: line });
            return;
          }
          if (live?.isAck(line)) {
            pending = Math.max(0, pending - 1);
            acks++;
          }
          for (const ev of a.normalizer.line(line)) {
            if (ev.type === "result") results.push(ev);
            else events.push(ev);
          }
        },
      });
      cancelCurrent = proc.cancel;
      if (live)
        liveWrite = (text) => {
          if (!proc.write(live.encode(text))) return false;
          pending++;
          return true;
        };
      let r: ProcessResult;
      try {
        r = await proc.done;
      } catch (e) {
        liveWrite = undefined;
        events.push({ type: "result", ok: false, text: (e as Error).message, failureClass: "process_lost" });
        last = { ok: false, exitCode: null, timedOut: false };
        break;
      }
      liveWrite = undefined;
      const te = a.normalizer.turnEnd();
      // A result line that arrived means the work finished, even if the linger kill ended a hanging process.
      const exitCode = r.lingerKilled && te ? 0 : r.exitCode;
      let failureClass: string | undefined = classOf(r);
      if (r.lingerKilled) failureClass = te ? undefined : "process_lost";
      const verdict = classify(te, exitCode, r.stderrTail);
      failureClass ??= verdict.class || undefined;
      const sessionId = a.normalizer.sessionId();
      if (failureClass && o.retryOn?.includes(failureClass) && !cancelled) {
        events.push({ type: "stderr", text: `[hl] ${failureClass}: retrying with a fresh session` });
        prev = { failureClass, sessionId };
        continue;
      }
      let ok = !failureClass;
      let text = te?.result ?? (results.at(-1) as { text?: string } | undefined)?.text ?? verdict.detail;
      if (guard) {
        const touched = await guard.check();
        if (touched.length) {
          ok = false;
          failureClass = "protected-path-write";
          text = `protected files changed outside hl: ${touched.join(", ")}`;
        }
      }
      events.push({
        type: "result",
        ok,
        text: text ?? "",
        ...(sessionId ? { sessionId } : {}),
        ...(failureClass ? { failureClass } : {}),
      });
      last = { ok, exitCode, timedOut: r.timedOut };
      break;
    }
    events.end();
    return last;
  })();

  return {
    id,
    events,
    async cancel() {
      cancelled = true;
      await cancelCurrent?.();
    },
    ...(o.steerable
      ? {
          async steer(text: string) {
            if (!liveWrite?.(text)) throw Object.assign(new Error("the run is not taking messages any more"), { rule: "not-live" });
          },
        }
      : {}),
    done,
  };
}

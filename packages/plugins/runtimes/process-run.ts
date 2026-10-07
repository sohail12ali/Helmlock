// Turns one agent CLI process into a RunHandle: lines in, normalised RunEvents out, a classified result at the end.
import { randomBytes } from "node:crypto";
import type { RunEvent, RunHandle } from "@helmlock/core";
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
}

export interface ProcessRunOptions {
  /** Builds attempt n (0, 1, ...). Return undefined to stop retrying. */
  attempt(n: number, prev?: { failureClass: string; sessionId?: string }): Attempt | undefined;
  /** Failure classes that start the next attempt (e.g. unknown_session -> fresh session). */
  retryOn?: readonly string[];
  /** Workspace root and globs for the protected-path guard; omitted = no guard. */
  protect?: { root: string; globs?: readonly string[] };
}

export const newRunId = () => {
  const d = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `run-${d}-${randomBytes(2).toString("hex")}`;
};

const isResultLine = (line: string) => line.startsWith("{") && /"type"\s*:\s*"result"/.test(line);

function classOf(r: ProcessResult): FailureClass | undefined {
  if (r.cancelled) return "cancelled";
  if (r.timedOut) return "timeout";
  if (r.stalled) return "stalled";
  if (r.outputCapped) return "output_cap";
  return undefined;
}

export async function startProcessRun(o: ProcessRunOptions): Promise<RunHandle> {
  const id = newRunId();
  const events = new EventQueue<RunEvent>();
  const guard = o.protect ? await guardProtected(o.protect.root, o.protect.globs) : undefined;
  let cancelCurrent: (() => Promise<void>) | undefined;
  let cancelled = false;

  const done = (async () => {
    let prev: { failureClass: string; sessionId?: string } | undefined;
    let last = { ok: false, exitCode: null as number | null, timedOut: false };
    for (let n = 0; ; n++) {
      const a = o.attempt(n, prev);
      if (!a || cancelled) break;
      const results: RunEvent[] = [];
      const proc = startProcess({
        command: a.command,
        args: a.args,
        cwd: a.cwd,
        env: a.env,
        stdin: a.prompt,
        timeoutSec: a.timeoutSec,
        silenceSec: a.silenceSec,
        lingerMs: a.lingerMs ?? 5000,
        isTerminal: isResultLine,
        onLine(stream, line) {
          if (stream === "stderr") {
            if (line.trim()) events.push({ type: "stderr", text: line });
            return;
          }
          for (const ev of a.normalizer.line(line)) {
            if (ev.type === "result") results.push(ev);
            else events.push(ev);
          }
        },
      });
      cancelCurrent = proc.cancel;
      let r: ProcessResult;
      try {
        r = await proc.done;
      } catch (e) {
        events.push({ type: "result", ok: false, text: (e as Error).message, failureClass: "process_lost" });
        last = { ok: false, exitCode: null, timedOut: false };
        break;
      }
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
    done,
  };
}

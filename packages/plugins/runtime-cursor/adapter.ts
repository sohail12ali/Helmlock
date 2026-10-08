// Cursor CLI runtime adapter. Flags from Paperclip (MIT, Copyright (c) 2025 Paperclip AI)
// packages/adapters/cursor-local/src/server/execute.ts and lc-wms .kanban/agents/backends.py (mode ladder,
// --trust, --sandbox disabled on Windows, --workspace, --add-dir). See THIRD_PARTY_NOTICES.md.
// The prompt always goes on stdin: a .cmd re-exec truncates a command-line prompt at its first newline.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BinaryInfo, EngineCapabilities, RunMode, RunOptions, RuntimeAdapter } from "@helmlock/core";
import { type ManagedRunOptions, startProcessRun } from "../runtimes/process-run.ts";
import { DEFAULT_PROTECTED } from "../runtimes/protect.ts";
import { cleanEnv, resolveCommand, spawnTarget } from "../runtimes/spawn.ts";
import { createCursorNormalizer } from "./parse.ts";

/** Print mode reads the whole prompt from stdin and has no hook, so no steering and no approval cards. */
export const CURSOR_CAPABILITIES: EngineCapabilities = { resume: true, steer: false, approve: false, models: true };

/** Cursor spells each rung with its own flag; `--mode default` is rejected by the CLI. */
export const CURSOR_MODE_FLAGS: Record<RunMode, string[]> = {
  plan: ["--mode", "plan"],
  ask: ["--mode", "ask"],
  "auto-review": ["--auto-review"],
  force: ["--force"],
};

export function cursorArgs(o: RunOptions, platform: NodeJS.Platform = process.platform): string[] {
  const args = ["-p", "--output-format", "stream-json", "--trust"];
  if (platform === "win32") args.push("--sandbox", "disabled");
  args.push("--workspace", o.cwd, ...CURSOR_MODE_FLAGS[o.mode]);
  if (o.model) args.push("--model", o.model);
  if (o.resumeSessionId) args.push("--resume", o.resumeSessionId);
  for (const d of o.addDirs ?? []) args.push("--add-dir", d);
  return args;
}

/** PATH (cursor-agent, then agent only inside a cursor-agent folder), then %LOCALAPPDATA%\cursor-agent. */
export async function findCursor(env: Record<string, string | undefined> = process.env, command?: string): Promise<string | null> {
  const explicit = command ?? env.HL_CURSOR_BIN;
  if (explicit) return resolveCommand(explicit, env);
  const onPath = await resolveCommand("cursor-agent", env);
  if (onPath) return onPath;
  const agent = await resolveCommand("agent", env);
  if (agent && /cursor-agent/i.test(agent)) return agent;
  const local = env.LOCALAPPDATA;
  if (local) for (const n of ["agent.cmd", "cursor-agent.cmd"]) if (existsSync(join(local, "cursor-agent", n))) return join(local, "cursor-agent", n);
  const home = env.HOME ?? env.USERPROFILE;
  if (home && existsSync(join(home, ".local", "bin", "cursor-agent"))) return join(home, ".local", "bin", "cursor-agent");
  return null;
}

export interface CursorAdapterOptions {
  command?: string;
  env?: Record<string, string | undefined>;
  /** Post-run protected-path check; on by default because Cursor print mode ignores cli.json deny rules. */
  protect?: { root: string; globs?: readonly string[] } | false;
  lingerMs?: number;
}

export function createCursorAdapter(opts: CursorAdapterOptions = {}): RuntimeAdapter {
  const baseEnv = opts.env ?? process.env;
  const detect = async (): Promise<BinaryInfo | null> => {
    const command = await findCursor(baseEnv, opts.command);
    if (!command) return null;
    const t = spawnTarget(command, ["--version"], baseEnv);
    const version = await new Promise<string | undefined>((res) =>
      execFile(t.command, t.args, { windowsHide: true, windowsVerbatimArguments: t.verbatim, timeout: 15000 }, (err, out) => res(err ? undefined : out.trim())),
    );
    return version ? { command, version } : { command };
  };
  return {
    id: "cursor",
    label: "Cursor CLI",
    capabilities: CURSOR_CAPABILITIES,
    detect,
    async test() {
      const bin = await detect();
      if (!bin) return { ok: false, checks: [{ level: "error", message: "Cursor CLI not found (install cursor-agent or set HL_CURSOR_BIN)" }] };
      // There is no cheap, non-interactive sign-in probe that is stable across Cursor CLI builds.
      return {
        ok: true,
        checks: [
          { level: "info", message: `found ${bin.command}${bin.version ? ` (${bin.version})` : ""}` },
          { level: "info", message: "sign-in is checked on first run" },
        ],
      };
    },
    async start(o: ManagedRunOptions) {
      const command = await findCursor(baseEnv, opts.command);
      if (!command) throw Object.assign(new Error("Cursor CLI not found"), { rule: "runtime-missing", fix: "install cursor-agent or set HL_CURSOR_BIN" });
      const protect = opts.protect === false ? undefined : (opts.protect ?? { root: o.cwd, globs: DEFAULT_PROTECTED });
      return startProcessRun({
        ...(o.runId ? { id: o.runId } : {}),
        protect,
        // A session that cannot be resumed is retried once fresh (Paperclip).
        retryOn: ["unknown_session"],
        attempt(n) {
          if (n > 1 || (n === 1 && !o.resumeSessionId)) return undefined;
          const run: RunOptions = { ...o };
          if (n === 1) delete run.resumeSessionId;
          return {
            command,
            args: cursorArgs(run),
            cwd: o.cwd,
            env: cleanEnv(baseEnv, o.env),
            prompt: o.prompt,
            timeoutSec: o.timeoutSec,
            silenceSec: o.silenceSec,
            lingerMs: opts.lingerMs,
            normalizer: createCursorNormalizer(),
          };
        },
      });
    },
  };
}

// Claude Code runtime adapter. Argument shape and the fresh-session retry are ported from Paperclip
// (MIT, Copyright (c) 2025 Paperclip AI) packages/adapters/claude-local/src/server/execute.ts. See THIRD_PARTY_NOTICES.md.
import { execFile } from "node:child_process";
import type { BinaryInfo, RunMode, RunOptions, RuntimeAdapter } from "@helmlock/core";
import { startProcessRun } from "../runtimes/process-run.ts";
import { cleanEnv, resolveCommand } from "../runtimes/spawn.ts";
import { createClaudeNormalizer } from "./parse.ts";

/** Never "default" (prompts nobody can answer headless) and never bypassPermissions. */
export const CLAUDE_PERMISSION_MODE: Record<RunMode, string> = {
  plan: "plan",
  ask: "plan",
  "auto-review": "acceptEdits",
  force: "acceptEdits",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function claudeArgs(o: RunOptions, resume: string | undefined): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", CLAUDE_PERMISSION_MODE[o.mode]];
  if (o.model) args.push("--model", o.model);
  if (o.agent) args.push("--agent", o.agent);
  for (const d of o.addDirs ?? []) args.push("--add-dir", d);
  if (resume && UUID.test(resume)) args.push("--resume", resume);
  return args;
}

export interface ClaudeAdapterOptions {
  /** Binary path or name; default HL_CLAUDE_BIN or "claude" on PATH. */
  command?: string;
  env?: Record<string, string | undefined>;
  protect?: { root: string; globs?: readonly string[] };
  lingerMs?: number;
}

export function createClaudeAdapter(opts: ClaudeAdapterOptions = {}): RuntimeAdapter {
  const baseEnv = opts.env ?? process.env;
  const find = async () => resolveCommand(opts.command ?? baseEnv.HL_CLAUDE_BIN ?? "claude", baseEnv);
  return {
    id: "claude-code",
    async detect(): Promise<BinaryInfo | null> {
      const command = await find();
      if (!command) return null;
      const version = await new Promise<string | undefined>((res) =>
        execFile(command, ["--version"], { windowsHide: true, timeout: 15000 }, (err, out) => res(err ? undefined : out.trim())),
      );
      return version ? { command, version } : { command };
    },
    async start(o) {
      const command = await find();
      if (!command)
        throw Object.assign(new Error("claude CLI not found on PATH"), { rule: "runtime-missing", fix: "install Claude Code or set HL_CLAUDE_BIN" });
      // The added dirs' CLAUDE.md load only with this flag (pre-flight 2026-10-07).
      const env = cleanEnv(baseEnv, { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1", ...o.env });
      return startProcessRun({
        protect: opts.protect,
        retryOn: ["unknown_session"],
        attempt(n) {
          if (n > 1) return undefined;
          const resume = n === 0 ? o.resumeSessionId : undefined;
          if (n === 1 && !o.resumeSessionId) return undefined;
          return {
            command,
            args: claudeArgs(o, resume),
            cwd: o.cwd,
            env,
            prompt: o.prompt,
            timeoutSec: o.timeoutSec,
            silenceSec: o.silenceSec,
            lingerMs: opts.lingerMs,
            normalizer: createClaudeNormalizer(),
          };
        },
      });
    },
  };
}

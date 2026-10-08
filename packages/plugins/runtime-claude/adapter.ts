// Claude Code runtime adapter. Argument shape and the fresh-session retry are ported from Paperclip
// (MIT, Copyright (c) 2025 Paperclip AI) packages/adapters/claude-local/src/server/execute.ts. See THIRD_PARTY_NOTICES.md.
import { execFile } from "node:child_process";
import type { BinaryInfo, EngineCapabilities, EngineCheck, RunMode, RunOptions, RuntimeAdapter } from "@helmlock/core";
import { type ManagedRunOptions, startProcessRun } from "../runtimes/process-run.ts";
import { cleanEnv, resolveCommand, spawnTarget } from "../runtimes/spawn.ts";
import { CLAUDE_LIVE, createClaudeNormalizer } from "./parse.ts";

/** Resume by session id, steer through the live session, approvals through the PreToolUse hook, --model per run. */
export const CLAUDE_CAPABILITIES: EngineCapabilities = { resume: true, steer: true, approve: true, models: true };

/** stdout of a short command (no shell; .cmd shims through cmd.exe), or undefined when it fails. */
export function execText(command: string, args: string[], env: Record<string, string | undefined>, timeout = 15000): Promise<string | undefined> {
  const t = spawnTarget(command, args, env);
  return new Promise((res) =>
    execFile(t.command, t.args, { windowsHide: true, windowsVerbatimArguments: t.verbatim, timeout }, (err, out) => res(err ? undefined : out.trim())),
  );
}

/** Never "default" (prompts nobody can answer headless) and never bypassPermissions. */
export const CLAUDE_PERMISSION_MODE: Record<RunMode, string> = {
  plan: "plan",
  ask: "plan",
  "auto-review": "acceptEdits",
  force: "acceptEdits",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Agents change state only through hl, so hl is always allowed (harness.toml permissions.allow). */
export const HL_ALLOWED_TOOLS = ["Bash(hl:*)", "Bash(hl.cmd:*)", "Bash(./hl:*)"];

/** With the approval hook, "ask" means the default mode: gated tools reach the hook, which asks a person. */
export function permissionMode(o: RunOptions & Pick<ManagedRunOptions, "approvalHook">): string {
  return o.approvalHook && o.mode === "ask" ? "default" : CLAUDE_PERMISSION_MODE[o.mode];
}

export function claudeArgs(o: RunOptions & Pick<ManagedRunOptions, "approvalHook" | "extraArgs" | "live">, resume: string | undefined): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", permissionMode(o)];
  // A live session: messages arrive as stream-json lines on an open stdin and each one is acknowledged on stdout, so
  // the run manager can steer it and knows when every message was taken in (verified with Claude Code 2.1.289).
  if (o.live) args.push("--input-format", "stream-json", "--replay-user-messages");
  // Settings allow rules are ignored until a folder is trusted interactively, so pass the hl allow on the command line.
  args.push("--allowedTools", HL_ALLOWED_TOOLS.join(","));
  if (o.model) args.push("--model", o.model);
  if (o.agent) args.push("--agent", o.agent);
  for (const d of o.addDirs ?? []) args.push("--add-dir", d);
  if (resume && UUID.test(resume)) args.push("--resume", resume);
  // From the run manager: e.g. --settings <runs/hooks/<id>.settings.json> with the PreToolUse approval hook.
  args.push(...(o.extraArgs ?? []));
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
  const detect = async (): Promise<BinaryInfo | null> => {
    const command = await find();
    if (!command) return null;
    const version = await execText(command, ["--version"], baseEnv);
    return version ? { command, version } : { command };
  };
  return {
    id: "claude-code",
    label: "Claude Code",
    capabilities: CLAUDE_CAPABILITIES,
    detect,
    async test() {
      const bin = await detect();
      if (!bin) return { ok: false, checks: [{ level: "error", message: "claude CLI not found on PATH (install Claude Code or set HL_CLAUDE_BIN)" }] };
      const checks: EngineCheck[] = [{ level: "info", message: `found ${bin.command}${bin.version ? ` (${bin.version})` : ""}` }];
      // `claude auth status` prints JSON and never prompts; an older CLI without it gets the first-run note.
      const status = await execText(bin.command, ["auth", "status"], baseEnv);
      let loggedIn: boolean | undefined;
      try {
        const parsed = status ? (JSON.parse(status) as { loggedIn?: unknown }) : undefined;
        if (typeof parsed?.loggedIn === "boolean") loggedIn = parsed.loggedIn;
      } catch {
        /* not JSON: unknown */
      }
      if (loggedIn === true) checks.push({ level: "info", message: "signed in" });
      else if (loggedIn === false && !baseEnv.ANTHROPIC_API_KEY)
        return { ok: false, checks: [...checks, { level: "error", message: "not signed in: run `claude` once and log in" }] };
      else checks.push({ level: "info", message: "sign-in is checked on first run" });
      return { ok: true, checks };
    },
    async start(o: ManagedRunOptions) {
      const command = await find();
      if (!command)
        throw Object.assign(new Error("claude CLI not found on PATH"), { rule: "runtime-missing", fix: "install Claude Code or set HL_CLAUDE_BIN" });
      // The added dirs' CLAUDE.md load only with this flag (pre-flight 2026-10-07).
      const env = cleanEnv(baseEnv, { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1", ...o.env });
      return startProcessRun({
        ...(o.runId ? { id: o.runId } : {}),
        protect: opts.protect,
        retryOn: ["unknown_session"],
        steerable: Boolean(o.live),
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
            ...(o.live ? { live: CLAUDE_LIVE } : {}),
          };
        },
      });
    },
  };
}

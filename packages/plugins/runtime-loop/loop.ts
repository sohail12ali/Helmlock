// The Helmlock loop (F153, Blueprint 33): our own small agent loop over any OpenAI-compatible model, after
// deepseek-harness agent-loop without its ceremony. A turn is steps of (model request with tools) -> (tool calls:
// read-only ones in parallel, the rest in order) -> (results back to the model), ending when the model answers without
// tool calls or calls finish / ask_user. Write and shell calls are decided allow / ask / deny from the mode first; "ask"
// puts a card in the approval queue (the same card the Claude Code PreToolUse bridge makes), fail-closed.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ApprovalCardData, ApprovalQueueService, ChatTurn, ProvidersService, RunEvent, RunHandle, RunOptions } from "@helmlock/core";
import { decide, segments } from "../harness/hooks/logic.ts";
import { newRunId } from "../runtimes/process-run.ts";
import { cleanEnv, EventQueue } from "../runtimes/spawn.ts";
import { DEFAULT_CONTEXT_WINDOW, estimateTokens, pruneCandidates, RETAIN_RATIO, summaryRequest, THRESHOLD_RATIO, tailStart } from "./compact.ts";
import { insideCwd, type PathPolicy, ToolError } from "./paths.ts";
import { runProcess, runShell, splitArgs } from "./proc.ts";
import { skillCatalog, systemPrompt } from "./prompt.ts";
import { newSessionId, SESSIONS_DIR, SessionLog, SUMMARY_PREFIX, type ToolCallData, validSessionId } from "./session.ts";
import { type CommandRunner, hlArgs, type LoopTool, type ShellRunner, type ToolEnv, type ToolOutput, toolsFor } from "./tools.ts";

export const MAX_STEPS = 60;
export const DEFAULT_TIMEOUT_SEC = 3600;
export const MODEL_RETRIES = 3;
export const RETRY_BASE_MS = 1000;
export const REPEAT_THRESHOLDS = [3, 5, 8] as const;

/**
 * Shell commands that could approve a card from inside a run (same guard as the server's PreToolUse bridge): the
 * approvals or hook API, the hook token, dumping the environment.
 */
export const SELF_APPROVAL =
  /api\/v1\/(approvals|hooks)|HL_HOOK_TOKEN|X-Helmlock-Hook-Token|runs[\\/]hooks|\bprintenv\b|^\s*env\b|[;&|]\s*env\b|Get-ChildItem\s+env:/i;
const HL_PREFIXES = ["hl", "hl.cmd", "./hl"];
export const isHlOnly = (command: string) => {
  const segs = segments(command);
  return segs.length > 0 && segs.every((s) => HL_PREFIXES.some((p) => s === p || s.startsWith(`${p} `)));
};

export interface LoopDeps {
  providers(): ProvidersService | undefined;
  queue(): ApprovalQueueService | undefined;
  /** Knowledge root. */
  root: string;
  deliveryRoot: string;
  /** The person on this machine (approval cards are on their behalf). */
  author?: string;
  protectedGlobs: readonly string[];
  /** harness.toml permissions.deny_shell (denied without asking). */
  denyShell?: readonly string[];
  shell?: ShellRunner;
  hl?: CommandRunner;
  rg?: CommandRunner;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
  maxSteps?: number;
  retries?: number;
  retryBaseMs?: number;
  approvalTimeoutMs?: number;
  defaultTimeoutSec?: number;
  env?: Record<string, string | undefined>;
}

interface Reply {
  text: string;
  reasoning: string;
  calls: ToolCallData[];
  usage?: { input_tokens: number; output_tokens: number; cache_read_tokens?: number };
}

class RunEnd extends Error {
  readonly failureClass: string;
  constructor(failureClass: string, message: string) {
    super(message);
    this.failureClass = failureClass;
  }
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    if (signal.aborted) return res();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      res();
    }
    signal.addEventListener("abort", done);
  });

const errCode = (e: unknown) => (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined);
const RETRYABLE = new Set(["rate_limit", "server", "timeout", "network"]);
const isRetryable = (e: unknown) => (e as { retryable?: unknown })?.retryable === true || RETRYABLE.has(errCode(e) ?? "");
const isContextError = (e: unknown) => errCode(e) === "context_exceeded";

function sortJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortJson);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortJson((v as Record<string, unknown>)[k])]),
    );
  return v;
}

export function repeatReminder(name: string, n: number, args: string): string {
  if (n <= REPEAT_THRESHOLDS[0])
    return "You are repeating the exact same tool call with identical arguments. Look at the previous result before calling again: if the task is not done, try a different approach or different arguments.";
  return [
    "Repeated tool call detected:",
    `- tool: ${name}`,
    `- consecutive_calls: ${n}`,
    `- arguments: ${args.length > 300 ? `${args.slice(0, 300)}...` : args}`,
    "The repeated calls are not making progress. Do not call this tool with these arguments again. Inspect the latest result and choose a different action, or finish if you have enough.",
  ].join("\n");
}

const short = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** Card text, the same shape as the server's describeToolCall for Claude Code's Bash, Write and Edit. */
export function describeCall(tool: "Bash" | "Write" | "Edit", input: Record<string, unknown>): { action: string; detail: string; preview: string } {
  const preview = short(JSON.stringify(input));
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  if (tool === "Bash") return { action: "shell", detail: short(s("command"), 500), preview };
  return { action: tool === "Write" ? "write file" : "edit file", detail: s("file_path"), preview };
}

export function startLoop(deps: LoopDeps, opts: RunOptions): RunHandle {
  const id = opts.runId ?? newRunId();
  const events = new EventQueue<RunEvent>();
  const ac = new AbortController();
  const signal = ac.signal;
  const steerQ: string[] = [];
  const now = deps.now ?? (() => new Date());
  const ts = () => now().toISOString();
  const sleep = deps.sleep ?? abortableSleep;
  let timedOut = false;
  let ended = false;
  let sessionId: string | undefined;
  let sessionLog: SessionLog | undefined;
  const emit = (e: RunEvent) => events.push(e);

  const timeoutSec = opts.timeoutSec ?? deps.defaultTimeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const wall = setTimeout(() => {
    timedOut = true;
    ac.abort(new RunEnd("timeout", `the run took longer than ${timeoutSec}s`));
  }, timeoutSec * 1000);

  async function main(): Promise<boolean> {
    const providers = deps.providers();
    if (!providers) throw new RunEnd("no-provider", "the providers plugin is not mounted: add it to workspace.toml");
    const model = opts.model ?? providers.defaultModel();
    if (!model) throw new RunEnd("no-model", "no model is set: add a provider and a default model in Settings > Models");
    if (!providers.providers().some((p) => model.startsWith(`${p.id}/`) && model.length > p.id.length + 1))
      throw new RunEnd("unknown-model", `unknown model "${model}": the loop takes a configured model id like <provider>/<model>`);
    const info = providers.models().find((m) => m.id === model);
    const windowTokens = info?.context_window ?? DEFAULT_CONTEXT_WINDOW;

    // ---- session
    const dir = join(deps.root, SESSIONS_DIR);
    const want = opts.resumeSessionId;
    const canResume = want !== undefined && validSessionId(want) && existsSync(join(dir, `${want}.jsonl`));
    if (want && !canResume) emit({ type: "stderr", text: `[loop] session ${want} was not found; starting a new session` });
    sessionId = canResume ? (want as string) : newSessionId();
    const log = new SessionLog(dir, sessionId);
    sessionLog = log;
    const cwd = resolve(opts.cwd);
    if (!log.lines.length) log.append({ t: "meta", v: 1, session: sessionId, created: ts(), model, ...(opts.role ? { role: opts.role } : {}), cwd });
    emit({ type: "init", sessionId, model });
    log.append({ t: "user", content: opts.prompt, ts: ts(), source: "prompt" });

    // ---- tools, policy, prompt (built once; never rewritten during the run)
    const roots = [...new Set([cwd, ...(opts.addDirs ?? []).map((d) => resolve(d)), resolve(deps.root)])];
    const policy: PathPolicy = { cwd, roots, knowledgeRoot: resolve(deps.root), protectedGlobs: deps.protectedGlobs };
    const tools = toolsFor(opts.mode, splitArgs);
    const byName = new Map(tools.map((t) => [t.spec.name, t]));
    const specs = tools.map((t) => t.spec);
    const skills = skillCatalog(deps.root, deps.deliveryRoot);
    const role = opts.role ?? opts.agent;
    const system = systemPrompt({
      root: deps.root,
      deliveryRoot: deps.deliveryRoot,
      ...(role ? { role } : {}),
      mode: opts.mode,
      cwd,
      roots,
      ...(opts.ticket ? { ticket: opts.ticket } : {}),
      tools,
      skills,
      now: now(),
    });
    const childEnv = cleanEnv(deps.env ?? process.env, { HL_WORKSPACE: deps.root, ...(opts.env ?? {}), HL_RUN_ID: opts.env?.HL_RUN_ID ?? id });
    const hlCli = join(deps.deliveryRoot, "packages", "cli", "bin", "hl.ts");
    const env: ToolEnv = {
      policy,
      observed: new Map(),
      emit,
      signal,
      env: childEnv,
      skills,
      shell: deps.shell ?? runShell,
      hl: deps.hl ?? ((args, o) => runProcess(process.execPath, [hlCli, ...args], o)),
      rg: deps.rg ?? ((args, o) => runProcess("rg", args, o)),
    };
    const actor = { kind: "agent" as const, id: role ?? "loop", onBehalfOf: deps.author ?? "unknown" };

    // ---- model calls
    async function complete(messages: ChatTurn[], withTools: boolean): Promise<Reply> {
      const p = providers as ProvidersService;
      const retries = deps.retries ?? MODEL_RETRIES;
      for (let attempt = 0; ; attempt++) {
        const r: Reply = { text: "", reasoning: "", calls: [] };
        try {
          for await (const d of p.complete({ model: model as string, messages, ...(withTools ? { tools: specs } : {}), signal })) {
            if (d.type === "text") r.text += d.text;
            else if (d.type === "tool_call") r.calls.push({ id: d.id, name: d.name, arguments: d.arguments });
            else if (d.type === "usage") r.usage = d;
            else if (d.type !== "done") {
              // Reasoning chunks, when the provider layer passes them on (not in CompletionDelta yet).
              const x = d as unknown as { type: string; text?: unknown };
              if ((x.type === "reasoning" || x.type === "thinking") && typeof x.text === "string") r.reasoning += x.text;
            }
          }
          return r;
        } catch (e) {
          if (signal.aborted || !isRetryable(e) || attempt >= retries) throw e;
          const after = (e as { retryAfter?: unknown }).retryAfter;
          const wait = Math.min(60_000, typeof after === "number" ? after * 1000 : (deps.retryBaseMs ?? RETRY_BASE_MS) * 2 ** attempt);
          emit({
            type: "error",
            message: `model call failed (${errCode(e) ?? "error"}: ${(e as Error).message}); retry ${attempt + 1}/${retries} in ${Math.round(wait / 100) / 10}s`,
            retryable: true,
          });
          await sleep(wait, signal);
          if (signal.aborted) throw e;
        }
      }
    }

    const sysTokens = estimateTokens([{ role: "system", content: system }], specs);
    async function maybeCompact(force: boolean): Promise<void> {
      const limit = Math.floor(windowTokens * THRESHOLD_RATIO);
      const retain = Math.floor(windowTokens * RETAIN_RATIO);
      const before = sysTokens + estimateTokens(log.history());
      if (!force && before <= limit) return;
      const ids = pruneCandidates(log.history(), retain);
      let changed = ids.length > 0;
      if (changed) log.append({ t: "prune", call_ids: ids, ts: ts() });
      let after = sysTokens + estimateTokens(log.history());
      if (after > limit || force) {
        const hist = log.history();
        // After a context-length error keep only the latest message group verbatim.
        const cut = tailStart(hist, force ? 0 : retain);
        if (cut > 1) {
          try {
            const r = await complete(summaryRequest(hist.slice(0, cut), windowTokens), false);
            const summary = r.text.trim();
            if (summary) {
              if (r.usage) emit({ type: "usage", inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens });
              const next: ChatTurn[] = [{ role: "user", content: `${SUMMARY_PREFIX}${summary}` }, ...hist.slice(cut)];
              after = sysTokens + estimateTokens(next);
              log.append({ t: "compact", summary, dropped: cut, before_tokens: before, after_tokens: after, ts: ts() });
              changed = true;
            }
          } catch (e) {
            if (signal.aborted) throw e;
            emit({ type: "stderr", text: `[loop] compaction summary failed: ${(e as Error).message}` });
          }
        }
      }
      if (changed) emit({ type: "compaction", beforeTokens: before, afterTokens: after });
    }

    async function modelStep(): Promise<Reply> {
      for (let ctxRetry = 0; ; ctxRetry++) {
        await maybeCompact(ctxRetry > 0);
        try {
          return await complete([{ role: "system", content: system }, ...log.history()], true);
        } catch (e) {
          if (isContextError(e) && ctxRetry === 0 && !signal.aborted) {
            emit({ type: "error", message: `the context window is full (${(e as Error).message}); compacting and retrying once`, retryable: true });
            continue;
          }
          throw e;
        }
      }
    }

    // ---- approvals
    async function approve(tool: "Bash" | "Write" | "Edit", input: Record<string, unknown>): Promise<string | undefined> {
      const q = deps.queue();
      const desc = describeCall(tool, input);
      const summary = `${desc.action}: ${desc.detail}`;
      if (!q) return "error (DENIED): no approval queue in this session, so nobody can approve it. Run from the console, or work without it.";
      const before = new Set(q.pending().map((c) => c.id));
      const pending = q.request(
        { action: desc.action, detail: desc.detail, tool, input_preview: desc.preview, actor, run_id: id, local_only: false },
        deps.approvalTimeoutMs ? { timeoutMs: deps.approvalTimeoutMs } : undefined,
      );
      const card = q.pending().find((c) => !before.has(c.id) && c.run_id === id && c.tool === tool);
      if (card) emit({ type: "approval", id: card.id, status: "pending", summary });
      const decided = await Promise.race([pending, new Promise<undefined>((r) => signal.addEventListener("abort", () => r(undefined), { once: true }))]);
      if (!decided) return "error (CANCELLED): the run was stopped";
      const allowed = (decided as ApprovalCardData).status === "allowed";
      emit({ type: "approval", id: decided.id, status: allowed ? "allowed" : "denied", summary });
      if (allowed) return undefined;
      const why = decided.status === "expired" ? "no answer from a person in time (fail-closed)" : `denied by ${decided.decided_by ?? "a person"}`;
      return `error (DENIED): ${why}. Do not retry this action; choose another way or ask the person.`;
    }

    /** undefined = go ahead; a string = the tool result instead of running it. */
    async function gate(tool: LoopTool, args: Record<string, unknown>): Promise<string | undefined> {
      if (tool.kind === "write") {
        const abs = (tool.target as NonNullable<LoopTool["target"]>)(args, env);
        const auto = opts.mode === "force" || (opts.mode === "auto-review" && insideCwd(policy, abs));
        if (auto) return undefined;
        const input: Record<string, unknown> = { file_path: abs };
        if (tool.spec.name === "edit") Object.assign(input, { old_string: args.old_string, new_string: args.new_string });
        else input.content = typeof args.content === "string" ? short(args.content, 200) : "";
        return approve(tool.spec.name === "edit" ? "Edit" : "Write", input);
      }
      if (tool.kind === "shell") {
        const command = typeof args.command === "string" ? args.command.trim() : "";
        if (!command) return "error (BAD_ARGS): give a command";
        if (SELF_APPROVAL.test(command)) return "error (DENIED): agents may not call the approvals API or read the hook token";
        const policyDecision = decide(command, { deny_shell: [...(deps.denyShell ?? [])] });
        if (policyDecision.decision === "deny") return `error (DENIED): ${policyDecision.reason}`;
        if (isHlOnly(command)) return undefined;
        return approve("Bash", { command });
      }
      return undefined;
    }

    let reported = false;
    async function execOne(call: ToolCallData): Promise<ToolOutput> {
      let args: Record<string, unknown> = {};
      let parsed = true;
      try {
        const v = JSON.parse(call.arguments || "{}") as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>;
        else parsed = false;
      } catch {
        parsed = false;
      }
      emit({ type: "tool", phase: "start", name: call.name, id: call.id, input: parsed ? args : call.arguments });
      const tool = byName.get(call.name);
      let out: ToolOutput;
      try {
        if (!tool)
          out = {
            text: `error (NO_TOOL): there is no tool named ${call.name}${opts.mode === "plan" ? " in plan mode (read-only)" : ""}`,
            isError: true,
          };
        else if (!parsed) out = { text: "error (BAD_ARGS): the arguments are not a valid JSON object", isError: true };
        else {
          const refusal = await gate(tool, args);
          out = refusal ? { text: refusal, isError: true } : await tool.run(args, env);
          if (tool.kind === "hl" && !out.isError) {
            const a = hlArgs(args, splitArgs);
            if (a[0] === "run" && a[1] === "report") reported = true;
          }
        }
      } catch (e) {
        if (signal.aborted) out = { text: "error (CANCELLED): the run was stopped", isError: true };
        else if (e instanceof ToolError) out = { text: `error (${e.code}): ${e.message}`, isError: true };
        else out = { text: `error: ${(e as Error).message}`, isError: true };
      }
      emit({ type: "tool", phase: "end", name: call.name, id: call.id, ...(out.isError ? { isError: true } : {}) });
      return out;
    }

    let repeatKey = "";
    let repeatN = 0;
    const maxSteps = deps.maxSteps ?? MAX_STEPS;
    for (let step = 0; ; step++) {
      if (signal.aborted) throw signal.reason ?? new RunEnd("cancelled", "stopped");
      if (step >= maxSteps) throw new RunEnd("step-limit", `stopped after ${maxSteps} steps without finishing`);
      while (steerQ.length) log.append({ t: "user", content: steerQ.shift() as string, ts: ts(), source: "steer" });

      const r = await modelStep();
      if (r.reasoning) emit({ type: "thinking", text: r.reasoning });
      if (r.text) emit({ type: "text", text: r.text });
      if (r.usage)
        emit({
          type: "usage",
          inputTokens: r.usage.input_tokens,
          outputTokens: r.usage.output_tokens,
          ...(r.usage.cache_read_tokens !== undefined ? { cacheReadTokens: r.usage.cache_read_tokens } : {}),
        });
      const calls = r.calls.filter((c) => c.name);
      log.append({ t: "assistant", content: r.text, ...(calls.length ? { tool_calls: calls } : {}), ts: ts() });
      if (!calls.length) return finishRun(log, true, "answered", r.text);

      // Read-only calls in a row run in parallel; everything else one at a time, in model order.
      const outs: ToolOutput[] = [];
      for (let i = 0; i < calls.length; ) {
        if (signal.aborted) {
          outs.push({ text: "error (CANCELLED): the run was stopped", isError: true });
          i++;
          continue;
        }
        const kind = byName.get((calls[i] as ToolCallData).name)?.kind;
        let j = i + 1;
        if (kind === "read") while (j < calls.length && byName.get((calls[j] as ToolCallData).name)?.kind === "read") j++;
        outs.push(...(await Promise.all(calls.slice(i, j).map((c) => execOne(c)))));
        i = j;
      }
      let reminder: string | undefined;
      let end: ToolOutput | undefined;
      for (const [k, c] of calls.entries()) {
        const out = outs[k] as ToolOutput;
        log.append({ t: "tool", call_id: c.id, name: c.name, content: out.text, ...(out.isError ? { is_error: true } : {}), ts: ts() });
        let canon: string;
        try {
          canon = JSON.stringify(sortJson(JSON.parse(c.arguments || "{}")));
        } catch {
          canon = c.arguments;
        }
        const key = `${c.name}\u0000${canon}`;
        repeatN = key === repeatKey ? repeatN + 1 : 1;
        repeatKey = key;
        if ((REPEAT_THRESHOLDS as readonly number[]).includes(repeatN)) reminder = repeatReminder(c.name, repeatN, canon);
        if (out.end && !end) end = out;
      }
      if (reminder) log.append({ t: "user", content: reminder, ts: ts(), source: "reminder" });
      if (end?.end === "ask") {
        emit({ type: "text", text: end.text });
        if (!reported) emit({ type: "outcome", outcome: { outcome: "needs-input", summary: end.text } });
        return finishRun(log, true, "needs-input", end.text);
      }
      if (end?.end === "finish") return finishRun(log, true, "finished", end.text);
    }
  }

  function finishRun(log: SessionLog, ok: boolean, reason: string, text: string): boolean {
    log.append({ t: "end", ok, reason, ts: ts() });
    emit({ type: "result", ok, text, ...(sessionId ? { sessionId } : {}) });
    return ok;
  }

  const done = (async () => {
    let ok = false;
    try {
      ok = await main();
    } catch (e) {
      const reason = signal.aborted ? signal.reason : e;
      const fc =
        reason instanceof RunEnd
          ? reason.failureClass
          : signal.aborted
            ? "cancelled"
            : errCode(e)
              ? `model-${(errCode(e) as string).replace(/_/g, "-")}`
              : "loop-error";
      const message = reason instanceof RunEnd ? reason.message : signal.aborted ? "stopped" : (e as Error).message;
      if (!signal.aborted || timedOut) emit({ type: "error", message });
      try {
        sessionLog?.append({ t: "end", ok: false, reason: fc, ts: ts() });
      } catch {
        /* the log is a help */
      }
      emit({ type: "result", ok: false, text: message, ...(sessionId ? { sessionId } : {}), failureClass: fc });
    } finally {
      ended = true;
      clearTimeout(wall);
      events.end();
    }
    return { ok, exitCode: ok ? 0 : 1, timedOut };
  })();

  return {
    id,
    events,
    async cancel() {
      if (!signal.aborted) ac.abort(new RunEnd("cancelled", "stopped by a person"));
      await done;
    },
    async steer(text: string) {
      if (ended) throw new Error("the run has ended: send the message as the next turn instead");
      const t = text.trim();
      if (t) steerQ.push(t);
    },
    done,
  };
}

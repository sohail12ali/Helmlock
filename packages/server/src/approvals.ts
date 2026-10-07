// Milestone 4: permission cards (F5d, F14, F84). GET /approvals?status=pending|recent, POST /approvals/:id (answer,
// console only), and the internal POST /hooks/pretooluse that the PreToolUse hook of a server-started Claude run calls:
// token-checked, it parks until a person answers or the queue times out (fail-closed) and returns a HookDecision.
import { timingSafeEqual } from "node:crypto";
import type { ApiResponse, ApprovalCard, HookDecision } from "@helmlock/core";
import { decide, denyShellOf, HOOK_TOKEN_HEADER, segments } from "@helmlock/plugins/harness/hooks/logic.ts";
import type { Hono, Context as HonoContext } from "hono";
import { z } from "zod";
import { ApiError } from "./errors.ts";
import { currentPerson, failM4, jsonBody, type M4Deps } from "./runs.ts";
import { checkWriteRequest } from "./writes.ts";

/** hl is how agents change state, so hl-only commands never need a card (harness.toml permissions.allow). */
const HL_PREFIXES = ["hl", "hl.cmd", "./hl"];

export function isHlOnly(command: string): boolean {
  const segs = segments(command);
  return segs.length > 0 && segs.every((s) => HL_PREFIXES.some((p) => s === p || s.startsWith(`${p} `)));
}

const short = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** Card text for one tool call: the action a person reads, the detail, and an input preview. */
export function describeToolCall(tool: string, input: unknown): { action: string; detail: string; preview: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const preview = short(JSON.stringify(input ?? {}));
  switch (tool) {
    case "Bash":
      return { action: "shell", detail: short(str("command"), 500), preview };
    case "Write":
      return { action: "write file", detail: str("file_path"), preview };
    case "Edit":
    case "MultiEdit":
      return { action: "edit file", detail: str("file_path"), preview };
    case "WebFetch":
      return { action: "fetch url", detail: str("url"), preview };
    default:
      return { action: `use ${tool}`, detail: preview, preview };
  }
}

function tokenMatches(given: string | undefined, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const AnswerBody = z.object({ decision: z.enum(["allow", "deny"]), scope: z.enum(["once", "chat"]).optional() }).strict();
const HookBody = z
  .object({ run_id: z.string().min(1), tool_name: z.string().min(1), tool_input: z.unknown().optional(), tool_use_id: z.string().optional() })
  .loose();

export function registerApprovalRoutes(api: Hono, d: M4Deps): void {
  const { runtime, log } = d;
  const queue = () => runtime.ctx.get("approvalQueue");
  const handle = (fn: (c: HonoContext) => Promise<Response>) => async (c: HonoContext) => {
    try {
      await d.ready();
      return await fn(c);
    } catch (e) {
      return failM4(c, e, log);
    }
  };

  api.get(
    "/approvals",
    handle(async (c) => {
      const status = c.req.query("status") || "pending";
      if (status !== "pending" && status !== "recent")
        throw new ApiError(400, "bad-request", `status must be pending or recent, got ${JSON.stringify(status)}`);
      const data = status === "pending" ? queue().pending() : queue().recent(Number(c.req.query("limit")) || 50);
      return c.json({ ok: true, data } satisfies ApiResponse<ApprovalCard[]>);
    }),
  );

  api.post(
    "/approvals/:id",
    handle(async (c) => {
      checkWriteRequest({ method: c.req.method, header: (n) => c.req.header(n) }, d.hostOf(c));
      const parsed = AnswerBody.safeParse(await jsonBody(c));
      if (!parsed.success) throw new ApiError(400, "bad-request", 'body must be { decision: "allow" | "deny", scope?: "once" | "chat" }');
      const person = await currentPerson(runtime);
      const card = queue().answer(c.req.param("id") ?? "", parsed.data.decision, person.id, "console", parsed.data.scope ?? "once");
      return c.json({ ok: true, data: card } satisfies ApiResponse<ApprovalCard>);
    }),
  );

  api.post("/hooks/pretooluse", async (c) => {
    // The token comes first: without it nothing else is looked at (and no plugin is mounted).
    if (!tokenMatches(c.req.header(HOOK_TOKEN_HEADER), d.hookToken))
      return c.json({ ok: false, error: { rule: "hook-token", message: "missing or wrong hook token" } } satisfies ApiResponse<never>, 403);
    const deny = (reason: string) => c.json({ ok: true, data: { decision: "deny", reason } } satisfies ApiResponse<HookDecision>);
    try {
      await d.ready();
      const ct = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (ct !== "application/json") throw new ApiError(415, "bad-content-type", "hook calls are JSON");
      const parsed = HookBody.safeParse(await jsonBody(c));
      if (!parsed.success) throw new ApiError(400, "bad-request", "body must be { run_id, tool_name, tool_input }");
      const { run_id, tool_name, tool_input } = parsed.data;
      const run = runtime.ctx.get("runManager").get(run_id);
      if (run?.status !== "running") return deny(`run ${run_id} is not running in this console`);
      if (tool_name === "Bash") {
        const command = typeof (tool_input as { command?: unknown })?.command === "string" ? (tool_input as { command: string }).command : "";
        if (!command) return deny("no command in the Bash call");
        if (isHlOnly(command))
          return c.json({ ok: true, data: { decision: "allow", reason: "hl verbs are always allowed" } } satisfies ApiResponse<HookDecision>);
        const policy = decide(command, { deny_shell: denyShellOf([runtime.info.deliveryRoot, runtime.info.root]) });
        if (policy.decision === "deny") return deny(policy.reason);
      }
      const t = describeToolCall(tool_name, tool_input);
      const author = runtime.info.author ?? "unknown";
      const card = await queue().request({
        action: t.action,
        detail: t.detail,
        tool: tool_name,
        input_preview: t.preview,
        actor: { kind: "agent", id: run.agent ?? run.runtime, onBehalfOf: author },
        run_id,
        local_only: false,
      });
      if (card.status === "allowed")
        return c.json({ ok: true, data: { decision: "allow", reason: `approved by ${card.decided_by}` } } satisfies ApiResponse<HookDecision>);
      if (card.status === "expired") return deny(`no answer from a person (${card.decided_by}); fail-closed`);
      return deny(`declined by ${card.decided_by}`);
    } catch (e) {
      return failM4(c, e, log);
    }
  });
}

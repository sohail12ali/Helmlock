// Approval queue plugin: provides "approvalQueue" and, once a console is attached (enableRemote), answers the core
// "approval/request" hook by putting a card in front of a person instead of denying for want of a terminal.
import type { PluginModule } from "@helmlock/core";
import { z } from "zod";
import { type ApprovalLogRow, type ApprovalQueue, createApprovalQueue, LOCAL_ONLY } from "./queue.ts";

const Config = z
  .object({
    approval_timeout_sec: z.number().int().positive().optional(),
  })
  .loose();

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const plugin: PluginModule<typeof Config> = {
  name: "approval-queue",
  Config,
  apply(ctx, config) {
    const files = ctx.has("files") ? ctx.get("files") : undefined;
    let ignoreWritten = false;
    // Rows are appended one after another, so "requested" always precedes its "decided".
    let tail: Promise<void> = Promise.resolve();
    const append = async (row: ApprovalLogRow) => {
      if (!files) return;
      // Local only, like runs/ (gitignored in the knowledge-repo template too).
      if (!ignoreWritten) {
        ignoreWritten = true;
        if (!(await files.exists("approvals/.gitignore"))) await files.writeText("approvals/.gitignore", "*\n");
      }
      await files.appendJsonl(`approvals/${localDate(new Date(row.ts))}.jsonl`, row);
    };
    const queue: ApprovalQueue = createApprovalQueue({
      ...(config.approval_timeout_sec ? { timeoutMs: config.approval_timeout_sec * 1000 } : {}),
      emit: (e, p) => ctx.emit(e, p),
      log(row) {
        tail = tail.then(() => append(row)).catch(() => {});
        return tail;
      },
    });
    ctx.provide("approvalQueue", queue);
    void ctx.effect(() => () => queue.close());
    void ctx.effect(() => ctx.on("run.finished", (e) => queue.expireRun(e.runId)));
    void ctx.effect(() =>
      ctx.hook(
        "approval/request",
        async (p, next) => {
          if (p.decision || !queue.remote) return next(p);
          const card = await queue.request({ action: p.action, detail: p.detail, actor: p.actor, local_only: LOCAL_ONLY.has(p.action) });
          const allowed = card.status === "allowed";
          const reason = allowed
            ? `approved by ${card.decided_by} in the ${card.decided_via}`
            : card.status === "expired"
              ? "no answer in time; fail-closed"
              : `declined by ${card.decided_by}`;
          return next({ ...p, decision: allowed ? "allow" : "deny", reason });
        },
        { priority: -100 },
      ),
    );
  },
};

export default plugin;

// Named gates for workflow.toml. A gate returns a reason when it blocks, undefined when it passes. Gates never write.
import type { Context, Ticket } from "@helmlock/core";

export interface GateFail {
  message: string;
  fix?: string;
}
export type Gate = (t: Ticket, ctx: Context) => Promise<GateFail | undefined>;

export const GATES: Record<string, Gate> = {
  async "not-blocked"(t) {
    if (!t.flags.blocked) return undefined;
    return {
      message: `${t.ticket.id} is blocked by ${t.flags.blocked_by ?? "?"}; next: ${t.flags.next_action ?? "?"}`,
      fix: `hl ticket unblock ${t.ticket.id}`,
    };
  },

  async "no-blocking-questions"(t, ctx) {
    const open = (await ctx.get("records").list(t.ticket.id, "question")).filter((q) => q.status === "open" && "blocking" in q && q.blocking);
    if (!open.length) return undefined;
    return {
      message: `${open.length} open blocking question(s): ${open.map((q) => q.id).join(", ")}`,
      fix: `hl question answer ${open[0]!.id} "<answer>"`,
    };
  },

  async "has-spec"(t, ctx) {
    const rel = `${t.dir}/${t.ticket.id}-spec.md`;
    if (await ctx.get("files").exists(rel)) return undefined;
    return { message: `${rel} does not exist`, fix: `write the spec (acceptance criteria AC-1..) in ${rel}` };
  },

  async "has-tasks"(t, ctx) {
    if (t.ticket.size === "S") return undefined;
    if ((await ctx.get("tasks").list(t.ticket.id)).length) return undefined;
    return {
      message: `${t.ticket.id} has no tasks (only size S may skip tasks)`,
      fix: `hl task add ${t.ticket.id} "<title>" --slice S1 --layer api --ac AC-1`,
    };
  },

  async "tasks-done"(t, ctx) {
    const open = (await ctx.get("tasks").list(t.ticket.id)).filter((x) => x.status !== "done");
    if (!open.length) return undefined;
    return { message: `${open.length} task(s) not done: ${open.map((x) => x.id).join(", ")}`, fix: `hl task set ${t.ticket.id} ${open[0]!.id} --status done` };
  },

  async "no-open-bugs"(t, ctx) {
    const open = (await ctx.get("records").list(t.ticket.id, "bug")).filter((b) => b.status === "open");
    if (!open.length) return undefined;
    return { message: `${open.length} open bug(s): ${open.map((b) => b.id).join(", ")}`, fix: "fix the bug and set its status to fixed" };
  },
};

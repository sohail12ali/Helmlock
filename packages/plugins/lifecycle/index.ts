// lifecycle: `ticket close` (checked digest, then the workflow's move to done), `ticket archive`, `ticket restore`
// and `retention suggest` (Blueprint 19). Also adds one "archive eligible" line to `hl context --session`.
import type { PluginModule, SessionDigest, VerbDef } from "@helmlock/core";
import { blocked, fail, ok } from "@helmlock/core";
import { z } from "zod";
import { DIGEST_SECTIONS, MAX_DIGEST_WORDS } from "./digest.ts";
import { archiveTicket, closeTicket, restoreTicket, retentionSuggest } from "./lifecycle.ts";

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

function verbs(): VerbDef[] {
  const close = verb({
    id: "ticket close",
    summary: `Check the closure digest (<T>-digest.md: ${DIGEST_SECTIONS.join(", ")}; at most ${MAX_DIGEST_WORDS} words) and move the ticket to done if the workflow allows.`,
    examples: ["hl ticket close T-014-sa", "hl ticket close T-014-sa --dry-run --json"],
    args: ["id"],
    input: z.object({ id: z.string() }),
    writes: true,
    async run(v, i) {
      const o = await closeTicket(v.ctx, i.id, v.actor, v.dryRun);
      const file = `artifacts/${i.id}/${i.id}-digest.md`;
      if (!o.digest)
        return fail("digest-missing", `${i.id} has no closure digest`, {
          file,
          fix: `write ${file} with the sections ${DIGEST_SECTIONS.map((s) => `## ${s}`).join(", ")} (the close skill drafts it)`,
        });
      if (o.check && !o.check.ok) {
        const first = o.check.problems[0];
        return {
          ok: false,
          code: 1,
          error: {
            rule: first?.rule ?? "digest-invalid",
            message: `${o.digest} is not a valid closure digest:\n${o.check.problems.map((p) => `- ${p.message}`).join("\n")}`,
            file: o.digest,
            fix: "fix the digest and run hl ticket close again",
          },
          data: o,
        };
      }
      if (o.already_closed) return ok(o, `${i.id} is already closed (${o.stage}); digest ${o.digest} is valid (${o.check?.words} words)`);
      if (o.gate && !o.gate.allowed) {
        const first = o.gate.reasons[0] ?? { rule: "gate", message: "move not allowed" };
        return blocked(first.rule, `${i.id} cannot close yet:\n${o.gate.reasons.map((r) => `- ${r.rule}: ${r.message}`).join("\n")}`, {
          file: `artifacts/${i.id}/ticket.toml`,
          ...(first.fix ? { fix: first.fix } : {}),
        });
      }
      return ok(o, `${v.dryRun ? "would close" : "closed"} ${i.id} -> ${o.stage}; digest ${o.digest} (${o.check?.words} words)`);
    },
  });

  const archive = verb({
    id: "ticket archive",
    summary: "Archive a closed ticket: move its folder to archive/YYYY-MM/<T>/ with a sha256 manifest and copy the digest to shared/digests/.",
    examples: ["hl ticket archive T-009-sa --dry-run", "hl ticket archive T-009-sa"],
    args: ["id"],
    input: z.object({ id: z.string() }),
    writes: true,
    async run(v, i) {
      const p = await archiveTicket(v.ctx, i.id, { dryRun: v.dryRun });
      return ok(
        p,
        `${v.dryRun ? "would archive" : "archived"} ${p.ticket}: ${p.from} -> ${p.to} (${p.files} files, manifest.sha256); digest copied to ${p.digest_copy}`,
      );
    },
  });

  const restore = verb({
    id: "ticket restore",
    summary: "Restore an archived ticket to artifacts/ after verifying its sha256 manifest.",
    examples: ["hl ticket restore T-009-sa --dry-run", "hl ticket restore T-009-sa"],
    args: ["id"],
    input: z.object({ id: z.string() }),
    writes: true,
    async run(v, i) {
      const p = await restoreTicket(v.ctx, i.id, { dryRun: v.dryRun });
      const extra = p.extra.length ? `; not in the manifest: ${p.extra.join(", ")}` : "";
      return ok(p, `${v.dryRun ? "would restore" : "restored"} ${p.ticket}: ${p.from} -> ${p.to} (${p.verified} files verified)${extra}`);
    },
  });

  const suggest = verb({
    id: "retention suggest",
    summary: "List closed tickets eligible to archive ([retention] archive_after_days in workspace.toml, default 30). Never archives.",
    examples: ["hl retention suggest", "hl retention suggest --days 0 --json"],
    input: z.object({ days: z.coerce.number().int().min(0).optional() }),
    writes: false,
    async run(v, i) {
      const r = await retentionSuggest(v.ctx, i.days === undefined ? {} : { days: i.days });
      const text = r.items.length
        ? `${r.items.length} closed ticket(s) older than ${r.days} days (archive with hl ticket archive <T> --dry-run first):\n${r.items
            .map((x) => `${x.ticket.padEnd(10)} closed ${x.closed} (${x.days}d)  ${x.title}`)
            .join("\n")}`
        : `nothing closed more than ${r.days} days ago`;
      return ok(r, text);
    },
  });
  return [close, archive, restore, suggest];
}

const plugin: PluginModule = {
  name: "lifecycle",
  requires: ["files", "verbs", "tickets", "workflow", "config"],
  async apply(ctx) {
    for (const def of verbs()) await ctx.effect(() => ctx.get("verbs").register(def));
    // Session digest (F127): one capped line naming what is eligible to archive. The context plugin has no hook
    // of its own, so this rides on verb/post-execute (plugin.toml lists "context" so this mounts with it).
    await ctx.effect(() =>
      ctx.hook("verb/post-execute", async (p, next) => {
        const session = p.input.session === true || p.input.session === "true";
        if (p.verb !== "context" || !session || !p.result.ok) return next(p);
        try {
          const r = await retentionSuggest(ctx);
          if (!r.items.length) return next(p);
          const ids = r.items.map((x) => x.ticket);
          const line = `Archive eligible (closed > ${r.days}d): ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ` +${ids.length - 5} more` : ""} (hl retention suggest)`;
          const data = p.result.data as SessionDigest;
          const result = {
            ...p.result,
            data: Array.isArray(data?.waiting) ? { ...data, waiting: [...data.waiting, line] } : p.result.data,
            ...(p.result.text !== undefined ? { text: `${p.result.text}\n${line}` } : {}),
          };
          return next({ ...p, result });
        } catch {
          return next(p);
        }
      }),
    );
  },
};

export default plugin;

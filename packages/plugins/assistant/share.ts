// `chat share` (Blueprint 31): chats are local (chats/<id>.jsonl, gitignored); sharing copies one to
// people/<slug>/chats/<id>.jsonl, which is committed and visible to the team, and marks the local chat shared.
// file_read tool results are dropped from the copy: they can hold the text of any file on this machine.
import type { VerbDef } from "@helmlock/core";
import { ok, scopeDir } from "@helmlock/core";
import { z } from "zod";
import { CHAT_ID, type ChatLine, chatError } from "./store.ts";
import { FILE_READ } from "./tools.ts";

export const STRIPPED = "[file_read result left out when this chat was shared]";
const LineSchema = z.object({ t: z.string() }).loose() as unknown as z.ZodType<ChatLine>;

/** The shared copy: file_read results replaced, the local "shared" markers dropped. */
export function shareLines(lines: ChatLine[], title?: string): { lines: ChatLine[]; stripped: number } {
  let stripped = 0;
  const out: ChatLine[] = [];
  for (const l of lines) {
    if (l.t === "shared") continue;
    if (l.t === "msg" && l.m.role === "tool" && l.m.tool?.name === FILE_READ && l.m.tool.result !== undefined) {
      stripped++;
      out.push({ ...l, m: { ...l.m, text: l.m.text ? STRIPPED : l.m.text, tool: { ...l.m.tool, result: STRIPPED } } });
      continue;
    }
    out.push(l);
  }
  if (title) out.push({ t: "title", title, ts: new Date().toISOString() });
  return { lines: out, stripped };
}

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

export function chatShareVerb(): VerbDef {
  return verb({
    id: "chat share",
    summary: "Share a local chat with the team: copies it to people/<you>/chats/ (committed); file_read results are left out.",
    examples: ["hl chat share ch-20261007-142501-a1b2", 'hl chat share ch-20261007-142501-a1b2 --title "UAT login fix"'],
    args: ["id"],
    input: z.object({ id: z.string(), title: z.string().trim().min(1).optional() }),
    writes: true,
    async run(v, input) {
      if (!CHAT_ID.test(input.id)) throw chatError("bad-id", `not a chat id: ${input.id}`, "chat ids look like ch-20261007-142501-a1b2");
      const files = v.ctx.get("files");
      const src = `chats/${input.id}.jsonl`;
      if (!(await files.exists(src))) throw chatError("not-found", `no chat ${input.id} on this machine`, "list chats with GET /api/v1/chats");
      const roster = v.ctx.get("roster");
      const person = (await roster.get(v.actor.onBehalfOf)) ?? (await roster.current());
      const lines = await files.readJsonl(src, LineSchema);
      const { lines: copy, stripped } = shareLines(lines, input.title);
      const dest = `${scopeDir("personal", "chats", person.id)}/${input.id}.jsonl`;
      const ts = new Date().toISOString();
      await files.writeText(dest, `${copy.map((l) => JSON.stringify(l)).join("\n")}\n`, { dryRun: v.dryRun });
      if (!v.dryRun) {
        await files.appendJsonl(src, { t: "shared", path: dest, by: person.id, ts } satisfies ChatLine);
        if (input.title) await files.appendJsonl(src, { t: "title", title: input.title, ts } satisfies ChatLine);
      }
      const note = stripped ? `; ${stripped} file_read result${stripped === 1 ? "" : "s"} left out (they can hold private files)` : "";
      return ok(
        { id: input.id, path: dest, shared: true, stripped },
        `${v.dryRun ? "would share" : "shared"} ${input.id} -> ${dest} (committed, visible to the team)${note}`,
      );
    },
  });
}

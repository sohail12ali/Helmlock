// pages (stream C3): the generated ticket page (F28). One HTML file per ticket in site/t/<T>.html plus site/index.html,
// rewritten after every successful write verb that names a ticket, so a page opens with no server. The console
// serves the same renderer live. site/ is gitignored (F129) and deny-listed for agents (F33, F38).
import type { Context, PluginModule, Ticket, VerbDef } from "@helmlock/core";
import { ok, TicketId } from "@helmlock/core";
import { z } from "zod";
import { parseTestCases, renderIndexPage, renderTicketPage, type TicketPageData } from "./render.ts";

export { REMARK_PLUGINS, renderMarkdown, SANITIZE_SCHEMA } from "./markdown.ts";
export { renderIndexPage, renderTicketPage, type TicketPageData } from "./render.ts";

export const SITE = "site";
export const pagePath = (id: string) => `${SITE}/t/${id}.html`;
export const INDEX_PATH = `${SITE}/index.html`;

const isTicketId = (v: unknown): v is string => typeof v === "string" && TicketId.safeParse(v).success;

/** Everything the ticket page shows, read through the services and the file layer. */
export async function loadTicketPageData(ctx: Context, id: string): Promise<TicketPageData> {
  const files = ctx.get("files");
  const ticket = await ctx.get("tickets").get(id);
  const dir = ticket.dir;
  const readIf = async (rel: string) => ((await files.exists(rel)) ? files.readText(rel) : undefined);
  const all = await files.list(`${dir}/**`);
  // `**` lists folders too; a folder is any entry that prefixes another one.
  const set = new Set(all);
  const fileList = all.filter((p) => ![...set].some((q) => q.startsWith(`${p}/`))).map((p) => p.slice(dir.length + 1));
  const testFiles = fileList.filter((f) => f.startsWith("test-cases/") && f.endsWith(".md"));
  const testCases = [];
  for (const f of testFiles) testCases.push({ file: f, cases: parseTestCases(await files.readText(`${dir}/${f}`)) });
  const [records, tasks, comments, spec, plan] = await Promise.all([
    ctx.get("records").list(id),
    ctx.get("tasks").list(id),
    ctx.get("tickets").comments(id),
    readIf(`${dir}/${id}-spec.md`),
    readIf(`${dir}/${id}-plan.md`),
  ]);
  const data: TicketPageData = { ticket, records, tasks, comments, testCases, files: fileList };
  if (spec !== undefined) data.spec = spec;
  if (plan !== undefined) data.plan = plan;
  if (ctx.has("workflow")) data.stages = ctx.get("workflow").stages();
  return data;
}

export interface BuildResult {
  written: string[];
  unchanged: string[];
  dryRun: boolean;
}

/** Render one ticket (or all when `only` is undefined) and the index. Folders under site/ are created on first write. */
export async function buildPages(ctx: Context, only: string | undefined, dryRun: boolean): Promise<BuildResult> {
  const files = ctx.get("files");
  const tickets: Ticket[] = await ctx.get("tickets").list();
  const targets = only ? [await ctx.get("tickets").get(only)] : tickets;
  const out: BuildResult = { written: [], unchanged: [], dryRun };
  const put = async (rel: string, html: string) => {
    const r = await files.writeText(rel, html, { dryRun });
    (r.changed ? out.written : out.unchanged).push(r.path);
  };
  for (const t of targets) await put(pagePath(t.ticket.id), renderTicketPage(await loadTicketPageData(ctx, t.ticket.id)));
  const ws = ctx.get("workspace");
  const stages = ctx.has("workflow") ? ctx.get("workflow").stages() : [];
  await put(INDEX_PATH, renderIndexPage(tickets, { stages, title: `${ws.name} tickets` }));
  return out;
}

/** Ticket ids named by a verb call: input ticket/id, result data ticket/id (or data.ticket.ticket.id for a Ticket). */
export function ticketIdsOf(input: Record<string, unknown>, data: unknown): string[] {
  const found = new Set<string>();
  const scan = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    for (const k of ["ticket", "id"]) {
      const v = r[k];
      if (isTicketId(v)) found.add(v);
      else if (k === "ticket" && v && typeof v === "object") {
        const inner = v as Record<string, unknown>;
        if (isTicketId(inner.id)) found.add(inner.id);
        else scan(inner);
      }
    }
  };
  scan(input);
  scan(data);
  return [...found];
}

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

function verbs(): VerbDef[] {
  const build = verb({
    id: "page build",
    summary: "Write the generated ticket pages (site/t/<T>.html) and site/index.html; one ticket or all.",
    examples: ["hl page build", "hl page build T-014-sa", "hl page build --dry-run"],
    args: ["ticket"],
    input: z.object({ ticket: TicketId.optional() }),
    // Generated, gitignored output: no activity line; --dry-run still honoured.
    writes: false,
    async run(v, input) {
      const r = await buildPages(v.ctx, input.ticket, v.dryRun);
      const verbWord = v.dryRun ? "would write" : "wrote";
      const lines = [
        `${verbWord} ${r.written.length} page${r.written.length === 1 ? "" : "s"}, ${r.unchanged.length} unchanged`,
        ...r.written.map((p) => `  ${p}`),
      ];
      return ok(r, lines.join("\n"));
    },
  });
  const path = verb({
    id: "page path",
    summary: "Print the path of a ticket's generated page.",
    examples: ["hl page path T-014-sa"],
    args: ["ticket"],
    input: z.object({ ticket: TicketId }),
    writes: false,
    async run(v, input) {
      const files = v.ctx.get("files");
      const rel = pagePath(input.ticket);
      const abs = `${files.root.replace(/\\/g, "/")}/${rel}`;
      const exists = await files.exists(rel);
      return ok({ path: abs, rel, exists }, exists ? abs : `${abs}\n(not built yet: run \`hl page build ${input.ticket}\`)`);
    },
  });
  return [build, path];
}

const plugin: PluginModule = {
  name: "pages",
  requires: ["files", "verbs", "workspace", "tickets", "records", "tasks"],
  async apply(ctx) {
    const verbsSvc = ctx.get("verbs");
    for (const def of verbs()) await ctx.effect(() => verbsSvc.register(def));

    // The post hook payload has no dryRun; remember dry inputs from the pre hook (same object flows through).
    const dry = new WeakSet<object>();
    await ctx.effect(() =>
      ctx.hook("verb/pre-execute", (p, next) => {
        if (p.dryRun) dry.add(p.input);
        return next(p);
      }),
    );
    await ctx.effect(() =>
      ctx.hook("verb/post-execute", async (p, next) => {
        const out = await next(p);
        try {
          if (!out.result.ok || dry.has(p.input) || out.verb.startsWith("page ")) return out;
          if (!verbsSvc.get(out.verb)?.writes) return out;
          const ids = ticketIdsOf(out.input, out.result.data);
          for (const id of ids) {
            if (!(await ctx.get("files").exists(`artifacts/${id}/ticket.toml`))) continue;
            await buildPages(ctx, id, false);
          }
        } catch (e) {
          process.stderr.write(`hl: page refresh after ${out.verb} failed: ${(e as Error).message}\n`);
        }
        return out;
      }),
    );
  },
};

export default plugin;

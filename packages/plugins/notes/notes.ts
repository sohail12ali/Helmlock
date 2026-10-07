// Obsidian notes from the TOML (F52, B24): notes/tickets/<T>.md, notes/records/<id>.md, notes/projects/<id>.md.
// TOML stays the source; notes are generated, gitignored and rebuilt idempotently. Only notes/ is ever touched.
import type { Context, RecordKindName, Task, Ticket, TicketRecord } from "@helmlock/core";
import { ProjectToml } from "@helmlock/core";

export const NOTES = "notes";
type StoredRecord = TicketRecord & { kind: RecordKindName; path: string };

export interface ProjectInfo {
  id: string;
  name: string;
  status: string;
  owners: string[];
  repos: string[];
  goals: string[];
  dir: string;
}

/** projects/<id>/project.toml, sorted by id; unreadable files are skipped. */
export async function readProjects(ctx: Context): Promise<ProjectInfo[]> {
  const files = ctx.get("files");
  const out: ProjectInfo[] = [];
  for (const rel of await files.list("projects/*/project.toml")) {
    try {
      const parsed = ProjectToml.safeParse((await files.readTomlRaw(rel)).data);
      if (!parsed.success) continue;
      const p = parsed.data.project;
      out.push({ id: p.id, name: p.name, status: p.status, owners: p.owners, repos: p.repos, goals: p.goals, dir: rel.replace(/\/project\.toml$/, "") });
    } catch {
      // a broken project.toml is reported by hl validate, not here
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** YAML scalar: plain for safe words, JSON-quoted (valid YAML) otherwise. */
const y = (v: unknown): string => {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v ?? "");
  return /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) && !/ $/.test(s) ? s : JSON.stringify(s);
};
function frontmatter(o: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === "") continue;
    lines.push(Array.isArray(v) ? `${k}: [${v.map(y).join(", ")}]` : `${k}: ${y(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}
/** Vault-path wikilink with an alias, so names that repeat across folders never collide. */
const link = (path: string, label: string) => `[[${path.replace(/\.md$/, "")}|${label}]]`;
const ticketNote = (id: string) => `${NOTES}/tickets/${id}.md`;
const recordNote = (id: string) => `${NOTES}/records/${id}.md`;
const projectNote = (id: string) => `${NOTES}/projects/${id}.md`;
const banner = (src: string) => `> Generated from \`${src}\` by \`hl notes build\`. Change it with \`hl\`, not here.\n`;

const recordTitle = (r: StoredRecord): string => {
  const x = r as Record<string, unknown>;
  return String(x.title ?? x.text ?? r.id);
};

export function renderTicket(t: Ticket, records: StoredRecord[], tasks: Task[], mdFiles: string[]): string {
  const k = t.ticket;
  const fm = frontmatter({
    generated: true,
    type: "ticket",
    id: k.id,
    title: k.title,
    stage: k.stage,
    size: k.size,
    priority: k.priority,
    project: k.project,
    owner: k.owner,
    blocked: t.flags.blocked,
    updated: k.updated,
    tags: ["ticket", `stage/${k.stage}`],
  });
  const out = [fm, `# ${k.id} ${k.title}`, "", banner(`${t.dir}/ticket.toml`)];
  if (k.summary) out.push(k.summary.trim(), "");
  if (t.flags.blocked) out.push(`**Blocked** by ${t.flags.blocked_by ?? "?"}; next: ${t.flags.next_action ?? "?"}`, "");
  const meta: string[] = [];
  if (k.project) meta.push(`Project: ${link(projectNote(k.project), k.project)}`);
  if (k.goal) meta.push(`Goal: ${k.goal}`);
  if (k.owner) meta.push(`Owner: ${k.owner}`);
  if (meta.length) out.push(meta.join(" · "), "");
  if (mdFiles.length)
    out.push(`Files: ${mdFiles.map((f) => link(f, (f.split("/").pop() as string).replace(/\.md$/, "").replace(`${k.id}-`, ""))).join(" · ")}`, "");
  const groups: [RecordKindName, string][] = [
    ["decision", "Decisions"],
    ["question", "Questions"],
    ["bug", "Bugs"],
    ["gap", "Gaps"],
  ];
  for (const [kind, label] of groups) {
    const rs = records.filter((r) => r.kind === kind);
    if (!rs.length) continue;
    out.push(`## ${label}`, "", ...rs.map((r) => `- ${link(recordNote(r.id), r.id)} (${r.status}) ${recordTitle(r)}`), "");
  }
  if (tasks.length) out.push(`Tasks: ${tasks.filter((x) => x.status === "done").length}/${tasks.length} done`, "");
  const rel = [...(t.links.parent ? [t.links.parent] : []), ...t.links.related].filter((x) => /^T-\d+-[a-z]+$/.test(x));
  if (rel.length) out.push(`Related: ${rel.map((x) => link(ticketNote(x), x)).join(" · ")}`, "");
  return `${out.join("\n").trimEnd()}\n`;
}

const RECORD_SKIP = new Set(["schema_version", "id", "ticket", "kind", "path", "title", "text", "status", "author"]);

export function renderRecord(r: StoredRecord): string {
  const x = r as Record<string, unknown>;
  const fm = frontmatter({
    generated: true,
    type: r.kind,
    id: r.id,
    ticket: r.ticket,
    status: r.status,
    author: r.author,
    blocking: r.kind === "question" ? Boolean(x.blocking) : undefined,
    severity: r.kind === "bug" ? x.severity : undefined,
    tags: [r.kind, `${r.kind}/${r.status}`],
  });
  const out = [fm, `# ${r.id} ${recordTitle(r)}`, "", banner(r.path), `Ticket: ${link(ticketNote(r.ticket), r.ticket)}`, ""];
  for (const [key, v] of Object.entries(x)) {
    if (RECORD_SKIP.has(key) || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    out.push(`- **${key}**: ${Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return `${out.join("\n").trimEnd()}\n`;
}

export function renderProject(p: ProjectInfo, tickets: Ticket[], hasHub: boolean): string {
  const fm = frontmatter({ generated: true, type: "project", id: p.id, name: p.name, status: p.status, owners: p.owners, tags: ["project"] });
  const out = [fm, `# ${p.name}`, "", banner(`${p.dir}/project.toml`)];
  if (hasHub) out.push(`Hub: ${link(`${p.dir}/index.md`, "index")}`, "");
  if (p.goals.length) out.push("## Goals", "", ...p.goals.map((g) => `- ${g}`), "");
  if (p.repos.length) out.push(`Repos: ${p.repos.join(", ")}`, "");
  const mine = tickets.filter((t) => t.ticket.project === p.id).sort((a, b) => a.ticket.id.localeCompare(b.ticket.id));
  out.push(
    "## Tickets",
    "",
    ...(mine.length ? mine.map((t) => `- ${link(ticketNote(t.ticket.id), t.ticket.id)} (${t.ticket.stage}) ${t.ticket.title}`) : ["(none)"]),
    "",
  );
  return `${out.join("\n").trimEnd()}\n`;
}

export interface NotesResult {
  written: string[];
  unchanged: number;
  removed: string[];
  dry_run: boolean;
}

/** Build every note (or one ticket's notes). A full build removes notes whose source is gone (archived, deleted). */
export async function buildNotes(ctx: Context, o: { ticket?: string; dryRun?: boolean } = {}): Promise<NotesResult> {
  const files = ctx.get("files");
  const dryRun = o.dryRun ?? false;
  const res: NotesResult = { written: [], unchanged: 0, removed: [], dry_run: dryRun };
  const want = new Set<string>();
  const put = async (rel: string, text: string) => {
    want.add(rel);
    const exists = await files.exists(rel);
    if (exists && (await files.readText(rel)) === text) {
      res.unchanged++;
      return;
    }
    if (!dryRun) await files.writeText(rel, text);
    res.written.push(rel);
  };

  const all = await ctx.get("tickets").list();
  const tickets = o.ticket ? [await ctx.get("tickets").get(o.ticket)] : all;
  for (const t of tickets) {
    const [records, tasks] = await Promise.all([ctx.get("records").list(t.ticket.id), ctx.get("tasks").list(t.ticket.id)]);
    const md = (await files.list(`${t.dir}/*.md`)).sort();
    await put(ticketNote(t.ticket.id), renderTicket(t, records, tasks, md));
    for (const r of records) await put(recordNote(r.id), renderRecord(r));
  }
  if (o.ticket) return res;

  for (const p of await readProjects(ctx)) await put(projectNote(p.id), renderProject(p, all, await files.exists(`${p.dir}/index.md`)));
  for (const sub of ["tickets", "records", "projects"]) {
    for (const rel of await files.list(`${NOTES}/${sub}/*.md`)) {
      if (want.has(rel)) continue;
      if (!dryRun) await files.remove(rel);
      res.removed.push(rel);
    }
  }
  return res;
}

// Todos: one TOML file per todo (one record per file, F62). Ids are a counter plus the author's initials (TD-007-sa)
// so two people never collide. Three scopes (Blueprint 31): team -> todos/<id>.toml, personal (the default) ->
// people/<slug>/todos/<id>.toml, private -> .hl-local/todos/<id>.toml (gitignored, this machine only). The location
// is the truth; the scope field in the file is informational. Activity lines carry only the id, never the text.
import type { Actor, Context, Person, PluginModule, Scope as ScopeT, TodosService, TomlEmitter, VerbDef } from "@helmlock/core";
import { IsoDate, LOCAL_DIR, ok, Priority, SCOPE_LABEL, Scope, scopeDir, scopeGlobs, scopeOfPath, TicketId, TodoId, TodoRecord } from "@helmlock/core";
import { z } from "zod";

export const TODO_KIND = "todo";

export const todoEmitter: TomlEmitter<TodoRecord> = {
  kind: TODO_KIND,
  schema: TodoRecord,
  version: 1,
  order: { "": ["schema_version", "id", "text", "status", "priority", "due", "ticket", "created", "author", "scope"] },
};

/** Where a todo lives in a scope: todos/, people/<slug>/todos/ or .hl-local/todos/. */
export const todoPath = (scope: ScopeT, id: string, slug?: string) => `${scopeDir(scope, "todos", slug)}/${id}.toml`;

function ruleError(rule: string, message: string, fix?: string, file?: string): Error {
  return Object.assign(new Error(message), { rule, fix, file });
}

/** The person accountable for a call: the actor's on_behalf_of, which must be in the roster. */
async function personFor(ctx: Context, actor: Actor): Promise<Person> {
  const roster = ctx.get("roster");
  if (actor.onBehalfOf === ctx.get("workspace").author) return roster.current();
  const p = await roster.get(actor.onBehalfOf);
  if (!p)
    throw ruleError("unknown-author", `author "${actor.onBehalfOf}" is not in people.toml`, "add yourself to people.toml or fix author.local", "people.toml");
  return p;
}

/** A todo with its scope taken from where the file is (the location wins over the field). */
const withScope = (rec: TodoRecord, rel: string): TodoRecord => ({ ...rec, scope: scopeOfPath(rel).scope });

export function createTodos(ctx: Context): TodosService {
  const files = ctx.get("files");
  /** Finds a todo in any scope on this machine. */
  const locate = async (id: string): Promise<string> => {
    if (!TodoId.safeParse(id).success) throw ruleError("bad-id", `not a todo id: ${id}`, "todo ids look like TD-007-sa");
    const hits = (await Promise.all(scopeGlobs("todos", `${id}.toml`).map((g) => files.list(g)))).flat();
    if (!hits.length) throw ruleError("not-found", `no todo ${id}`, "run `hl todo list --all`", todoPath("team", id));
    return hits[0] as string;
  };
  const read = async (id: string) => {
    const rel = await locate(id);
    const r = await files.readToml<TodoRecord>(rel, TODO_KIND);
    return { rel, data: withScope(r.data, rel), hash: r.hash };
  };
  /** Ids stay unique across the team list, every person's list and this machine's private ones. */
  const nextId = async (initials: string): Promise<string> => {
    let max = 0;
    for (const g of scopeGlobs("todos", `TD-*-${initials}.toml`))
      for (const f of await files.list(g)) {
        const m = /TD-(\d+)-[a-z]+\.toml$/.exec(f);
        if (m) max = Math.max(max, Number(m[1]));
      }
    return `TD-${String(max + 1).padStart(3, "0")}-${initials}`;
  };
  return {
    async add(input, actor, opts) {
      const person = await personFor(ctx, actor);
      const scope = input.scope ?? "personal";
      const rec = TodoRecord.parse({
        schema_version: 1,
        id: await nextId(person.initials),
        text: input.text.trim(),
        status: "open",
        priority: input.priority ?? "normal",
        due: input.due,
        ticket: input.ticket,
        created: new Date().toISOString(),
        author: person.id,
        scope,
      });
      await files.writeToml(todoPath(scope, rec.id, person.id), TODO_KIND, rec, { dryRun: opts?.dryRun });
      return rec;
    },
    async move(id, scope, actor, opts) {
      const person = await personFor(ctx, actor);
      const { rel, data } = await read(id);
      const from = scopeOfPath(rel);
      if (from.scope === "personal" && from.slug !== person.id)
        throw ruleError("not-owner", `${id} is on ${from.slug}'s personal list; only ${from.slug} can move it`, undefined, rel);
      const to = todoPath(scope, id, person.id);
      if (to === rel) throw ruleError("same-scope", `${id} is already ${scope} (${rel})`, undefined, rel);
      const rec = TodoRecord.parse({ ...data, scope });
      await files.writeToml(to, TODO_KIND, rec, { dryRun: opts?.dryRun });
      await files.remove(rel, { dryRun: opts?.dryRun });
      return rec;
    },
    async done(id, _actor, opts) {
      const { rel, data, hash } = await read(id);
      const rec = TodoRecord.parse({ ...data, status: "done" });
      await files.writeToml(rel, TODO_KIND, rec, { expectHash: hash, dryRun: opts?.dryRun });
      return rec;
    },
    async list(filter) {
      const me = ctx.get("workspace").author;
      // Team, my personal list (or everyone's when mine is false), and this machine's private ones. Other people's
      // private todos are never on this machine.
      const globs = ["todos/TD-*.toml", `${LOCAL_DIR}/todos/TD-*.toml`];
      if (filter?.mine === false) globs.push("people/*/todos/TD-*.toml");
      else if (me) globs.push(`${scopeDir("personal", "todos", me)}/TD-*.toml`);
      const out: TodoRecord[] = [];
      for (const g of globs)
        for (const f of await files.list(g)) {
          const rec = withScope((await files.readToml<TodoRecord>(f, TODO_KIND)).data, f);
          if (filter?.status && rec.status !== filter.status) continue;
          if (filter?.ticket && rec.ticket !== filter.ticket) continue;
          if (filter?.scope && rec.scope !== filter.scope) continue;
          out.push(rec);
        }
      return out.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    },
  };
}

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();
const scopeTag = (t: TodoRecord) => (t.scope === "team" ? "team    " : t.scope === "private" ? "private " : "personal");
const line = (t: TodoRecord) =>
  `${t.id.padEnd(11)} ${t.status.padEnd(4)} ${scopeTag(t)} ${t.priority.padEnd(6)} ${t.due ? `due ${t.due} ` : ""}${t.ticket ? `[${t.ticket}] ` : ""}${t.text}`;

/** Keeps the input type for run() and erases it for the registry. */
const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

function verbs(): VerbDef[] {
  const add = verb({
    id: "todo add",
    summary: "Add a todo: personal (default, people/<you>/todos, shared with the team), team, or private (this machine only).",
    examples: [
      'hl todo add "Ask ops for the UAT login"',
      'hl todo add "Review spec" --ticket T-014-sa --due 2026-10-09 --priority high',
      'hl todo add "Book the demo room" --scope team',
      'hl todo add "Call the dentist" --scope private',
    ],
    args: ["text"],
    input: z.object({
      text: z.string().trim().min(1),
      ticket: TicketId.optional(),
      due: IsoDate.optional(),
      priority: Priority.optional(),
      scope: Scope.optional(),
    }),
    writes: true,
    async run(v, input) {
      const t = await v.ctx.get("todos").add(input, v.actor, { dryRun: v.dryRun });
      return ok(t, `${v.dryRun ? "would add" : "added"} ${line(t)} (${SCOPE_LABEL[t.scope]})`);
    },
  });
  const move = verb({
    id: "todo move",
    summary: "Move a todo to another scope (team, personal, private); the id stays.",
    examples: ["hl todo move TD-007-sa team", "hl todo move TD-007-sa private"],
    args: ["id", "scope"],
    input: z.object({ id: z.string(), scope: Scope }),
    writes: true,
    async run(v, input) {
      const t = await v.ctx.get("todos").move(input.id, input.scope, v.actor, { dryRun: v.dryRun });
      return ok(t, `${v.dryRun ? "would move" : "moved"} ${t.id} to ${t.scope} (${SCOPE_LABEL[t.scope]})`);
    },
  });
  const done = verb({
    id: "todo done",
    summary: "Mark a todo done.",
    examples: ["hl todo done TD-007-sa"],
    args: ["id"],
    input: z.object({ id: z.string() }),
    writes: true,
    async run(v, input) {
      const t = await v.ctx.get("todos").done(input.id, v.actor, { dryRun: v.dryRun });
      return ok(t, `${v.dryRun ? "would mark done" : "done"} ${line(t)}`);
    },
  });
  const list = verb({
    id: "todo list",
    summary: "List todos: team, your personal and your private ones (open unless --status); --all adds done ones and other people's personal lists.",
    examples: ["hl todo list", "hl todo list --scope team", "hl todo list --all --json", "hl todo list --ticket T-014-sa"],
    input: z.object({ status: z.enum(["open", "done"]).optional(), ticket: z.string().optional(), scope: Scope.optional(), all: flag }),
    writes: false,
    async run(v, input) {
      const status = input.status ?? (input.all ? undefined : "open");
      const items = await v.ctx.get("todos").list({ status, ticket: input.ticket, scope: input.scope, mine: !input.all });
      return ok(items, items.length ? items.map(line).join("\n") : "no todos");
    },
  });
  return [add, move, done, list];
}

const plugin: PluginModule = {
  name: "todos",
  requires: ["files", "verbs", "workspace", "roster"],
  async apply(ctx) {
    const files = ctx.get("files");
    await ctx.effect(() => files.registerEmitter(todoEmitter));
    ctx.provide("todos", createTodos(ctx));
    for (const def of verbs()) await ctx.effect(() => ctx.get("verbs").register(def));
  },
};

export default plugin;

// Todos: one TOML file per todo, todos/<TD-id>.toml (one record per file, F62). Ids are a counter
// plus the author's initials (TD-007-sa) so two people never collide.
import type { Actor, Context, Person, PluginModule, TodosService, TomlEmitter, VerbDef } from "@helmlock/core";
import { IsoDate, ok, Priority, TicketId, TodoId, TodoRecord } from "@helmlock/core";
import { z } from "zod";

export const TODO_KIND = "todo";

export const todoEmitter: TomlEmitter<TodoRecord> = {
  kind: TODO_KIND,
  schema: TodoRecord,
  version: 1,
  order: { "": ["schema_version", "id", "text", "status", "priority", "due", "ticket", "created", "author"] },
};

const todoPath = (id: string) => `todos/${id}.toml`;

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

export function createTodos(ctx: Context): TodosService {
  const files = ctx.get("files");
  const read = async (id: string): Promise<{ data: TodoRecord; hash: string }> => {
    if (!TodoId.safeParse(id).success) throw ruleError("bad-id", `not a todo id: ${id}`, "todo ids look like TD-007-sa");
    if (!(await files.exists(todoPath(id)))) throw ruleError("not-found", `no todo ${id}`, "run `hl todo list --all`", todoPath(id));
    return files.readToml<TodoRecord>(todoPath(id), TODO_KIND);
  };
  const nextId = async (initials: string): Promise<string> => {
    let max = 0;
    for (const f of await files.list(`todos/TD-*-${initials}.toml`)) {
      const m = /TD-(\d+)-[a-z]+\.toml$/.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `TD-${String(max + 1).padStart(3, "0")}-${initials}`;
  };
  return {
    async add(input, actor, opts) {
      const person = await personFor(ctx, actor);
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
      });
      await files.writeToml(todoPath(rec.id), TODO_KIND, rec, { dryRun: opts?.dryRun });
      return rec;
    },
    async done(id, _actor, opts) {
      const { data, hash } = await read(id);
      const rec = TodoRecord.parse({ ...data, status: "done" });
      await files.writeToml(todoPath(id), TODO_KIND, rec, { expectHash: hash, dryRun: opts?.dryRun });
      return rec;
    },
    async list(filter) {
      const out: TodoRecord[] = [];
      for (const f of await files.list("todos/TD-*.toml")) {
        const rec = (await files.readToml<TodoRecord>(f, TODO_KIND)).data;
        if (filter?.status && rec.status !== filter.status) continue;
        if (filter?.ticket && rec.ticket !== filter.ticket) continue;
        out.push(rec);
      }
      return out.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    },
  };
}

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();
const line = (t: TodoRecord) =>
  `${t.id.padEnd(11)} ${t.status.padEnd(4)} ${t.priority.padEnd(6)} ${t.due ? `due ${t.due} ` : ""}${t.ticket ? `[${t.ticket}] ` : ""}${t.text}`;

/** Keeps the input type for run() and erases it for the registry. */
const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

function verbs(): VerbDef[] {
  const add = verb({
    id: "todo add",
    summary: "Add a personal todo, optionally linked to a ticket.",
    examples: ['hl todo add "Ask ops for the UAT login"', 'hl todo add "Review spec" --ticket T-014-sa --due 2026-10-09 --priority high'],
    args: ["text"],
    input: z.object({ text: z.string().trim().min(1), ticket: TicketId.optional(), due: IsoDate.optional(), priority: Priority.optional() }),
    writes: true,
    async run(v, input) {
      const t = await v.ctx.get("todos").add(input, v.actor, { dryRun: v.dryRun });
      return ok(t, `${v.dryRun ? "would add" : "added"} ${line(t)}`);
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
    summary: "List todos (open ones unless --all or --status).",
    examples: ["hl todo list", "hl todo list --all --json", "hl todo list --ticket T-014-sa"],
    input: z.object({ status: z.enum(["open", "done"]).optional(), ticket: z.string().optional(), all: flag }),
    writes: false,
    async run(v, input) {
      const status = input.status ?? (input.all ? undefined : "open");
      const items = await v.ctx.get("todos").list({ status, ticket: input.ticket });
      return ok(items, items.length ? items.map(line).join("\n") : "no todos");
    },
  });
  return [add, done, list];
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

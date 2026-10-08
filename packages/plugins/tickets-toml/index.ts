// tickets-toml (stream S3): provides tickets, records and tasks over plain TOML files (Blueprint 16, B24, B25).
// The workflow and roster services are looked up when a call needs them, so mount order never deadlocks.
import type { PluginModule, RecordsService, TasksService, TicketsService } from "@helmlock/core";
import { EMITTERS } from "./emitters.ts";
import { createStore } from "./store.ts";
import { buildVerbs } from "./verbs.ts";

const plugin: PluginModule = {
  name: "tickets-toml",
  requires: ["files", "verbs"],
  async apply(ctx) {
    const files = ctx.get("files");
    for (const e of EMITTERS) await ctx.effect(() => files.registerEmitter(e));
    const s = createStore(ctx);
    const dry = (o?: { dryRun?: boolean }) => o?.dryRun ?? false;

    const tickets: TicketsService = {
      nextId: (prefix, initials) => s.nextId(prefix, initials),
      create: async (input, actor, o) => (await s.create(input, actor, dry(o))).value,
      get: s.get,
      list: s.list,
      move: async (id, to, actor, o) => (await s.move(id, to, actor, dry(o))).value,
      setBlocked: async (id, b, actor, o) => (await s.setBlocked(id, b, actor, dry(o))).value,
      claim: async (id, actor, o) => (await s.claim(id, actor, dry(o))).value,
      release: async (id, actor, o) => (await s.release(id, actor, dry(o))).value,
      comment: async (id, text, actor, o) => (await s.comment(id, text, actor, dry(o))).value,
      comments: s.comments,
    };
    const records: RecordsService = {
      add: async (kind, ticket, data, actor, o) => (await s.addRecord(kind, ticket, data, actor, dry(o))).value,
      list: s.listRecords,
      get: s.getRecord,
      update: async (id, patch, actor, o) => (await s.updateRecord(id, patch, actor, dry(o))).value,
      blockers: s.blockers,
    };
    const tasks: TasksService = {
      list: s.listTasks,
      add: async (ticket, task, actor, o) => (await s.addTask(ticket, task, actor, dry(o))).value,
      set: async (ticket, id, patch, actor, o) => (await s.setTask(ticket, id, patch, actor, dry(o))).value,
    };
    ctx.provide("tickets", tickets);
    ctx.provide("records", records);
    ctx.provide("tasks", tasks);

    const verbs = ctx.get("verbs");
    for (const d of buildVerbs(ctx, s)) await ctx.effect(() => verbs.register(d));
  },
};

export default plugin;

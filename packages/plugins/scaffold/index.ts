// Scaffold plugin (stream S6): `hl init` creates a knowledge center from templates/knowledge-repo,
// `hl project add` registers a product folder. These two verbs are the only writers of the .code-workspace file (B24).
import { resolve } from "node:path";
import { blocked, type Context, fail, ok, type PluginModule, type ScaffoldService, type VerbCtx } from "@helmlock/core";
import { z } from "zod";
import { type Clack, loadClack } from "./prompts.ts";
import { applyProjectAdd, INITIALS_RE, initRepo, NAME_RE, planInit, planProjectAdd, projectEmitter, SLUG_RE, slugify } from "./scaffold.ts";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const InitInput = z.object({
  dir: z.string().optional(),
  name: z.string().optional(),
  author: z.string().optional(),
  slug: z.string().optional(),
  initials: z.string().optional(),
  email: z.string().optional(),
  delivery: z.string().optional(),
  yes: z.boolean().optional(),
  no_git: z.boolean().optional(),
});
type InitInput = z.infer<typeof InitInput>;

const ProjectAddInput = z.object({
  folder: z.string().min(1),
  path: z.string().optional(),
  id: z.string().optional(),
  yes: z.boolean().optional(),
});

class Cancelled extends Error {
  readonly rule = "cancelled";
}

async function ask(c: Clack, message: string, validate?: (v: string) => string | undefined, initialValue?: string): Promise<string> {
  const v = await c.text({ message, ...(initialValue ? { initialValue } : {}), ...(validate ? { validate: (s) => validate(s ?? "") } : {}) });
  if (c.isCancel(v)) throw new Cancelled("cancelled; nothing was written");
  return v;
}

/** Fills missing init answers with prompts (TTY only). Returns the missing flag names that are still empty. */
async function completeInit(v: VerbCtx, input: InitInput): Promise<string[]> {
  const required = (["dir", "name", "author", "initials"] as const).filter((k) => !input[k]);
  if (required.length === 0 || !v.interactive) return required.map((k) => (k === "dir" ? "<dir>" : `--${k}`));
  const c = await loadClack();
  if (!c) return required.map((k) => (k === "dir" ? "<dir>" : `--${k}`));
  if (!input.name)
    input.name = await ask(c, "Knowledge center name (letters, digits, dashes)", (s) => (NAME_RE.test(s) ? undefined : "letters, digits and dashes only"));
  if (!input.dir) input.dir = await ask(c, "Folder to create", (s) => (s.trim() ? undefined : "required"), `../${input.name}`);
  if (!input.author) input.author = await ask(c, "Your name", (s) => (s.trim() ? undefined : "required"));
  if (!input.initials) {
    const guess = input.author
      .split(/\s+/)
      .map((w) => w[0]?.toLowerCase() ?? "")
      .join("")
      .slice(0, 3);
    input.initials = await ask(c, "Your initials (2 or 3 lowercase letters)", (s) => (INITIALS_RE.test(s) ? undefined : "2 or 3 lowercase letters"), guess);
  }
  if (input.email === undefined) input.email = (await ask(c, "Your email (optional)")).trim() || undefined;
  return [];
}

function initVerb(ctx: Context) {
  return {
    id: "init",
    summary: "Create a new knowledge center (repo) from the base template, with its workspace file, roster, launchers and first commit.",
    examples: [
      'hl init ../acme --name Acme --author "Sam Abbott" --initials sa --email sam@example.com',
      "hl init ../acme --name Acme --author Sam --initials sa --dry-run",
    ],
    args: ["dir"],
    input: InitInput,
    writes: true,
    async run(v: VerbCtx, input: InitInput) {
      const missing = await completeInit(v, input);
      if (missing.length > 0) {
        return fail("missing-args", `missing ${missing.join(", ")}`, {
          fix: 'hl init <dir> --name <Name> --author "<Your Name>" --initials <xx> [--email <e>]',
        });
      }
      const author = input.author as string;
      const slug = input.slug ?? slugify(author);
      if (!SLUG_RE.test(slug)) return fail("bad-author", `cannot derive a slug from "${author}"`, { fix: "--slug <lowercase-slug>" });
      const opts = {
        dir: resolve(v.cwd, input.dir as string),
        name: input.name as string,
        author: { name: author.trim(), slug, initials: input.initials as string, ...(input.email ? { email: input.email } : {}) },
        deliveryRoot: input.delivery ? resolve(v.cwd, input.delivery) : ctx.get("workspace").deliveryRoot,
        dryRun: v.dryRun,
        git: !input.no_git,
      };
      const plan = planInit(opts, today());
      if (v.dryRun) {
        return ok(
          { target: plan.target, delivery_rel: plan.deliveryRel, files: plan.files.map((f) => f.rel), dry_run: true },
          [`would create ${plan.target}  (system = ${plan.deliveryRel})`, ...plan.files.map((f) => `+ ${f.rel}`), "dry run: nothing written"].join("\n"),
        );
      }
      if (v.interactive && !input.yes) {
        const c = await loadClack();
        if (c) {
          c.note(`${plan.target}\n${plan.files.length} files, system = ${plan.deliveryRel}`, `Create ${opts.name}`);
          const yes = await c.confirm({ message: "Create it?", initialValue: true });
          if (c.isCancel(yes) || !yes) return fail("cancelled", "cancelled; nothing was written");
        }
      }
      const { created } = await ctx.get("scaffold").init(opts);
      const wsFile = `${opts.name}.code-workspace`;
      return ok(
        { target: plan.target, delivery_rel: plan.deliveryRel, files: created, git: opts.git, code_workspace: resolve(plan.target, wsFile) },
        [
          `created ${plan.target} (${created.length} files${opts.git ? ", first commit made" : ""})`,
          `open it: ${resolve(plan.target, wsFile)}`,
          `then run: ${process.platform === "win32" ? "hl.cmd" : "./hl"} where`,
        ].join("\n"),
      );
    },
  };
}

function projectAddVerb(ctx: Context) {
  return {
    id: "project add",
    summary: "Add a product repo folder to the workspace file (and its template) and create projects/<id>/.",
    examples: ["hl project add wms-api --path ../wms-api --id wms --dry-run", "hl project add wms-api --path ../wms-api --id wms --yes"],
    args: ["folder"],
    input: ProjectAddInput,
    writes: true,
    async run(v: VerbCtx, input: z.infer<typeof ProjectAddInput>) {
      const files = ctx.get("files");
      const ws = ctx.get("workspace");
      let path = input.path;
      if (!path && v.interactive) {
        const c = await loadClack();
        if (c)
          path = await ask(c, `Path to ${input.folder} (relative to the knowledge repo)`, (s) => (s.trim() ? undefined : "required"), `../${input.folder}`);
      }
      if (!path) return fail("missing-args", "missing --path", { fix: `hl project add ${input.folder} --path ../${input.folder}` });
      const plan = await planProjectAdd(files, ws, { folder: input.folder, path, ...(input.id ? { id: input.id } : {}) });
      const diffText = plan.diff.join("\n");
      if (v.dryRun) return ok({ ...plan, writes: plan.writes.map((w) => w.rel), dry_run: true }, `${diffText}\ndry run: nothing written`);
      if (!input.yes) {
        const c = v.interactive ? await loadClack() : undefined;
        if (!c) {
          return blocked("confirm-required", `hl project add writes the workspace file; confirm with --yes\n${diffText}`, {
            fix: `hl project add ${input.folder} --path ${plan.path} --id ${plan.id} --yes`,
          });
        }
        c.note(diffText, "hl project add");
        const yes = await c.confirm({ message: "Apply these changes?", initialValue: true });
        if (c.isCancel(yes) || !yes) return fail("cancelled", "cancelled; nothing was written");
      }
      const changed = await applyProjectAdd(files, plan, ws.author);
      return ok({ folder: plan.folder, path: plan.path, id: plan.id, changed }, `${diffText}\nwritten: ${changed.join(", ")}`);
    },
  };
}

const plugin: PluginModule = {
  name: "scaffold",
  requires: ["files", "verbs", "workspace"],
  async apply(ctx) {
    const files = ctx.get("files");
    await ctx.effect(() => files.registerEmitter(projectEmitter));
    const service: ScaffoldService = {
      async init(opts) {
        const { created } = initRepo(opts, today());
        return { created };
      },
      async addProject(opts) {
        const ws = ctx.get("workspace");
        const plan = await planProjectAdd(files, ws, { folder: opts.folder, path: opts.path, ...(opts.id ? { id: opts.id } : {}) });
        if (opts.dryRun) return { changed: plan.writes.map((w) => w.rel) };
        return { changed: await applyProjectAdd(files, plan, ws.author) };
      },
    };
    ctx.provide("scaffold", service);
    const verbs = ctx.get("verbs");
    for (const def of [initVerb(ctx), projectAddVerb(ctx)]) {
      const off = verbs.register(def as never);
      await ctx.effect(() => off);
    }
  },
};

export default plugin;

// People verbs (Blueprint 31, after lc-wms .kanban/core/people.py and config/people.toml): `people add`, `people claim`
// and `people unknown`. person.git lists every commit author name and email spelling seen for a person, for
// attribution only. NOTHING IS INFERRED: a spelling belongs to a person only when someone claims it, and the person at
// the keyboard always comes from author.local, never from git.
import { spawnSync } from "node:child_process";
import type { Context, Person, VerbDef } from "@helmlock/core";
import { AuthorSlug, Initials, ok, type PeopleToml, Person as PersonSchema } from "@helmlock/core";
import { z } from "zod";

export interface GitAuthor {
  name: string;
  email: string;
  commits: number;
}

const PEOPLE_FILE = "people.toml";
const PEOPLE_KIND = "people";

/** Commit authors of the repo at `root` (`git log --format=%an|%ae`), most commits first; [] when not a git repo. */
export function gitAuthors(root: string): GitAuthor[] {
  const r = spawnSync("git", ["log", "--format=%an|%ae"], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return [];
  const by = new Map<string, GitAuthor>();
  for (const raw of r.stdout.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const i = raw.lastIndexOf("|");
    const name = (i < 0 ? raw : raw.slice(0, i)).trim();
    const email = (i < 0 ? "" : raw.slice(i + 1)).trim();
    const key = `${name}\0${email}`;
    const a = by.get(key);
    if (a) a.commits++;
    else by.set(key, { name, email, commits: 1 });
  }
  return [...by.values()].sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}

const norm = (s: string) => s.trim().toLowerCase();

/** The person who claimed this spelling (a git list entry, or the person's declared email), if any. */
export function claimant(people: Person[], spelling: string): Person | undefined {
  const s = norm(spelling);
  if (!s) return undefined;
  return people.find((p) => (p.git ?? []).some((g) => norm(g) === s) || (p.email !== undefined && norm(p.email) === s));
}

/** Authors whose name and email nobody claims. */
export function unknownAuthors(people: Person[], authors: GitAuthor[]): GitAuthor[] {
  return authors.filter((a) => !claimant(people, a.name) && !claimant(people, a.email));
}

function ruleError(rule: string, message: string, fix?: string, file?: string): Error {
  return Object.assign(new Error(message), { rule, ...(fix ? { fix } : {}), ...(file ? { file } : {}) });
}

async function readPeople(ctx: Context): Promise<{ data: PeopleToml; hash?: string }> {
  const files = ctx.get("files");
  if (!(await files.exists(PEOPLE_FILE))) return { data: { schema_version: 1, person: [] } };
  return files.readToml<PeopleToml>(PEOPLE_FILE, PEOPLE_KIND);
}

/** A repeatable flag: one value or many. */
const many = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean)));

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;
const describe = (p: Person) => `${p.id} (${p.name}, ${p.initials})${p.git?.length ? ` git: ${p.git.join(", ")}` : ""}`;

export function peopleVerbs(): VerbDef[] {
  const add = verb({
    id: "people add",
    summary: "Add a person to people.toml (id, name, initials; optional email, role and git spellings).",
    examples: ['hl people add ann --name "Ann Lee" --initials al --email ann@example.com --git "Ann Lee" --git ann@example.com'],
    args: ["id"],
    input: z.object({
      id: AuthorSlug,
      name: z.string().trim().min(1),
      initials: Initials,
      role: z.string().trim().min(1).optional(),
      email: z.string().trim().min(1).optional(),
      git: many,
    }),
    writes: true,
    async run(v, input) {
      const { data, hash } = await readPeople(v.ctx);
      const people = data.person;
      if (people.some((p) => p.id === input.id))
        throw ruleError(
          "duplicate",
          `${input.id} is already in ${PEOPLE_FILE}`,
          `use \`hl people claim ${input.id} <spelling>\` to add a git spelling`,
          PEOPLE_FILE,
        );
      const sameInitials = people.find((p) => p.initials === input.initials);
      if (sameInitials)
        throw ruleError(
          "duplicate",
          `initials ${input.initials} already belong to ${sameInitials.id}; ids use them, so they must be unique`,
          "pick other initials",
          PEOPLE_FILE,
        );
      for (const g of input.git) {
        const owner = claimant(people, g);
        if (owner) throw ruleError("claimed", `git spelling "${g}" is already claimed by ${owner.id}`, undefined, PEOPLE_FILE);
      }
      const person = PersonSchema.parse({
        id: input.id,
        name: input.name,
        initials: input.initials,
        ...(input.email ? { email: input.email } : {}),
        ...(input.role ? { role: input.role } : {}),
        git: [...new Set(input.git)],
      });
      const next: PeopleToml = { ...data, person: [...people, person] };
      await v.ctx.get("files").writeToml(PEOPLE_FILE, PEOPLE_KIND, next, { dryRun: v.dryRun, ...(hash ? { expectHash: hash } : {}) });
      return ok(person, `${v.dryRun ? "would add" : "added"} ${describe(person)}`);
    },
  });

  const claim = verb({
    id: "people claim",
    summary: "Claim a git author name or email for a person (attribution only; never inferred).",
    examples: ['hl people claim sam "Sam A."', "hl people claim sam sam@old-laptop.local"],
    args: ["id", "git"],
    input: z.object({ id: AuthorSlug, git: z.string().trim().min(1) }),
    writes: true,
    async run(v, input) {
      const { data, hash } = await readPeople(v.ctx);
      const person = data.person.find((p) => p.id === input.id);
      if (!person)
        throw ruleError(
          "not-found",
          `${input.id} is not in ${PEOPLE_FILE}`,
          `add them first: hl people add ${input.id} --name ... --initials ...`,
          PEOPLE_FILE,
        );
      const owner = claimant(data.person, input.git);
      if (owner && owner.id !== person.id) throw ruleError("claimed", `git spelling "${input.git}" is already claimed by ${owner.id}`, undefined, PEOPLE_FILE);
      if ((person.git ?? []).some((g) => norm(g) === norm(input.git))) return ok(person, `${person.id} already claims "${input.git}"`);
      const updated = PersonSchema.parse({ ...person, git: [...(person.git ?? []), input.git] });
      const next: PeopleToml = { ...data, person: data.person.map((p) => (p.id === person.id ? updated : p)) };
      await v.ctx.get("files").writeToml(PEOPLE_FILE, PEOPLE_KIND, next, { dryRun: v.dryRun, ...(hash ? { expectHash: hash } : {}) });
      return ok(updated, `${v.dryRun ? "would claim" : "claimed"} "${input.git}" for ${person.id}`);
    },
  });

  const unknown = verb({
    id: "people unknown",
    summary: "List git commit authors (name and email) that no person in people.toml claims, with commit counts.",
    examples: ["hl people unknown", "hl people unknown --json"],
    input: z.object({}),
    writes: false,
    async run(v) {
      const people = (await readPeople(v.ctx)).data.person;
      const rows = unknownAuthors(people, gitAuthors(v.ctx.get("workspace").root));
      return ok(
        rows,
        rows.length
          ? `${rows.map((a) => `${String(a.commits).padStart(5)}  ${a.name} <${a.email}>`).join("\n")}\nclaim one with: hl people claim <id> "<name or email>"`
          : "every git author is claimed",
      );
    },
  });

  return [add, claim, unknown];
}

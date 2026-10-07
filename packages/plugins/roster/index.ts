// Roster: people.toml in the knowledge repo, and who the author on this machine is (F1b).
// The author is read from author.local and must be in the roster. It is never guessed from git.
import type { Context, Person, PluginModule, RosterService, TomlEmitter } from "@helmlock/core";
import { PeopleToml } from "@helmlock/core";

export const PEOPLE_FILE = "people.toml";
export const PEOPLE_KIND = "people";

export const peopleEmitter: TomlEmitter<PeopleToml> = {
  kind: PEOPLE_KIND,
  schema: PeopleToml,
  version: 1,
  order: { "": ["schema_version"], person: ["id", "name", "initials", "email", "role"] },
};

export interface RuleError extends Error {
  rule: string;
  file?: string;
  fix?: string;
}

export function unknownAuthor(author: string | undefined): RuleError {
  const who = author ? `author "${author}" (from author.local) is not in ${PEOPLE_FILE}` : `author.local is missing or empty, so the author is unknown`;
  const e = new Error(`${who}; the author is never guessed`) as RuleError;
  e.rule = "unknown-author";
  e.file = author ? PEOPLE_FILE : "author.local";
  e.fix = "add yourself to people.toml or fix author.local";
  return e;
}

export function createRoster(ctx: Context): RosterService {
  const files = ctx.get("files");
  const load = async (): Promise<Person[]> => {
    if (!(await files.exists(PEOPLE_FILE))) return [];
    return (await files.readToml<PeopleToml>(PEOPLE_FILE, PEOPLE_KIND)).data.person;
  };
  return {
    list: load,
    async get(slug) {
      return (await load()).find((p) => p.id === slug);
    },
    async current() {
      const author = ctx.get("workspace").author;
      const person = author ? (await load()).find((p) => p.id === author) : undefined;
      if (!person) throw unknownAuthor(author);
      return person;
    },
  };
}

const plugin: PluginModule = {
  name: "roster",
  requires: ["files", "workspace"],
  async apply(ctx) {
    await ctx.effect(() => ctx.get("files").registerEmitter(peopleEmitter));
    ctx.provide("roster", createRoster(ctx));
  },
};

export default plugin;

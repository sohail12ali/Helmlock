// Milestone 6: GET /api/v1/people (Blueprint 31). `me` comes from author.local and the roster only, never from git;
// unknown_git lists commit authors nobody claims (lc-wms `people --unknown`).
import type { PeopleView, Runtime } from "@helmlock/core";
import { gitAuthors, unknownAuthors } from "@helmlock/plugins/roster/people.ts";

export async function peopleView(runtime: Runtime): Promise<PeopleView> {
  const roster = runtime.ctx.get("roster");
  const people = await roster.list();
  const author = runtime.info.author;
  const mine = author ? people.find((p) => p.id === author) : undefined;
  const me: PeopleView["me"] = mine ? { id: mine.id, name: mine.name, initials: mine.initials, ...(mine.email ? { email: mine.email } : {}) } : null;
  return {
    me,
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      initials: p.initials,
      ...(p.role ? { role: p.role } : {}),
      ...(p.email ? { email: p.email } : {}),
      git: [...(p.git ?? [])],
    })),
    unknown_git: unknownAuthors(people, gitAuthors(runtime.ctx.get("workspace").root)),
  };
}

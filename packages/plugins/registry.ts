// Static plugin catalog (owned by integration). Each entry is lazy: nothing loads until a verb needs it.
import { join } from "node:path";
import type { PluginCatalog } from "@helmlock/core";

const here = import.meta.dirname;

export const catalog: PluginCatalog = {
  roster: { dir: join(here, "roster"), load: () => import("./roster/index.ts") },
  activity: { dir: join(here, "activity"), load: () => import("./activity/index.ts") },
  "tickets-toml": { dir: join(here, "tickets-toml"), load: () => import("./tickets-toml/index.ts") },
  "workflow-lite": { dir: join(here, "workflow-lite"), load: () => import("./workflow-lite/index.ts") },
  validate: { dir: join(here, "validate"), load: () => import("./validate/index.ts") },
  todos: { dir: join(here, "todos"), load: () => import("./todos/index.ts") },
  "work-log": { dir: join(here, "work-log"), load: () => import("./work-log/index.ts") },
  search: { dir: join(here, "search"), load: () => import("./search/index.ts") },
  context: { dir: join(here, "context"), load: () => import("./context/index.ts") },
  skills: { dir: join(here, "skills"), load: () => import("./skills/index.ts") },
  harness: { dir: join(here, "harness"), load: () => import("./harness/index.ts") },
  runtimes: { dir: join(here, "runtimes"), load: () => import("./runtimes/index.ts") },
  "runtime-claude": { dir: join(here, "runtime-claude"), load: () => import("./runtime-claude/index.ts") },
  "runtime-cursor": { dir: join(here, "runtime-cursor"), load: () => import("./runtime-cursor/index.ts") },
  scaffold: { dir: join(here, "scaffold"), load: () => import("./scaffold/index.ts") },
  pages: { dir: join(here, "pages"), load: () => import("./pages/index.ts") },
};

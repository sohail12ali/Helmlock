// Test-only fakes for services owned by other streams (roster, activity), so S3 tests code against contracts only.
import type { ActivityLine, Person, PluginCatalog, PluginModule } from "@helmlock/core";
import { catalog } from "../registry.ts";

export const PEOPLE: Person[] = [
  { id: "sam", name: "Sam Abbott", initials: "sa" },
  { id: "kim", name: "Kim Lee", initials: "kl" },
];

export const activityLines: ActivityLine[] = [];

const fakeRoster: PluginModule = {
  name: "roster",
  apply(ctx) {
    ctx.provide("roster", {
      list: async () => PEOPLE,
      get: async (slug) => PEOPLE.find((p) => p.id === slug),
      current: async () => PEOPLE[0]!,
    });
  },
};

const fakeActivity: PluginModule = {
  name: "activity",
  apply(ctx) {
    ctx.provide("activity", {
      append: async (line) => {
        activityLines.push({ ...line, ts: line.ts ?? new Date().toISOString() } as ActivityLine);
      },
      read: async () => activityLines,
    });
  },
};

/** The real catalog with roster and activity swapped for in-memory fakes. */
export const testCatalog: PluginCatalog = {
  ...catalog,
  roster: { dir: catalog.roster!.dir, load: async () => ({ default: fakeRoster }) },
  activity: { dir: catalog.activity!.dir, load: async () => ({ default: fakeActivity }) },
};

export const KIM = { kind: "person" as const, id: "kim", onBehalfOf: "kim" };

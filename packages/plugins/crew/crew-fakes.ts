// Test doubles for the crew: a runtimes registry with three fake engines, a run manager that records what it is asked
// to start, and a providers service with one model. Used by the crew plugin tests and the server crew/thread tests.
import type {
  ModelInfo,
  PluginCatalog,
  PluginModule,
  ProvidersService,
  RunManagerService,
  RunStartOptions,
  RunState,
  RuntimeAdapter,
  RuntimesService,
} from "@helmlock/core";
import { catalog } from "../registry.ts";

export interface FakeRunManager extends RunManagerService {
  runs: RunState[];
  starts: RunStartOptions[];
  says: { id: string; text: string; by: string }[];
  /** What say() answers: "live" (steer) or "queued". */
  sayMode: "live" | "queued";
  /** Add a run as if it had happened (newest first in list()). */
  seed(s: Partial<RunState> & { id: string }): RunState;
}

export function fakeRunManager(): FakeRunManager {
  let n = 0;
  const nope = async (): Promise<never> => {
    throw new Error("not in the fake");
  };
  const m: FakeRunManager = {
    runs: [],
    starts: [],
    says: [],
    sayMode: "live",
    seed(s) {
      const state: RunState = { runtime: "claude-code", mode: "ask", status: "done", started: new Date().toISOString(), ...s };
      m.runs.push(state);
      m.runs.sort((a, b) => b.started.localeCompare(a.started));
      return state;
    },
    async start(o) {
      m.starts.push(o);
      const s: RunState = {
        id: `r-${++n}`,
        runtime: o.runtime ?? "claude-code",
        mode: o.mode ?? "ask",
        status: "running",
        started: new Date(Date.now() + n).toISOString(),
        ...(o.ticket ? { ticket: o.ticket } : {}),
        ...(o.role ? { role: o.role } : {}),
        ...(o.agent ? { agent: o.agent } : {}),
        ...(o.model ? { model: o.model } : {}),
        ...(o.origin ? { origin: o.origin } : {}),
      };
      m.runs.unshift(s);
      return { ...s };
    },
    get: (id) => m.runs.find((r) => r.id === id),
    active: () => m.runs.filter((r) => r.status === "running" || r.status === "queued"),
    events: () => ({ async *[Symbol.asyncIterator]() {} }),
    cancel: nope,
    async list(f = {}) {
      const out = m.runs.filter((r) => (!f.ticket || r.ticket === f.ticket) && (!f.role || (r.role ?? r.agent) === f.role));
      return f.limit ? out.slice(0, f.limit) : out;
    },
    async say(id, text, by) {
      m.says.push({ id, text, by });
      return m.sayMode;
    },
    report: nope,
    resetSession: nope,
    diff: nope,
    merge: nope,
  };
  return m;
}

const adapter = (a: Partial<RuntimeAdapter> & { id: string }): RuntimeAdapter => ({
  detect: async () => ({ command: a.id }),
  start: async () => {
    throw new Error("fake engines do not run");
  },
  ...a,
});

/** claude-code (test ok), cursor (test fails: not signed in), loop (no test: detect finds it). */
export function fakeRuntimes(): RuntimesService {
  const adapters = new Map<string, RuntimeAdapter>();
  for (const a of [
    adapter({
      id: "claude-code",
      label: "Claude Code",
      capabilities: { resume: true, steer: false, approve: true, models: true },
      test: async () => ({ ok: true, checks: [{ level: "info", message: "signed in" }] }),
    }),
    adapter({
      id: "cursor",
      label: "Cursor",
      test: async () => ({ ok: false, checks: [{ level: "error", message: "not signed in" }] }),
    }),
    adapter({ id: "loop", label: "Helmlock loop", capabilities: { resume: true, steer: true, approve: true, models: true } }),
  ])
    adapters.set(a.id, a);
  return {
    register(a) {
      adapters.set(a.id, a);
      return () => {
        adapters.delete(a.id);
      };
    },
    get: (id) => adapters.get(id),
    list: () => [...adapters.values()],
  };
}

export const FAKE_MODEL: ModelInfo = {
  id: "or/deepseek-chat",
  provider: "or",
  label: "DeepSeek",
  capabilities: { tool_calls: true, vision: false, streaming: true },
};

function fakeProviders(): ProvidersService {
  const nope = () => {
    throw new Error("not in the fake");
  };
  return {
    providers: () => [],
    models: () => [FAKE_MODEL],
    defaultModel: () => FAKE_MODEL.id,
    complete: nope,
    probe: nope,
    probeDraft: nope,
  };
}

const noop: PluginModule = { name: "noop", apply() {} };
const entry = (id: string, mod: PluginModule) => ({ dir: (catalog[id] as { dir: string }).dir, load: async () => ({ default: mod }) });

/** The real catalog with the runtimes, adapters and providers replaced by fakes. */
export function fakeCatalog(rm: FakeRunManager): PluginCatalog {
  const runtimes: PluginModule = {
    name: "runtimes",
    apply(ctx) {
      ctx.provide("runtimes", fakeRuntimes());
      ctx.provide("runManager", rm);
    },
  };
  const providers: PluginModule = {
    name: "providers",
    apply(ctx) {
      ctx.provide("providers", fakeProviders());
    },
  };
  return {
    ...catalog,
    runtimes: entry("runtimes", runtimes),
    "runtime-claude": entry("runtime-claude", noop),
    "runtime-cursor": entry("runtime-cursor", noop),
    providers: entry("providers", providers),
  };
}

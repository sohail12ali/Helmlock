// The plugin kernel (F40, F101, F102, F104, F105).
// Ported in spirit from Cordis (MIT, Copyright (c) 2021-present Shigma, vendored in deepseek-harness):
// the effect tree per scope (fiber.ts), `requires` that keep a plugin pending and restart it when a
// provider changes (fiber.ts / registry.ts), and the waterfall dispatch with next() (events.ts).
// Deny-only guards follow deepseek-harness packages/core/tools (MIT, Copyright (c) 2026 DeepSeek).
// Left out on purpose: proxies, isolation, hot reload, config update without restart.

import type { Events } from "../contracts/events.ts";
import type { Hooks } from "../contracts/hooks.ts";
import type { Context, Disposer, GuardFn, HookHandler, HookOptions, Kernel, MountResult, PendingPlugin, PluginModule } from "../contracts/kernel.ts";
import type { Services } from "../contracts/services.ts";

type Key = keyof Services;

interface HookEntry {
  handler: HookHandler<unknown>;
  priority: number;
  owner: string;
  seq: number;
}

interface GuardEntry {
  fn: GuardFn<unknown>;
  owner: string;
}

interface Shared {
  services: Map<Key, { impl: unknown; owner: string }>;
  listeners: Map<string, Set<(p: unknown) => void | Promise<void>>>;
  hooks: Map<string, HookEntry[]>;
  guards: Map<string, GuardEntry[]>;
  seq: number;
  /** Called after a service is added or removed. */
  changed: (key: Key) => void;
  log: (line: string) => void;
}

/** One node of the effect tree. Everything registered through it is undone, newest first, on dispose. */
class Scope implements Context {
  readonly name: string;
  readonly parent: Context | undefined;
  /** Plugin that owns this scope (the scope directly under root), used for hook tie-breaks. */
  readonly plugin: string;
  private readonly shared: Shared;
  private readonly disposers: Disposer[] = [];
  private disposed = false;

  constructor(name: string, parent: Scope | undefined, shared: Shared) {
    this.name = name;
    this.parent = parent;
    this.shared = shared;
    this.plugin = !parent ? name : !parent.parent ? name : parent.plugin;
  }

  get active(): boolean {
    return !this.disposed;
  }

  private assertActive(what: string): void {
    if (this.disposed) throw new Error(`scope ${this.name} is disposed; cannot ${what}`);
  }

  /** Track a disposer on this scope; the returned disposer is idempotent and unlinks itself. */
  private track(d: Disposer): Disposer {
    let done = false;
    const once: Disposer = () => {
      if (done) return;
      done = true;
      const i = this.disposers.indexOf(once);
      if (i >= 0) this.disposers.splice(i, 1);
      return d();
    };
    this.disposers.push(once);
    return once;
  }

  child(name: string): Context {
    this.assertActive("create a child");
    const c = new Scope(name, this, this.shared);
    this.track(() => c.dispose());
    return c;
  }

  provide<K extends Key>(key: K, impl: Services[K]): Disposer {
    this.assertActive(`provide ${key}`);
    const cur = this.shared.services.get(key);
    if (cur) throw Object.assign(new Error(`service already provided: ${key} (by ${cur.owner})`), { rule: "duplicate-provider" });
    const entry = { impl, owner: this.plugin };
    this.shared.services.set(key, entry);
    this.shared.changed(key);
    return this.track(() => {
      if (this.shared.services.get(key) === entry) {
        this.shared.services.delete(key);
        this.shared.changed(key);
      }
    });
  }

  get<K extends Key>(key: K): Services[K] {
    const s = this.shared.services.get(key);
    if (!s) throw Object.assign(new Error(`pending service: ${key}`), { rule: "pending-service" });
    return s.impl as Services[K];
  }

  has(key: Key): boolean {
    return this.shared.services.has(key);
  }

  async effect(fn: () => Disposer | undefined | Promise<Disposer | undefined>): Promise<Disposer> {
    this.assertActive("run an effect");
    const d = await fn();
    if (this.disposed) {
      // The scope went away while the effect was starting: undo it at once.
      await d?.();
      return () => {};
    }
    return this.track(d ?? (() => {}));
  }

  on<E extends keyof Events>(event: E, handler: (payload: Events[E]) => void | Promise<void>): Disposer {
    this.assertActive(`listen to ${event}`);
    let set = this.shared.listeners.get(event);
    if (!set) {
      set = new Set();
      this.shared.listeners.set(event, set);
    }
    const h = handler as (p: unknown) => void | Promise<void>;
    set.add(h);
    return this.track(() => {
      set.delete(h);
    });
  }

  async emit<E extends keyof Events>(event: E, payload: Events[E]): Promise<void> {
    const set = this.shared.listeners.get(event);
    if (!set?.size) return;
    await Promise.all(
      [...set].map(async (h) => {
        try {
          await h(payload);
        } catch (e) {
          this.shared.log(`listener for ${event} failed: ${(e as Error).message}`);
        }
      }),
    );
  }

  hook<H extends keyof Hooks>(name: H, handler: HookHandler<Hooks[H]>, opts?: HookOptions): Disposer {
    this.assertActive(`hook ${name}`);
    const list = this.shared.hooks.get(name) ?? [];
    const entry: HookEntry = { handler: handler as HookHandler<unknown>, priority: opts?.priority ?? 0, owner: this.plugin, seq: this.shared.seq++ };
    list.push(entry);
    // Priority descending; ties by plugin name, never by load order; same plugin keeps registration order.
    list.sort((a, b) => b.priority - a.priority || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : a.seq - b.seq));
    this.shared.hooks.set(name, list);
    return this.track(() => {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    });
  }

  async runHook<H extends keyof Hooks>(name: H, payload: Hooks[H]): Promise<Hooks[H]> {
    const list = [...(this.shared.hooks.get(name) ?? [])];
    const step = async (i: number, p: unknown): Promise<unknown> => {
      const e = list[i];
      if (!e) return p;
      const r = await e.handler(p, (np?: unknown) => step(i + 1, np ?? p) as Promise<never>);
      return r === undefined ? p : r;
    };
    return (await step(0, payload)) as Hooks[H];
  }

  guard<H extends keyof Hooks>(name: H, fn: GuardFn<Hooks[H]>): Disposer {
    this.assertActive(`guard ${name}`);
    const list = this.shared.guards.get(name) ?? [];
    const entry: GuardEntry = { fn: fn as GuardFn<unknown>, owner: this.name };
    list.push(entry);
    this.shared.guards.set(name, list);
    return this.track(() => {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    });
  }

  /**
   * Guards are owned by the scope that registered them (and go away with it) but apply to every check,
   * whichever scope asks: the scope tree is an ownership tree, not a visibility tree. A guard that throws denies.
   */
  async checkGuards<H extends keyof Hooks>(name: H, payload: Hooks[H]): Promise<string[]> {
    const reasons: string[] = [];
    for (const g of [...(this.shared.guards.get(name) ?? [])]) {
      try {
        const r = await g.fn(payload);
        if (r) reasons.push(r);
      } catch (e) {
        reasons.push(`guard ${g.owner} failed: ${(e as Error).message} (fail-closed)`);
      }
    }
    return reasons;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of [...this.disposers].reverse()) {
      try {
        await d();
      } catch (e) {
        this.shared.log(`dispose in ${this.name} failed: ${(e as Error).message}`);
      }
    }
    this.disposers.length = 0;
  }
}

interface PluginRecord {
  id: string;
  mod: PluginModule;
  config: unknown;
  state: MountResult["state"];
  ctx?: Scope;
  waitingFor: Key[];
  error?: string;
}

export interface KernelOptions {
  /** Where kernel diagnostics go (default stderr). */
  log?: (line: string) => void;
}

export interface FullKernel extends Kernel {
  /** Resolves once every pending mount/unmount caused by service changes has run. */
  settled(): Promise<void>;
  /** Every plugin and its state. */
  states(): MountResult[];
}

export function createKernel(o: KernelOptions = {}): FullKernel {
  const log = o.log ?? ((line: string) => process.stderr.write(`hl: ${line}\n`));
  const plugins = new Map<string, PluginRecord>();
  let disposing = false;
  let running = false;
  let dirty = false;
  let queue: Promise<void> = Promise.resolve();

  const shared: Shared = {
    services: new Map(),
    listeners: new Map(),
    hooks: new Map(),
    guards: new Map(),
    seq: 0,
    changed: () => {
      if (disposing) return;
      if (running) dirty = true;
      else void schedule();
    },
    log,
  };
  const root = new Scope("root", undefined, shared);

  const missing = (rec: PluginRecord): Key[] => (rec.mod.requires ?? []).filter((k) => !shared.services.has(k));

  const activate = async (rec: PluginRecord): Promise<void> => {
    const ctx = root.child(rec.id) as Scope;
    rec.ctx = ctx;
    try {
      const cfg = rec.mod.Config ? rec.mod.Config.parse(rec.config ?? {}) : (rec.config ?? {});
      await rec.mod.apply(ctx, cfg);
      rec.state = "active";
      rec.waitingFor = [];
      rec.error = undefined;
    } catch (e) {
      rec.state = "failed";
      rec.error = (e as Error).message;
      rec.ctx = undefined;
      await ctx.dispose();
      log(`plugin ${rec.id} failed: ${rec.error}`);
    }
  };

  /** Bring every plugin to the state its requirements allow; loops until nothing changes. */
  const reconcile = async (): Promise<void> => {
    running = true;
    try {
      do {
        dirty = false;
        for (const rec of plugins.values()) {
          if (disposing) return;
          const miss = missing(rec);
          if (rec.state === "active" && miss.length) {
            // A provider went away: unmount and wait again (restart when it comes back).
            const ctx = rec.ctx;
            rec.ctx = undefined;
            rec.state = "pending";
            rec.waitingFor = miss;
            await ctx?.dispose();
            dirty = true;
          } else if (rec.state === "pending") {
            rec.waitingFor = miss;
            if (!miss.length) {
              await activate(rec);
              dirty = true;
            }
          }
        }
      } while (dirty);
    } finally {
      running = false;
    }
  };

  const schedule = (): Promise<void> => {
    queue = queue.then(reconcile, reconcile);
    return queue;
  };

  const result = (rec: PluginRecord): MountResult => {
    const r: MountResult = { id: rec.id, state: rec.state };
    if (rec.state === "pending") r.waitingFor = [...rec.waitingFor];
    if (rec.error) r.error = rec.error;
    return r;
  };

  return {
    root,
    async mount(id, mod, config) {
      if (plugins.has(id)) {
        const cur = plugins.get(id) as PluginRecord;
        if (cur.mod === mod) return result(cur);
        await this.unmount(id);
      }
      const rec: PluginRecord = { id, mod, config, state: "pending", waitingFor: [] };
      plugins.set(id, rec);
      await schedule();
      return result(rec);
    },
    async unmount(id) {
      const rec = plugins.get(id);
      if (!rec) return;
      plugins.delete(id);
      const ctx = rec.ctx;
      rec.ctx = undefined;
      await queue;
      await ctx?.dispose();
      await schedule();
    },
    pending: () => [...plugins.values()].filter((r) => r.state === "pending").map((r) => ({ id: r.id, waitingFor: [...r.waitingFor] }) satisfies PendingPlugin),
    states: () => [...plugins.values()].map(result),
    settled: async () => {
      await queue;
    },
    async dispose() {
      await queue;
      disposing = true;
      await root.dispose();
      plugins.clear();
    },
  };
}

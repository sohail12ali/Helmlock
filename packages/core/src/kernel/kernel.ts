// WALKING SKELETON (wave 0). S1 replaces this with the full kernel (requires/restart, loud startup).

import type { Events } from "../contracts/events.ts";
import type { Hooks } from "../contracts/hooks.ts";
import type { Context, Disposer, GuardFn, HookHandler, HookOptions, Kernel, MountResult, PendingPlugin, PluginModule } from "../contracts/kernel.ts";
import type { Services } from "../contracts/services.ts";

interface HookEntry {
  handler: HookHandler<unknown>;
  priority: number;
  owner: string;
}

interface Shared {
  services: Map<string, unknown>;
  listeners: Map<string, Set<(p: unknown) => void | Promise<void>>>;
  hooks: Map<string, HookEntry[]>;
}

class Scope implements Context {
  readonly name: string;
  readonly parent: Context | undefined;
  private readonly shared: Shared;
  private readonly disposers: Disposer[] = [];
  private readonly guards = new Map<string, GuardFn<unknown>[]>();
  private disposed = false;

  constructor(name: string, parent: Scope | undefined, shared: Shared) {
    this.name = name;
    this.parent = parent;
    this.shared = shared;
  }

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
    const c = new Scope(name, this, this.shared);
    this.track(() => c.dispose());
    return c;
  }

  provide<K extends keyof Services>(key: K, impl: Services[K]): Disposer {
    if (this.shared.services.has(key)) throw new Error(`service already provided: ${key}`);
    this.shared.services.set(key, impl);
    return this.track(() => {
      this.shared.services.delete(key);
    });
  }

  get<K extends keyof Services>(key: K): Services[K] {
    if (!this.shared.services.has(key)) throw new Error(`pending service: ${key}`);
    return this.shared.services.get(key) as Services[K];
  }

  has(key: keyof Services): boolean {
    return this.shared.services.has(key);
  }

  async effect(fn: () => Disposer | undefined | Promise<Disposer | undefined>): Promise<Disposer> {
    const d = await fn();
    return this.track(d ?? (() => {}));
  }

  on<E extends keyof Events>(event: E, handler: (payload: Events[E]) => void | Promise<void>): Disposer {
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
    if (!set) return;
    await Promise.all(
      [...set].map(async (h) => {
        try {
          await h(payload);
        } catch (e) {
          process.stderr.write(`listener for ${event} failed: ${(e as Error).message}\n`);
        }
      }),
    );
  }

  hook<H extends keyof Hooks>(name: H, handler: HookHandler<Hooks[H]>, opts?: HookOptions): Disposer {
    const list = this.shared.hooks.get(name) ?? [];
    const entry: HookEntry = { handler: handler as HookHandler<unknown>, priority: opts?.priority ?? 0, owner: this.name };
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority || a.owner.localeCompare(b.owner));
    this.shared.hooks.set(name, list);
    return this.track(() => {
      const l = this.shared.hooks.get(name);
      if (l) l.splice(l.indexOf(entry), 1);
    });
  }

  async runHook<H extends keyof Hooks>(name: H, payload: Hooks[H]): Promise<Hooks[H]> {
    const list = [...(this.shared.hooks.get(name) ?? [])];
    const step = async (i: number, p: unknown): Promise<unknown> => {
      const e = list[i];
      if (!e) return p;
      return e.handler(p, (np?: unknown) => step(i + 1, np ?? p) as Promise<never>);
    };
    return (await step(0, payload)) as Hooks[H];
  }

  guard<H extends keyof Hooks>(name: H, fn: GuardFn<Hooks[H]>): Disposer {
    const list = this.guards.get(name) ?? [];
    list.push(fn as GuardFn<unknown>);
    this.guards.set(name, list);
    return this.track(() => {
      list.splice(list.indexOf(fn as GuardFn<unknown>), 1);
    });
  }

  async checkGuards<H extends keyof Hooks>(name: H, payload: Hooks[H]): Promise<string[]> {
    const reasons: string[] = [];
    for (let s: Scope | undefined = this; s; s = s.parent as Scope | undefined) {
      for (const g of s.guards.get(name) ?? []) {
        const r = await g(payload);
        if (r) reasons.push(r);
      }
    }
    return reasons;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of [...this.disposers].reverse()) await d();
    this.disposers.length = 0;
  }
}

export function createKernel(): Kernel {
  const shared: Shared = { services: new Map(), listeners: new Map(), hooks: new Map() };
  const root = new Scope("root", undefined, shared);
  const mounted = new Map<string, Context>();
  const waiting = new Map<string, PendingPlugin>();

  return {
    root,
    async mount(id: string, mod: PluginModule, config?: unknown): Promise<MountResult> {
      const missing = (mod.requires ?? []).filter((k) => !root.has(k));
      if (missing.length) {
        waiting.set(id, { id, waitingFor: [...missing] });
        return { id, state: "pending", waitingFor: [...missing] };
      }
      const ctx = root.child(id);
      try {
        const cfg = mod.Config ? mod.Config.parse(config ?? {}) : (config ?? {});
        await mod.apply(ctx, cfg);
        mounted.set(id, ctx);
        waiting.delete(id);
        return { id, state: "active" };
      } catch (e) {
        await ctx.dispose();
        return { id, state: "failed", error: (e as Error).message };
      }
    },
    async unmount(id: string) {
      await mounted.get(id)?.dispose();
      mounted.delete(id);
    },
    pending: () => [...waiting.values()],
    dispose: () => root.dispose(),
  };
}

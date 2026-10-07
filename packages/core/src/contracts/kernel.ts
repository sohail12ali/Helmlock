// FROZEN CONTRACT (milestone 1). Change only through a contract request at integration.
import type { z } from "zod";
import type { Events } from "./events.ts";
import type { Hooks } from "./hooks.ts";
import type { Services } from "./services.ts";

/** Undoes one registration. Safe to call twice. */
export type Disposer = () => void | Promise<void>;

/** Waterfall hook: call next() to continue the chain; return the (possibly changed) payload. Not calling next() vetoes the rest. */
export type HookHandler<T> = (payload: T, next: (payload?: T) => Promise<T>) => T | Promise<T>;

export interface HookOptions {
  /** Higher runs first. Ties break by plugin name, never by load order. Default 0. */
  priority?: number;
}

/** A guard can only deny: return a reason string to deny, undefined to pass. */
export type GuardFn<T> = (payload: T) => string | undefined | Promise<string | undefined>;

export interface Context {
  readonly name: string;
  readonly parent: Context | undefined;
  /** A child scope; disposing it undoes everything registered through it. */
  child(name: string): Context;
  /** Register a service. A second provider for the same key is an error. */
  provide<K extends keyof Services>(key: K, impl: Services[K]): Disposer;
  /** Throws `pending service: <key>` when absent. */
  get<K extends keyof Services>(key: K): Services[K];
  has(key: keyof Services): boolean;
  /** Run a side effect owned by this scope; its disposer runs (in reverse order) on dispose. */
  effect(fn: () => Disposer | undefined | Promise<Disposer | undefined>): Promise<Disposer>;
  on<E extends keyof Events>(event: E, handler: (payload: Events[E]) => void | Promise<void>): Disposer;
  /** Observe-only: listeners run in parallel, errors are logged, never thrown to the emitter. */
  emit<E extends keyof Events>(event: E, payload: Events[E]): Promise<void>;
  hook<H extends keyof Hooks>(name: H, handler: HookHandler<Hooks[H]>, opts?: HookOptions): Disposer;
  runHook<H extends keyof Hooks>(name: H, payload: Hooks[H]): Promise<Hooks[H]>;
  guard<H extends keyof Hooks>(name: H, fn: GuardFn<Hooks[H]>): Disposer;
  /** Every deny reason from guards on this scope chain (empty = allowed). */
  checkGuards<H extends keyof Hooks>(name: H, payload: Hooks[H]): Promise<string[]>;
  dispose(): Promise<void>;
}

/** The one plugin form (F101). */
export interface PluginModule<C extends z.ZodType = z.ZodType> {
  name: string;
  /** Service keys that must exist before apply() runs; the plugin stays pending until then. */
  requires?: readonly (keyof Services)[];
  Config?: C;
  apply(ctx: Context, config: z.infer<C>): void | Promise<void>;
}

export interface PendingPlugin {
  id: string;
  waitingFor: (keyof Services)[];
}

export interface MountResult {
  id: string;
  state: "active" | "pending" | "failed";
  waitingFor?: (keyof Services)[];
  error?: string;
}

export interface Kernel {
  readonly root: Context;
  /** Mount a plugin with validated config. Failure of one plugin leaves the rest running. */
  mount(id: string, mod: PluginModule, config?: unknown): Promise<MountResult>;
  unmount(id: string): Promise<void>;
  /** Loud startup (F105): every plugin still waiting and what for. */
  pending(): PendingPlugin[];
  dispose(): Promise<void>;
}

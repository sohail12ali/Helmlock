// Helper to declare a closed TOML emitter (F25): one record kind, its schema, key order and migrations.
import type { z } from "zod";
import type { TomlEmitter } from "../contracts/files.ts";

export interface EmitterSpec<T> {
  kind: string;
  schema: z.ZodType<T>;
  /** Highest schema_version this code writes and understands. */
  version: number;
  /** "" = root keys (scalars and table names), then one entry per table, array of tables or "table.sub". */
  order: Record<string, readonly string[]>;
  /** migrations[n] upgrades a version-n record to n+1; every step below `version` that a file may need. */
  migrations?: Record<number, (data: Record<string, unknown>) => Record<string, unknown>>;
}

/** Validate an emitter spec once, at definition time, and return it frozen. */
export function defineEmitter<T>(spec: EmitterSpec<T>): TomlEmitter<T> {
  if (!spec.kind) throw new Error("defineEmitter: kind is required");
  if (!Number.isInteger(spec.version) || spec.version < 1) throw new Error(`defineEmitter(${spec.kind}): version must be a positive integer`);
  if (!spec.order[""]) throw new Error(`defineEmitter(${spec.kind}): order[""] (root key order) is required`);
  for (const [k, list] of Object.entries(spec.order)) {
    if (new Set(list).size !== list.length) throw new Error(`defineEmitter(${spec.kind}): duplicate key in order["${k}"]`);
  }
  for (const n of Object.keys(spec.migrations ?? {}).map(Number)) {
    if (!Number.isInteger(n) || n < 1 || n >= spec.version) {
      throw new Error(`defineEmitter(${spec.kind}): migration ${n} must upgrade a version below ${spec.version}`);
    }
  }
  const order = Object.freeze(Object.fromEntries(Object.entries(spec.order).map(([k, v]) => [k, Object.freeze([...v])])));
  return Object.freeze({
    kind: spec.kind,
    schema: spec.schema,
    version: spec.version,
    order,
    ...(spec.migrations ? { migrations: Object.freeze({ ...spec.migrations }) } : {}),
  });
}

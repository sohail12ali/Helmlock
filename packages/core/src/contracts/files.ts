// FROZEN CONTRACT (milestone 1). The only way state files are read and written (F25, F57).
import type { z } from "zod";
import type { Disposer } from "./kernel.ts";

/**
 * A closed emitter for one record kind: no generic TOML dumper.
 * `order` maps a table path ("" = root, "ticket", "flags", "task" for an array of tables) to its key order.
 * Keys not listed (unknown keys) are written after the listed ones, in their original order.
 * Generated files carry no comments.
 */
export interface TomlEmitter<T = unknown> {
  kind: string;
  schema: z.ZodType<T>;
  /** Highest schema_version this code understands; a newer file is refused (exit 1). */
  version: number;
  order: Record<string, readonly string[]>;
  /** Adjacent migrations: migrations[n] upgrades version n to n+1. */
  migrations?: Record<number, (data: Record<string, unknown>) => Record<string, unknown>>;
}

export interface ReadResult<T> {
  data: T;
  /** sha256 of the raw bytes, for the stale-write check. */
  hash: string;
}

export interface WriteOptions {
  /** Refuse (throw StaleWriteError) if the file's current hash differs. */
  expectHash?: string;
  dryRun?: boolean;
}

export interface WriteResult {
  path: string;
  hash: string;
  changed: boolean;
  /** Text of the file that was (or, in dry run, would be) written. */
  text: string;
}

export interface FileLayer {
  /** Absolute workspace root; every `rel` path is relative to it and must stay inside it. */
  readonly root: string;
  registerEmitter<T>(emitter: TomlEmitter<T>): Disposer;
  readToml<T>(rel: string, kind: string): Promise<ReadResult<T>>;
  /** Parse only (no emitter), for config files such as workspace.toml. */
  readTomlRaw(rel: string): Promise<ReadResult<Record<string, unknown>>>;
  /** Atomic: lock, temp file, rename. Unknown keys from the last read are kept. */
  writeToml<T>(rel: string, kind: string, data: T, opts?: WriteOptions): Promise<WriteResult>;
  appendJsonl(rel: string, row: object, opts?: { dryRun?: boolean }): Promise<void>;
  readJsonl<T>(rel: string, schema: z.ZodType<T>): Promise<T[]>;
  readText(rel: string): Promise<string>;
  /** For markdown and generated files; still atomic. */
  writeText(rel: string, text: string, opts?: WriteOptions): Promise<WriteResult>;
  exists(rel: string): Promise<boolean>;
  /** Simple glob relative to root ("artifacts/*\/ticket.toml"). */
  list(glob: string): Promise<string[]>;
  remove(rel: string, opts?: { dryRun?: boolean }): Promise<void>;
}

export class StaleWriteError extends Error {
  readonly rule = "stale-write";
  readonly file: string;
  constructor(file: string) {
    super(`${file} changed since it was read; re-read and retry`);
    this.file = file;
  }
}

export class SchemaVersionError extends Error {
  readonly rule = "schema-version";
  readonly file: string;
  constructor(file: string, found: number, supported: number) {
    super(`${file} has schema_version ${found}; this hl understands up to ${supported}. Upgrade helmlock.`);
    this.file = file;
  }
}

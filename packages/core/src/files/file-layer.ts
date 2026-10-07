// The file layer (F25, F57): the only way state files are read and written.
// Closed TOML emitters with key order, unknown-key preservation, schema_version checks and migrations,
// atomic writes (lock + temp + rename) with a stale-write hash check, append-only JSONL, simple glob.
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse, TomlDate } from "smol-toml";
import type { z } from "zod";
import {
  type FileLayer,
  type ReadResult,
  SchemaVersionError,
  StaleWriteError,
  type TomlEmitter,
  type WriteOptions,
  type WriteResult,
} from "../contracts/files.ts";
import type { Disposer } from "../contracts/kernel.ts";
import { readIfExists, replaceFile, withLock } from "./atomic.ts";
import { globFiles } from "./glob.ts";
import { type EmitHints, emitToml, isPlainObject, PATH_SEP } from "./toml-writer.ts";

export class PathOutsideWorkspaceError extends Error {
  readonly rule = "path-outside-workspace";
  readonly file: string;
  constructor(file: string) {
    super(`path outside workspace: ${file}`);
    this.file = file;
  }
}

export class UnknownEmitterError extends Error {
  readonly rule = "unknown-emitter";
  constructor(kind: string) {
    super(`no TOML emitter registered for kind "${kind}"`);
  }
}

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const decode = (b: Buffer) => {
  const s = b.toString("utf8");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
};

interface Parsed {
  data: Record<string, unknown>;
  floats: Set<string>;
  dates: Set<string>;
}

/** Parse TOML into plain JS: integers stay numbers, floats with an integer value and dates are noted as hints. */
export function parseToml(text: string): Parsed {
  const floats = new Set<string>();
  const dates = new Set<string>();
  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "number") {
      if (Number.isInteger(v)) floats.add(path);
      return v;
    }
    if (v instanceof TomlDate) {
      dates.add(path);
      return v.toISOString();
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}${PATH_SEP}${i}`));
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, path ? `${path}${PATH_SEP}${k}` : k);
      return out;
    }
    return v;
  };
  const raw = parse(text, { integersAsBigInt: true });
  return { data: walk(raw, "") as Record<string, unknown>, floats, dates };
}

/** Refuse a newer file; upgrade an older one in memory through adjacent migrations. */
export function upgrade(e: TomlEmitter<unknown>, data: Record<string, unknown>, file: string): Record<string, unknown> {
  const found = data.schema_version === undefined ? 1 : Number(data.schema_version);
  if (!Number.isInteger(found) || found < 1) throw new Error(`${file}: schema_version must be a positive integer`);
  if (found > e.version) throw new SchemaVersionError(file, found, e.version);
  let out = data;
  for (let v = found; v < e.version; v++) {
    const step = e.migrations?.[v];
    if (!step) throw new Error(`${file}: no migration from schema_version ${v} to ${v + 1} for ${e.kind}`);
    out = step(out);
  }
  if (found !== e.version || out.schema_version === undefined) out = { ...out, schema_version: e.version };
  return out;
}

/** Re-add unknown keys (root and single tables) that a caller dropped since the last read. */
function keepUnknown(data: Record<string, unknown>, last: Record<string, unknown>, order: TomlEmitter["order"]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  const known = new Set(order[""] ?? []);
  for (const [k, v] of Object.entries(last)) {
    if (!(k in out) && !known.has(k)) out[k] = v;
    else if (isPlainObject(v) && isPlainObject(out[k]) && order[k]) {
      const tk = new Set(order[k]);
      const t = { ...(out[k] as Record<string, unknown>) };
      for (const [kk, vv] of Object.entries(v)) if (!(kk in t) && !tk.has(kk)) t[kk] = vv;
      out[k] = t;
    }
  }
  return out;
}

export function createFileLayer(root: string): FileLayer {
  const base = resolve(root);
  const emitters = new Map<string, TomlEmitter<unknown>>();
  /** What the last readToml of a file saw: hints for floats and dates, and the raw record for unknown keys. */
  const lastRead = new Map<string, Parsed>();

  /** Lexical normalisation only (no symlink resolution): anything that resolves outside root is refused. */
  const abs = (rel: string) => {
    const p = resolve(base, rel);
    const r = relative(base, p);
    if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) throw new PathOutsideWorkspaceError(rel);
    return p;
  };
  const relOf = (p: string) => relative(base, p).split(sep).join("/");
  const emitter = (kind: string) => {
    const e = emitters.get(kind);
    if (!e) throw new UnknownEmitterError(kind);
    return e;
  };

  const put = async (rel: string, text: string, opts?: WriteOptions): Promise<WriteResult> => {
    const p = abs(rel);
    const hash = sha(text);
    const check = (current: Buffer | undefined) => {
      const before = current === undefined ? undefined : sha(current);
      if (opts?.expectHash !== undefined && before !== opts.expectHash) throw new StaleWriteError(relOf(p));
      return before !== hash;
    };
    if (opts?.dryRun) return { path: relOf(p), hash, changed: check(await readIfExists(p)), text };
    await mkdir(dirname(p), { recursive: true });
    const changed = await withLock(p, async () => {
      const ch = check(await readIfExists(p));
      if (ch) await replaceFile(p, text);
      return ch;
    });
    return { path: relOf(p), hash, changed, text };
  };

  const readParsed = async (rel: string) => {
    const buf = await readFile(abs(rel));
    return { parsed: parseToml(decode(buf)), hash: sha(buf) };
  };

  return {
    root: base,
    registerEmitter<T>(e: TomlEmitter<T>): Disposer {
      if (emitters.has(e.kind)) throw new Error(`a TOML emitter for kind "${e.kind}" is already registered`);
      emitters.set(e.kind, e as TomlEmitter<unknown>);
      return () => {
        if (emitters.get(e.kind) === (e as TomlEmitter<unknown>)) emitters.delete(e.kind);
      };
    },

    async readToml<T>(rel: string, kind: string): Promise<ReadResult<T>> {
      const e = emitter(kind);
      const { parsed, hash } = await readParsed(rel);
      const data = upgrade(e, parsed.data, relOf(abs(rel)));
      lastRead.set(relOf(abs(rel)), { ...parsed, data });
      return { data: e.schema.parse(data) as T, hash };
    },

    async readTomlRaw(rel: string) {
      const { parsed, hash } = await readParsed(rel);
      return { data: parsed.data, hash };
    },

    async writeToml<T>(rel: string, kind: string, data: T, opts?: WriteOptions): Promise<WriteResult> {
      const e = emitter(kind);
      if (!isPlainObject(data)) throw new TypeError(`writeToml(${kind}): data must be a plain object`);
      const key = relOf(abs(rel));
      const last = lastRead.get(key);
      let obj: Record<string, unknown> = last ? keepUnknown(data, last.data, e.order) : { ...data };
      if (obj.schema_version === undefined) obj = { schema_version: e.version, ...obj };
      const clean = e.schema.parse(obj) as Record<string, unknown>;
      const hints: EmitHints = last ? { floats: last.floats, dates: last.dates } : {};
      return put(rel, emitToml(clean, e.order, hints), opts);
    },

    async appendJsonl(rel: string, row: object, opts?: { dryRun?: boolean }) {
      const p = abs(rel);
      const line = `${JSON.stringify(row)}\n`;
      if (opts?.dryRun) return;
      await mkdir(dirname(p), { recursive: true });
      // One write call with O_APPEND: concurrent appenders never interleave inside a line.
      await appendFile(p, line, { encoding: "utf8", flag: "a" });
    },

    async readJsonl<T>(rel: string, schema: z.ZodType<T>): Promise<T[]> {
      const buf = await readIfExists(abs(rel));
      if (!buf) return [];
      const lines = decode(buf).split("\n");
      const out: T[] = [];
      lines.forEach((l, i) => {
        const s = l.trim();
        if (!s) return;
        let v: unknown;
        try {
          v = JSON.parse(s);
        } catch {
          // A torn last line (a crash mid-append) is skipped; a bad line in the middle is an error.
          if (i === lines.length - 1) return;
          throw new Error(`${rel}:${i + 1}: not valid JSON`);
        }
        out.push(schema.parse(v));
      });
      return out;
    },

    async readText(rel: string) {
      return decode(await readFile(abs(rel)));
    },

    writeText: (rel: string, text: string, opts?: WriteOptions) => put(rel, text, opts),

    async exists(rel: string) {
      try {
        await stat(abs(rel));
        return true;
      } catch (e) {
        if (e instanceof PathOutsideWorkspaceError) throw e;
        return false;
      }
    },

    async list(glob: string) {
      if (glob.split(/[\\/]+/).includes("..") || isAbsolute(glob)) throw new PathOutsideWorkspaceError(glob);
      return globFiles(base, glob);
    },

    async remove(rel: string, opts?: { dryRun?: boolean }) {
      const p = abs(rel);
      if (p === base) throw new PathOutsideWorkspaceError(rel);
      if (!opts?.dryRun) await rm(p, { recursive: true, force: true });
    },
  };
}

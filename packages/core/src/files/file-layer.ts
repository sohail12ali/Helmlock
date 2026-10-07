// WALKING SKELETON (wave 0). S2 replaces this with the real file layer
// (closed emitters with key order, unknown-key preservation, lock + temp + rename, hash check, migrations).
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, stringify } from "smol-toml";
import type { z } from "zod";
import { type FileLayer, type ReadResult, StaleWriteError, type TomlEmitter, type WriteOptions, type WriteResult } from "../contracts/files.ts";
import type { Disposer } from "../contracts/kernel.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function createFileLayer(root: string): FileLayer {
  const emitters = new Map<string, TomlEmitter<unknown>>();
  const abs = (rel: string) => {
    const p = isAbsolute(rel) ? rel : resolve(root, rel);
    const r = relative(root, p);
    if (r.startsWith("..") || isAbsolute(r)) throw new Error(`path outside workspace: ${rel}`);
    return p;
  };
  const hashOf = async (p: string) => {
    try {
      return sha(await readFile(p, "utf8"));
    } catch {
      return undefined;
    }
  };
  const put = async (rel: string, text: string, opts?: WriteOptions): Promise<WriteResult> => {
    const p = abs(rel);
    const before = await hashOf(p);
    if (opts?.expectHash !== undefined && before !== opts.expectHash) throw new StaleWriteError(rel);
    const hash = sha(text);
    if (!opts?.dryRun && before !== hash) {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, text, "utf8");
    }
    return { path: rel, hash, changed: before !== hash, text };
  };

  return {
    root,
    registerEmitter<T>(e: TomlEmitter<T>): Disposer {
      emitters.set(e.kind, e as TomlEmitter<unknown>);
      return () => {
        emitters.delete(e.kind);
      };
    },
    async readToml<T>(rel: string, kind: string): Promise<ReadResult<T>> {
      const text = await readFile(abs(rel), "utf8");
      const raw = parse(text);
      const e = emitters.get(kind);
      const data = (e ? e.schema.parse(raw) : raw) as T;
      return { data, hash: sha(text) };
    },
    async readTomlRaw(rel: string) {
      const text = await readFile(abs(rel), "utf8");
      return { data: parse(text) as Record<string, unknown>, hash: sha(text) };
    },
    async writeToml<T>(rel: string, kind: string, data: T, opts?: WriteOptions) {
      const e = emitters.get(kind);
      const clean = e ? e.schema.parse(data) : data;
      return put(rel, `${stringify(clean as Record<string, unknown>)}\n`, opts);
    },
    async appendJsonl(rel: string, row: object, opts?: { dryRun?: boolean }) {
      if (opts?.dryRun) return;
      const p = abs(rel);
      await mkdir(dirname(p), { recursive: true });
      await appendFile(p, `${JSON.stringify(row)}\n`, "utf8");
    },
    async readJsonl<T>(rel: string, schema: z.ZodType<T>): Promise<T[]> {
      let text = "";
      try {
        text = await readFile(abs(rel), "utf8");
      } catch {
        return [];
      }
      return text
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => schema.parse(JSON.parse(l)));
    },
    readText: (rel: string) => readFile(abs(rel), "utf8"),
    writeText: (rel: string, text: string, opts?: WriteOptions) => put(rel, text, opts),
    async exists(rel: string) {
      return (
        (await hashOf(abs(rel))) !== undefined ||
        (await readdir(abs(rel)).then(
          () => true,
          () => false,
        ))
      );
    },
    async list(glob: string) {
      const parts = glob.split("/");
      const out: string[] = [];
      const walk = async (dir: string, i: number) => {
        const part = parts[i];
        if (part === undefined) return;
        let names: string[];
        try {
          names = await readdir(join(root, dir));
        } catch {
          return;
        }
        const re = new RegExp(
          `^${part
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".")}$`,
        );
        for (const n of names.filter((n) => re.test(n)).sort()) {
          const rel = dir ? `${dir}/${n}` : n;
          if (i === parts.length - 1) out.push(rel);
          else await walk(rel, i + 1);
        }
      };
      await walk("", 0);
      return out.map((p) => p.split(sep).join("/"));
    },
    async remove(rel: string, opts?: { dryRun?: boolean }) {
      if (!opts?.dryRun) await rm(abs(rel), { recursive: true, force: true });
    },
  };
}

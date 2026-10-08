// Search: plain-text search over the knowledge repo with ripgrep, and a JS scan when rg is missing.
// archive/, _work/, node_modules/ and .git/ are skipped; --archived brings archive/ back.
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Context, PluginModule, SearchHit, SearchService, VerbDef } from "@helmlock/core";
import { z } from "zod";

export const MAX_PER_FILE = 50;
export const DEFAULT_LIMIT = 200;
// notes/ holds generated Obsidian copies of the TOML (F52): searching it would duplicate every hit.
const ALWAYS_SKIP = ["_work", "node_modules", ".git", "notes", "site"];
const MAX_FILE_BYTES = 1_000_000;

const toPosix = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Runs rg; resolves undefined when rg is not installed. */
export function searchRg(root: string, q: string, o: { archived?: boolean; limit?: number } = {}, bin = "rg"): Promise<SearchHit[] | undefined> {
  const limit = o.limit ?? DEFAULT_LIMIT;
  const skip = [...ALWAYS_SKIP, ...(o.archived ? [] : ["archive"])];
  const args = ["--json", "-n", "-i", "-F", "--max-count", String(MAX_PER_FILE), ...skip.flatMap((d) => ["--glob", `!${d}/`]), "--", q, "."];
  return new Promise((resolve, reject) => {
    const hits: SearchHit[] = [];
    let buf = "";
    let err = "";
    let done = false;
    const child = spawn(bin, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const onLine = (line: string) => {
      if (!line.trim() || hits.length >= limit) return;
      const msg = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      if (msg.type !== "match" || !msg.data?.path?.text) return;
      hits.push({ path: toPosix(msg.data.path.text), line: msg.data.line_number ?? 0, text: (msg.data.lines?.text ?? "").replace(/\r?\n$/, "") });
      if (hits.length >= limit) child.kill();
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      done = true;
      if (e.code === "ENOENT") resolve(undefined);
      else reject(e);
    });
    child.on("close", (code) => {
      if (done) return;
      onLine(buf);
      // 0 = matches, 1 = no match; a kill after the limit is fine too.
      if (code === 0 || code === 1 || hits.length >= limit) resolve(hits);
      else reject(Object.assign(new Error(`rg failed (${code}): ${err.trim()}`), { rule: "search-failed" }));
    });
  });
}

/** Fallback when rg is missing: walk the tree, skip hidden and excluded folders and binary files. */
export async function searchJs(root: string, q: string, o: { archived?: boolean; limit?: number } = {}): Promise<SearchHit[]> {
  const limit = o.limit ?? DEFAULT_LIMIT;
  const needle = q.toLowerCase();
  const skip = new Set([...ALWAYS_SKIP, ...(o.archived ? [] : ["archive"])]);
  const hits: SearchHit[] = [];
  const walk = async (dir: string): Promise<void> => {
    let names: import("node:fs").Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of names) {
      if (hits.length >= limit) return;
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (skip.has(d.name) || d.name.startsWith(".")) continue;
        await walk(p);
      } else if (d.isFile() && !d.name.startsWith(".")) {
        if ((await stat(p)).size > MAX_FILE_BYTES) continue;
        const text = await readFile(p, "utf8").catch(() => "");
        if (!text || text.includes("\u0000") || !text.toLowerCase().includes(needle)) continue;
        let n = 0;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && n < MAX_PER_FILE && hits.length < limit; i++) {
          const line = lines[i] ?? "";
          if (line.toLowerCase().includes(needle)) {
            hits.push({ path: toPosix(relative(root, p)), line: i + 1, text: line });
            n++;
          }
        }
      }
    }
  };
  await walk(root);
  return hits;
}

export function createSearch(ctx: Context, bin = "rg"): SearchService {
  const root = ctx.get("files").root;
  return {
    async query(q, opts) {
      if (!q.trim()) return [];
      const hits = (await searchRg(root, q, opts, bin)) ?? (await searchJs(root, q, opts));
      return hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    },
  };
}

const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional();
const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;

const searchVerb = verb({
  id: "search",
  summary: "Search the knowledge repo for text (case-insensitive). Skips archive/ unless --archived.",
  examples: ['hl search "sql rules"', 'hl search "T-014-sa" --json', 'hl search "carrier codes" --archived'],
  args: ["query"],
  input: z.object({ query: z.string().trim().min(1), archived: flag, limit: z.coerce.number().int().positive().optional() }),
  writes: false,
  async run(v, input) {
    const hits = await v.ctx.get("search").query(input.query, { archived: input.archived, limit: input.limit });
    const text = hits.length ? hits.map((h) => `${h.path}:${h.line}: ${h.text.trim().slice(0, 200)}`).join("\n") : `no matches for "${input.query}"`;
    return { ok: true, data: hits, text };
  },
});

const plugin: PluginModule = {
  name: "search",
  requires: ["files", "verbs"],
  async apply(ctx) {
    ctx.provide("search", createSearch(ctx));
    await ctx.effect(() => ctx.get("verbs").register(searchVerb));
  },
};

export default plugin;

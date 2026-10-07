// Small glob for the file layer: `*` and `?` within one segment, `**` for any number of folders.
// Results are root-relative, forward slashes, sorted. Lock and temp files of the file layer are never listed.
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

function segmentRe(seg: string): RegExp {
  const body = seg
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${body}$`);
}

const isInternal = (name: string) => name.endsWith(".lock") || /\.tmp-\d+$/.test(name);
/** `*`, `?` and `**` skip dot entries unless the pattern segment itself starts with a dot. */
const hidden = (name: string, seg: string) => name.startsWith(".") && !seg.startsWith(".");

export async function globFiles(root: string, pattern: string): Promise<string[]> {
  const parts = pattern.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  const found = new Set<string>();
  const cache = new Map<string, Promise<Dirent[]>>();
  const entries = (dir: string) => {
    let p = cache.get(dir);
    if (!p) {
      p = readdir(join(root, dir), { withFileTypes: true }).catch(() => [] as Dirent[]);
      cache.set(dir, p);
    }
    return p;
  };

  const walk = async (dir: string, i: number): Promise<void> => {
    const seg = parts[i];
    if (seg === undefined) return;
    const list = await entries(dir);
    if (seg === "**") {
      const last = i === parts.length - 1;
      if (!last) await walk(dir, i + 1);
      for (const d of list) {
        if (hidden(d.name, "") || isInternal(d.name)) continue;
        const rel = dir ? `${dir}/${d.name}` : d.name;
        if (last) found.add(rel);
        if (d.isDirectory()) await walk(rel, i);
      }
      return;
    }
    const literal = !/[*?]/.test(seg);
    const re = literal ? undefined : segmentRe(seg);
    for (const d of list) {
      if (isInternal(d.name)) continue;
      if (literal ? d.name !== seg : hidden(d.name, seg) || !re!.test(d.name)) continue;
      const rel = dir ? `${dir}/${d.name}` : d.name;
      if (i === parts.length - 1) found.add(rel);
      else if (d.isDirectory()) await walk(rel, i + 1);
    }
  };

  await walk("", 0);
  return [...found].sort();
}

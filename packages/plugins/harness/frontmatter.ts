// Frontmatter reader for SKILL.md and agent files: the YAML subset those files use (scalars, quoted strings,
// folded and literal blocks, plain multi-line scalars, block and flow lists, one level of nested maps).
// Split rules follow lc-wms harness_lint.py _frontmatter.

export type Yaml = string | number | boolean | null | Yaml[] | { [k: string]: Yaml };

export class FrontmatterError extends Error {}

function scalar(raw: string): Yaml {
  const v = raw.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2)
    return v.slice(1, -1).replace(/\\(["\\nt])/g, (_m, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(",").map((s) => scalar(s)) : [];
  }
  return v.replace(/\s+#.*$/, "");
}

const indentOf = (l: string) => l.length - l.trimStart().length;

function parseBlock(lines: string[], start: number, indent: number): [Yaml, number] {
  let i = start;
  while (i < lines.length && !(lines[i] as string).trim()) i++;
  const first = lines[i];
  if (first === undefined) return [null, i];
  if (first.trimStart().startsWith("- ") || first.trim() === "-") {
    const arr: Yaml[] = [];
    while (i < lines.length) {
      const l = lines[i] as string;
      if (!l.trim()) {
        i++;
        continue;
      }
      if (indentOf(l) < indent || !(l.trimStart().startsWith("- ") || l.trim() === "-")) break;
      arr.push(scalar(l.trimStart().slice(1)));
      i++;
    }
    return [arr, i];
  }
  const map: Record<string, Yaml> = {};
  while (i < lines.length) {
    const l = lines[i] as string;
    if (!l.trim() || l.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    const ind = indentOf(l);
    if (ind < indent) break;
    const m = l.trimStart().match(/^([^:#][^:]*?)\s*:(?:\s+(.*))?$/);
    if (!m) throw new FrontmatterError(`cannot parse frontmatter line: ${l.trim()}`);
    const key = (m[1] as string).replace(/^["']|["']$/g, "");
    const rest = (m[2] ?? "").trim();
    i++;
    if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      const body: string[] = [];
      while (i < lines.length && (!(lines[i] as string).trim() || indentOf(lines[i] as string) > ind)) body.push((lines[i++] as string).trim());
      while (body.length && !body.at(-1)) body.pop();
      map[key] = rest.startsWith(">") ? body.join(" ").replace(/\s+/g, " ").trim() : body.join("\n");
    } else if (rest === "") {
      const next = lines.slice(i).find((x) => x.trim());
      if (next !== undefined && (indentOf(next) > ind || next.trimStart().startsWith("- "))) {
        const [v, j] = parseBlock(lines, i, next.trimStart().startsWith("- ") ? Math.min(indentOf(next), ind + 1) : indentOf(next));
        map[key] = v;
        i = j;
      } else map[key] = null;
    } else {
      let v = rest;
      // plain multi-line scalar: deeper-indented continuation lines fold with a space
      while (i < lines.length && (lines[i] as string).trim() && indentOf(lines[i] as string) > ind && !/^[\w-]+\s*:/.test((lines[i] as string).trim())) {
        v += ` ${(lines[i] as string).trim()}`;
        i++;
      }
      map[key] = scalar(v);
    }
  }
  return [map, i];
}

export function parseYaml(text: string): Yaml {
  return parseBlock(text.split("\n"), 0, 0)[0];
}

/** Split a markdown file into (frontmatter mapping, body). Throws FrontmatterError like harness_lint._frontmatter. */
export function frontmatter(raw: string): { data: Record<string, Yaml>; body: string } {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---")) throw new FrontmatterError("no frontmatter block");
  const a = text.indexOf("---\n");
  if (a < 0) throw new FrontmatterError("frontmatter block is not closed");
  const rest = text.slice(a + 4);
  const b = rest.indexOf("\n---");
  if (b < 0) throw new FrontmatterError("frontmatter block is not closed");
  const data = parseYaml(rest.slice(0, b));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new FrontmatterError("frontmatter is not a mapping");
  return { data, body: rest.slice(b + 4) };
}

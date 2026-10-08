// A small, display-only TOML reader for the artifact viewer. It is not a validator: the server and `hl` own
// parsing and writing. It understands what our verbs emit: [table], [[array]], key = value, strings, numbers,
// booleans, dates and single-line arrays. Anything else is shown as raw text.

export interface TomlSection {
  /** "" for top-level keys; "task" for [[task]] (index set); "ticket" for [ticket]. */
  name: string;
  index?: number;
  rows: { key: string; value: string; raw: string }[];
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    const inner = t.slice(1, -1);
    return t.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\") : inner;
  }
  return t;
}

function display(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return "(none)";
    // Split on commas outside quotes.
    const parts: string[] = [];
    let cur = "";
    let q: string | null = null;
    for (const ch of inner) {
      if (q) {
        cur += ch;
        if (ch === q) q = null;
      } else if (ch === '"' || ch === "'") {
        q = ch;
        cur += ch;
      } else if (ch === ",") {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => unquote(p)).join(", ");
  }
  return unquote(t);
}

function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === "\\" && q === '"') i++;
      else if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function depth(s: string): number {
  let d = 0;
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === "\\" && q === '"') i++;
      else if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === "[") d++;
    else if (ch === "]") d--;
  }
  return d;
}

export function parseTomlForDisplay(text: string): TomlSection[] {
  const sections: TomlSection[] = [{ name: "", rows: [] }];
  const arrayCounts = new Map<string, number>();
  let cur = sections[0]!;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = stripComment(lines[i] ?? "").trim();
    if (!line) continue;
    const arr = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line);
    const tbl = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (arr) {
      const name = arr[1]!;
      const n = arrayCounts.get(name) ?? 0;
      arrayCounts.set(name, n + 1);
      cur = { name, index: n, rows: [] };
      sections.push(cur);
      continue;
    }
    if (tbl) {
      cur = { name: tbl[1]!, rows: [] };
      sections.push(cur);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = unquote(line.slice(0, eq).trim());
    let raw = line.slice(eq + 1).trim();
    // Multi-line strings: gather until the closing triple quote.
    if (raw.startsWith('"""')) {
      let body = raw.slice(3);
      while (!body.includes('"""') && i + 1 < lines.length) {
        i++;
        body += `\n${lines[i] ?? ""}`;
      }
      const value = body.slice(0, body.indexOf('"""') < 0 ? undefined : body.indexOf('"""')).replace(/^\n/, "");
      cur.rows.push({ key, value, raw });
      continue;
    }
    // Multi-line arrays: gather until brackets balance.
    if (raw.startsWith("[")) {
      while (depth(raw) > 0 && i + 1 < lines.length) {
        i++;
        line = stripComment(lines[i] ?? "").trim();
        raw += ` ${line}`;
      }
      raw = raw.replace(/,\s*]$/, "]");
    }
    cur.rows.push({ key, value: display(raw), raw });
  }
  return sections.filter((s) => s.rows.length > 0 || s.name);
}

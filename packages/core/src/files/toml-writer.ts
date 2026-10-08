// Closed TOML writer (F25): writes one record shape in a fixed key order. Not a generic dumper:
// the caller (an emitter) owns the order; unknown keys follow known keys in their original order.
// Ported in spirit from control-center console/server/tomlio.py (dumps): top-level values, then tables,
// then arrays of tables; UTF-8, "\n" line ends, no comments.

/** Hints from the last read of the same file, so a write keeps what JS values cannot carry. */
export interface EmitHints {
  /** Paths whose value was a float with an integer value (2.0); written as "2.0", not "2". */
  floats?: ReadonlySet<string>;
  /** Paths whose value was a bare TOML date or datetime; written bare again while still a valid date string. */
  dates?: ReadonlySet<string>;
}

export type KeyOrder = Readonly<Record<string, readonly string[]>>;

/** Separator for hint paths; cannot appear in a TOML key we write unquoted or quoted. */
export const PATH_SEP = "\u0001";

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$|^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v) || v instanceof Date) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const isTableArray = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every(isPlainObject);

const present = (v: unknown) => v !== undefined && v !== null;

export function formatKey(k: string): string {
  return BARE_KEY.test(k) ? k : formatString(k);
}

export function formatString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || c === 0x7f) out += `\\u${c.toString(16).padStart(4, "0").toUpperCase()}`;
    else if (c >= 0xd800 && c <= 0xdfff)
      out += "\\uFFFD"; // lone surrogate: not a Unicode scalar value
    else out += ch;
  }
  return `${out}"`;
}

function formatNumber(n: number, asFloat: boolean): string {
  if (Number.isNaN(n)) return "nan";
  if (n === Number.POSITIVE_INFINITY) return "inf";
  if (n === Number.NEGATIVE_INFINITY) return "-inf";
  if (Number.isInteger(n)) {
    if (!asFloat && Number.isSafeInteger(n)) return String(n);
    const s = String(n);
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  return String(n);
}

function formatValue(v: unknown, path: string, hints: EmitHints): string {
  if (typeof v === "string") return hints.dates?.has(path) && DATE_RE.test(v) ? v : formatString(v);
  if (typeof v === "number") return formatNumber(v, hints.floats?.has(path) ?? false);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) {
    const items = v.filter(present).map((x, i) => formatValue(x, `${path}${PATH_SEP}${i}`, hints));
    return `[${items.join(", ")}]`;
  }
  if (isPlainObject(v)) {
    const parts = Object.entries(v)
      .filter(([, x]) => present(x))
      .map(([k, x]) => `${formatKey(k)} = ${formatValue(x, `${path}${PATH_SEP}${k}`, hints)}`);
    return parts.length ? `{ ${parts.join(", ")} }` : "{}";
  }
  throw new TypeError(`cannot write ${typeof v} as TOML at ${path.split(PATH_SEP).join(".")}`);
}

/** Known keys in emitter order, then unknown keys in their original order. */
function orderedKeys(obj: Record<string, unknown>, known: readonly string[] | undefined): string[] {
  const keys = Object.keys(obj).filter((k) => present(obj[k]));
  if (!known) return keys;
  const have = new Set(keys);
  const first = known.filter((k) => have.has(k));
  const firstSet = new Set(first);
  return [...first, ...keys.filter((k) => !firstSet.has(k))];
}

/**
 * Body of one table: scalar lines, then one level of sub-tables (`[name.sub]`).
 * Anything deeper is written inline so no data is lost.
 */
function emitTableBody(
  obj: Record<string, unknown>,
  name: string,
  dotted: string,
  header: string,
  path: string,
  order: KeyOrder,
  hints: EmitHints,
  out: string[],
): void {
  const keys = orderedKeys(obj, order[name]);
  const subs: string[] = [];
  out.push(header);
  for (const k of keys) {
    const v = obj[k];
    if (isPlainObject(v) && !name.includes(".")) subs.push(k);
    else out.push(`${formatKey(k)} = ${formatValue(v, `${path}${PATH_SEP}${k}`, hints)}`);
  }
  for (const k of subs) {
    out.push("");
    const sub = `${name}.${k}`;
    const subDotted = `${dotted}.${formatKey(k)}`;
    emitTableBody(obj[k] as Record<string, unknown>, sub, subDotted, `[${subDotted}]`, `${path}${PATH_SEP}${k}`, order, hints, out);
  }
}

/**
 * Write `data` as TOML. `order[""]` orders root keys, `order[table]` the keys of `[table]` or `[[table]]`,
 * `order["table.sub"]` a one-level sub-table. A root key named in `order` as a table and holding an empty
 * array is omitted (an empty array of tables), so write(read(x)) stays byte-identical.
 */
export function emitToml(data: Record<string, unknown>, order: KeyOrder, hints: EmitHints = {}): string {
  const out: string[] = [];
  const keys = orderedKeys(data, order[""]);
  const tables: string[] = [];
  for (const k of keys) {
    const v = data[k];
    if (isPlainObject(v) || isTableArray(v)) tables.push(k);
    else if (Array.isArray(v) && v.length === 0 && order[k] !== undefined) {
      // empty array of tables: nothing to write
    } else out.push(`${formatKey(k)} = ${formatValue(v, k, hints)}`);
  }
  for (const k of tables) {
    const v = data[k];
    const rows = Array.isArray(v) ? v : [v as Record<string, unknown>];
    rows.forEach((row, i) => {
      if (out.length) out.push("");
      const header = Array.isArray(v) ? `[[${formatKey(k)}]]` : `[${formatKey(k)}]`;
      emitTableBody(row, k, formatKey(k), header, Array.isArray(v) ? `${k}${PATH_SEP}${i}` : k, order, hints, out);
    });
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

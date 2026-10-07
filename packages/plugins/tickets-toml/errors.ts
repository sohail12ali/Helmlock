// An error the verb registry maps to { rule, message, file, fix } with exit code 1.

export class HlError extends Error {
  readonly rule: string;
  readonly fix: string | undefined;
  readonly file: string | undefined;
  constructor(rule: string, message: string, extra: { fix?: string; file?: string } = {}) {
    super(message);
    this.rule = rule;
    this.fix = extra.fix;
    this.file = extra.file;
  }
}

/** Drop undefined values (deep) so the TOML emitter never sees them. */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = clean(v);
    return out as T;
  }
  return value;
}

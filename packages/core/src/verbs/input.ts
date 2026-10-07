// Input description for the CLI (flags from a verb's input schema) and a tiny flag schema for core verbs,
// so `hl where` and `hl doctor` do not load zod on the startup path.
import type { z } from "zod";

export type FieldKind = "boolean" | "string" | "number" | "array" | "unknown";
export interface FieldInfo {
  key: string;
  kind: FieldKind;
  /** For arrays: the element kind. */
  of?: FieldKind;
  required: boolean;
  choices?: string[];
  description?: string;
}

interface ZodLike {
  _zod?: { def: Record<string, unknown> };
  description?: string;
  /** Set by liteObject. */
  liteFields?: FieldInfo[];
}

function kindOf(s: ZodLike, info: { required: boolean; choices?: string[]; of?: FieldKind }): FieldKind {
  const def = s._zod?.def;
  if (!def) return "unknown";
  switch (def.type) {
    case "optional":
    case "default":
    case "prefault":
    case "nullable":
    case "catch":
    case "readonly":
      if (def.type !== "nullable") info.required = false;
      return kindOf(def.innerType as ZodLike, info);
    case "pipe":
      return kindOf(def.in as ZodLike, info);
    case "boolean":
      return "boolean";
    case "number":
    case "int":
    case "bigint":
      return "number";
    case "string":
    case "literal":
    case "template_literal":
      return "string";
    case "enum":
      info.choices = Object.values(def.entries as Record<string, string>).map(String);
      return "string";
    case "array": {
      const inner = { required: true };
      info.of = kindOf(def.element as ZodLike, inner);
      return "array";
    }
    default:
      return "unknown";
  }
}

/** Fields of an object input schema (zod 4 or liteObject); empty for anything else. */
export function describeInput(schema: unknown): FieldInfo[] {
  const s = schema as ZodLike;
  if (s.liteFields) return s.liteFields;
  const def = s._zod?.def;
  if (def?.type !== "object") return [];
  return Object.entries(def.shape as Record<string, ZodLike>).map(([key, f]) => {
    const info: { required: boolean; choices?: string[]; of?: FieldKind } = { required: true };
    const kind = kindOf(f, info);
    const out: FieldInfo = { key, kind, required: info.required };
    if (info.of) out.of = info.of;
    if (info.choices) out.choices = info.choices;
    if (f.description) out.description = f.description;
    return out;
  });
}

/**
 * A minimal object schema: optional booleans and strings only, unknown keys refused.
 * It implements only safeParse/parse, which is all the registry uses.
 */
export function liteObject<T extends Record<string, "boolean" | "string">>(
  fields: T,
): z.ZodType<{ [K in keyof T]?: T[K] extends "boolean" ? boolean : string }> {
  const liteFields: FieldInfo[] = Object.entries(fields).map(([key, kind]) => ({ key, kind, required: false }));
  const safeParse = (raw: unknown) => {
    const issues: { path: string[]; message: string }[] = [];
    const data: Record<string, unknown> = {};
    if (typeof raw !== "object" || raw === null) issues.push({ path: [], message: "expected an object" });
    else
      for (const [k, v] of Object.entries(raw)) {
        const want = fields[k];
        if (!want) issues.push({ path: [k], message: "unknown option" });
        else if (v !== undefined && typeof v !== want) issues.push({ path: [k], message: `expected ${want}` });
        else if (v !== undefined) data[k] = v;
      }
    return issues.length ? { success: false as const, error: { issues } } : { success: true as const, data };
  };
  const schema = {
    liteFields,
    safeParse,
    parse(raw: unknown) {
      const r = safeParse(raw);
      if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
      return r.data;
    },
  };
  return schema as unknown as z.ZodType<{ [K in keyof T]?: T[K] extends "boolean" ? boolean : string }>;
}

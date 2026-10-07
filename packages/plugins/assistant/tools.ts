// The assistant's tools (F11d L3, B24): read-only verbs and a capped file read run directly; console verbs that write
// become tools that need an approval card first. Schemas come from the verb registry (describeInput), so a verb's
// input is defined once for the CLI, the console forms and the model.
import { CONSOLE_VERBS, describeInput, type FieldInfo, type FileLayer, type ToolSpec, type VerbDef, type VerbResult, type VerbsService } from "@helmlock/core";

/** Read-only verbs offered as tools (when their plugin is mounted). */
export const READ_VERBS = ["search", "context", "ticket show", "ticket list", "todo list", "log show", "skill find"] as const;
export const FILE_READ = "file_read";
export const FILE_READ_MAX = 12_000;
export const TOOL_RESULT_MAX = 6_000;

export interface ToolEntry {
  spec: ToolSpec;
  kind: "read" | "write" | "file";
  /** The verb id for verb tools. */
  verb?: string;
  args?: readonly string[];
}

/** "ticket show" -> "ticket_show" (OpenAI function names allow letters, digits, _ and -). */
export const toolName = (verbId: string) => verbId.replace(/\s+/g, "_");

function fieldSchema(f: FieldInfo): Record<string, unknown> {
  const s: Record<string, unknown> =
    f.kind === "array"
      ? { type: "array", items: f.of && f.of !== "unknown" && f.of !== "array" ? { type: f.of } : {} }
      : f.kind === "unknown"
        ? {}
        : { type: f.kind };
  if (f.choices?.length) s.enum = f.choices;
  if (f.description) s.description = f.description;
  return s;
}

/** JSON schema of a verb's input, from describeInput. */
export function verbParameters(def: VerbDef): Record<string, unknown> {
  const fields = describeInput(def.input);
  const properties: Record<string, unknown> = {};
  for (const f of fields) properties[f.key] = fieldSchema(f);
  const required = fields.filter((f) => f.required).map((f) => f.key);
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

const verbTool = (def: VerbDef, kind: "read" | "write"): ToolEntry => ({
  spec: {
    name: toolName(def.id),
    description: `${def.summary}${kind === "write" ? " Asks the person first." : ""}`,
    parameters: verbParameters(def),
  },
  kind,
  verb: def.id,
  args: def.args ?? [],
});

export function buildTools(verbs: VerbsService, o: { writes: boolean; lowTrust: boolean }): ToolEntry[] {
  const out: ToolEntry[] = [];
  for (const id of READ_VERBS) {
    const def = verbs.get(id);
    if (def && !def.writes) out.push(verbTool(def, "read"));
  }
  out.push({
    kind: "file",
    spec: {
      name: FILE_READ,
      description: o.lowTrust
        ? "Read a text file inside a ticket folder (path relative to the workspace, starting with artifacts/). Large files are cut."
        : "Read a text file in the knowledge workspace (path relative to the workspace root, e.g. projects/app/wiki/index.md). Large files are cut.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    },
  });
  if (o.writes)
    for (const id of CONSOLE_VERBS) {
      const def = verbs.get(id);
      if (def?.writes) out.push(verbTool(def, "write"));
    }
  return out;
}

/** The hl command a write tool call stands for, shown on the approval card. */
export function hlCommand(verbId: string, args: readonly string[], input: Record<string, unknown>): string {
  const q = (v: unknown) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /^[\w@.:/+-]+$/.test(s) ? s : JSON.stringify(s);
  };
  const parts = ["hl", verbId];
  const used = new Set<string>();
  for (const a of args) {
    const key = a.replace(/^\.\.\./, "");
    const v = input[key];
    if (v === undefined) break;
    used.add(key);
    if (Array.isArray(v)) parts.push(...v.map(q));
    else parts.push(q(v));
  }
  for (const [k, v] of Object.entries(input)) {
    if (used.has(k) || v === undefined || v === null) continue;
    const flag = `--${k.replace(/_/g, "-")}`;
    if (v === true) parts.push(flag);
    else if (v === false) parts.push(`${flag}=false`);
    else if (Array.isArray(v)) for (const x of v) parts.push(flag, q(x));
    else parts.push(flag, q(v));
  }
  return parts.join(" ");
}

/** A verb result as tool text: the human text when there is one, else JSON; errors keep rule and fix. */
export function resultText(res: VerbResult): { ok: boolean; text: string } {
  if (res.ok) {
    const text = res.text ?? JSON.stringify(res.data);
    return { ok: true, text: cap(text, TOOL_RESULT_MAX) };
  }
  const e = res.error;
  return { ok: false, text: `error (${e.rule}): ${e.message}${e.fix ? `. Fix: ${e.fix}` : ""}` };
}

export const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[cut: ${s.length - n} more characters]` : s);

const BLOCKED = [/^chats\//, /^usage\//, /^runs\//, /^audio\//, /^author\.local$/, /\.local\.toml$/, /(^|\/)\.env/, /(^|\/)\./];

/** Read-only file access for the model: inside the knowledge repo, no local or hidden files, capped size (B24). */
export async function readFileTool(files: FileLayer, raw: unknown, lowTrust: boolean): Promise<{ ok: boolean; text: string }> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, text: "error: give a path relative to the workspace" };
  const path = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (/^([a-z]:|\/)/i.test(path) || path.split("/").includes(".."))
    return { ok: false, text: "error: the path must be relative to the workspace and stay inside it" };
  if (BLOCKED.some((r) => r.test(path))) return { ok: false, text: `error: ${path} is local or hidden and cannot be read here` };
  if (lowTrust && !path.startsWith("artifacts/")) return { ok: false, text: "error: from this channel only ticket folders (artifacts/...) can be read" };
  try {
    if (!(await files.exists(path))) return { ok: false, text: `error: no file ${path}` };
    const text = await files.readText(path);
    if (text.includes("\u0000")) return { ok: false, text: `error: ${path} is not a text file` };
    return { ok: true, text: cap(text, FILE_READ_MAX) };
  } catch (e) {
    return { ok: false, text: `error: ${(e as Error).message}` };
  }
}

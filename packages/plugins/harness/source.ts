// harness/harness.toml plus harness/rules/*.md: the one source for both hosts' config (Blueprint 21).
// In a knowledge repo the source is two layers: the delivery repo's (system) merged with the knowledge repo's
// (workspace). In the delivery repo itself it is the system layer alone.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";

const strings = z.array(z.string()).default([]);

export const HookEvent = z.enum(["session_start", "post_edit", "stop"]);
export type HookEvent = z.infer<typeof HookEvent>;

export const HarnessToml = z
  .object({
    permissions: z
      .object({ allow: strings, deny: strings, ask: strings, deny_read: strings, deny_shell: strings })
      .loose()
      .default({ allow: [], deny: [], ask: [], deny_read: [], deny_shell: [] }),
    hooks: z
      .array(
        z
          .object({ event: HookEvent, matcher: z.string().optional(), command: z.string().min(1), text: z.string().optional(), timeout: z.number().optional() })
          .loose(),
      )
      .default([]),
    ignore: z.object({ globs: strings }).loose().default({ globs: [] }),
    modes: z
      .object({ default: z.string().default("plan"), ladder: z.array(z.string()).default(["plan", "ask", "auto-review", "force"]) })
      .loose()
      .default({ default: "plan", ladder: ["plan", "ask", "auto-review", "force"] }),
    mcp: z
      .array(z.object({ name: z.string().min(1), command: z.string().min(1), args: strings, env: z.record(z.string(), z.string()).optional() }).loose())
      .default([]),
    lint: z.object({ not_skills: strings }).loose().default({ not_skills: [] }),
  })
  .loose();
export type HarnessToml = z.infer<typeof HarnessToml>;

export interface HarnessSource {
  root: string;
  toml: HarnessToml;
  /** harness/rules/*.md in name order (system layer first when merged). */
  rules: { name: string; text: string }[];
  /** sha256 over the normalised source bytes (toml + every rule file; both layers when merged). */
  hash: string;
  /** The parsed TOML before defaults, to tell a key that is set from one that is only defaulted. */
  raw: Record<string, unknown>;
  /** Merged sources only: the delivery AGENTS.md without its generated block (Cursor gets the rulebook inline). */
  systemAgents?: string;
  /** Merged sources only: the delivery repo the system layer came from. */
  systemRoot?: string;
}

export const SOURCE_FILE = "harness/harness.toml";
const lf = (s: string) => s.replace(/\r\n/g, "\n");

export function hasSource(root: string): boolean {
  return existsSync(join(root, SOURCE_FILE));
}

export function loadSource(root: string): HarnessSource {
  const file = join(root, SOURCE_FILE);
  if (!existsSync(file)) throw Object.assign(new Error(`${SOURCE_FILE} not found under ${root}`), { rule: "harness-missing", file: SOURCE_FILE });
  const raw = lf(readFileSync(file, "utf8"));
  let toml: HarnessToml;
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(raw) as Record<string, unknown>;
    toml = HarnessToml.parse(parsed);
  } catch (e) {
    throw Object.assign(new Error(`${SOURCE_FILE}: ${(e as Error).message}`), { rule: "harness-invalid", file: SOURCE_FILE });
  }
  if (toml.modes.ladder.includes("default"))
    throw Object.assign(new Error("modes.ladder must not contain 'default' (Cursor rejects it)"), { rule: "harness-invalid", file: SOURCE_FILE });
  const rulesDir = join(root, "harness", "rules");
  const rules = existsSync(rulesDir)
    ? readdirSync(rulesDir)
        .filter((n) => n.endsWith(".md") && n.toLowerCase() !== "readme.md")
        .sort()
        .map((name) => ({ name, text: lf(readFileSync(join(rulesDir, name), "utf8")) }))
    : [];
  const h = createHash("sha256").update(raw);
  for (const r of rules) h.update(`\0${r.name}\0${r.text}`);
  return { root, toml, rules, hash: h.digest("hex"), raw: parsed };
}

const BLOCK_RE = /\n*<!-- hl:generated:start -->[\s\S]*?<!-- hl:generated:end -->\n*/;
const union = (...lists: string[][]) => [...new Set(lists.flat())];

/**
 * System layer first, then the workspace layer: permission, ignore and lint lists are unioned (order kept), hooks
 * run system first (identical event+matcher+command once), MCP servers concatenate with the workspace winning on a
 * name, the workspace may set modes.default but the ladder is the system's, rules are system then workspace.
 */
export function mergeSources(sys: HarnessSource, ws: HarnessSource, systemAgentsMd = ""): HarnessSource {
  const a = sys.toml;
  const b = ws.toml;
  const seen = new Set<string>();
  const hooks = [...a.hooks, ...b.hooks].filter((h) => {
    const k = `${h.event}\0${h.matcher ?? ""}\0${h.command}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const mcp = new Map<string, HarnessToml["mcp"][number]>();
  for (const m of [...a.mcp, ...b.mcp]) mcp.set(m.name, m);
  const wsDefault = (ws.raw.modes as { default?: unknown } | undefined)?.default;
  const toml: HarnessToml = {
    ...a,
    permissions: {
      allow: union(a.permissions.allow, b.permissions.allow),
      deny: union(a.permissions.deny, b.permissions.deny),
      ask: union(a.permissions.ask, b.permissions.ask),
      deny_read: union(a.permissions.deny_read, b.permissions.deny_read),
      deny_shell: union(a.permissions.deny_shell, b.permissions.deny_shell),
    },
    hooks,
    ignore: { globs: union(a.ignore.globs, b.ignore.globs) },
    modes: { ladder: a.modes.ladder, default: typeof wsDefault === "string" ? wsDefault : a.modes.default },
    mcp: [...mcp.values()],
    lint: { not_skills: union(a.lint.not_skills, b.lint.not_skills) },
  };
  const systemAgents = lf(systemAgentsMd).replace(BLOCK_RE, "\n\n").replace(/\n*$/, "\n");
  const hash = createHash("sha256").update(`${sys.hash}\0${ws.hash}\0${systemAgents}`).digest("hex");
  return { root: ws.root, toml, rules: [...sys.rules, ...ws.rules], hash, raw: ws.raw, systemAgents, systemRoot: sys.root };
}

/** True when the sync root is the delivery repo itself: system layer only, and only AGENTS.md is generated. */
export function isDeliveryRoot(root: string, deliveryRoot: string): boolean {
  const norm = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(root) === norm(deliveryRoot);
}

/** The source to generate from: the delivery repo alone, or its system layer merged under the workspace layer. */
export function loadLayers(root: string, deliveryRoot: string): HarnessSource {
  const ws = loadSource(root);
  if (isDeliveryRoot(root, deliveryRoot) || !hasSource(deliveryRoot)) return ws;
  const agents = join(deliveryRoot, "AGENTS.md");
  return mergeSources(loadSource(deliveryRoot), ws, existsSync(agents) ? readFileSync(agents, "utf8") : "");
}

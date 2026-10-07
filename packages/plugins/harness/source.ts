// harness/harness.toml plus harness/rules/*.md: the one source for both hosts' config (Blueprint 21).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  })
  .loose();
export type HarnessToml = z.infer<typeof HarnessToml>;

export interface HarnessSource {
  root: string;
  toml: HarnessToml;
  /** harness/rules/*.md in name order. */
  rules: { name: string; text: string }[];
  /** sha256 over the normalised source bytes (toml + every rule file). */
  hash: string;
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
  try {
    toml = HarnessToml.parse(parse(raw));
  } catch (e) {
    throw Object.assign(new Error(`${SOURCE_FILE}: ${(e as Error).message}`), { rule: "harness-invalid", file: SOURCE_FILE });
  }
  if (toml.modes.ladder.includes("default"))
    throw Object.assign(new Error("modes.ladder must not contain 'default' (Cursor rejects it)"), { rule: "harness-invalid", file: SOURCE_FILE });
  const rulesDir = join(root, "harness", "rules");
  const rules = existsSync(rulesDir)
    ? readdirSync(rulesDir)
        .filter((n) => n.endsWith(".md"))
        .sort()
        .map((name) => ({ name, text: lf(readFileSync(join(rulesDir, name), "utf8")) }))
    : [];
  const h = createHash("sha256").update(raw);
  for (const r of rules) h.update(`\0${r.name}\0${r.text}`);
  return { root, toml, rules, hash: h.digest("hex") };
}

// Skills index (F88, F89, Blueprints 13 and 31): scans SKILL.md folders in every layer and ranks by a query.
// system = the delivery repo's .claude/skills; workspace = the knowledge repo's harness/skills plus hand-made
// .claude/skills (generated copies are skipped); personal = people/<author>/skills; local = .hl-local/skills;
// project = product folders from the .code-workspace plus overlays at projects/<id>/.claude/skills.
// Same-named skills are all returned (F89); each says which layer wins (local > personal > workspace > system).
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Context, LayerName, PluginModule, SkillEntry, SkillsService, VerbDef } from "@helmlock/core";
import { z } from "zod";
import { isGeneratedSkill, LOCAL_DIR, resolveItems } from "../harness/layers.ts";

export const LAYER_ORDER: readonly LayerName[] = ["system", "workspace", "personal", "local", "project"];

/** A listed skill with its standing among same-named skills (system to local; project skills stand alone). */
export type RankedSkill = SkillEntry & {
  /** True when this copy is the one the host loads in the knowledge repo (or it has no rival). */
  winner?: boolean;
  /** Layers this copy hides. */
  overrides?: LayerName[];
  /** The layer that hides this copy. */
  overridden_by?: LayerName;
};

/** Frontmatter subset: `key: value`, quoted values, and `>` / `|` block scalars. No dependency. */
export function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") break;
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] as string;
    let value = (m[2] ?? "").trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").trim() !== "---") block.push((lines[++i] ?? "").trim());
      value = value.startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n").trim();
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      if (m[2]?.trim().startsWith('"')) value = value.replace(/\\"/g, '"');
    }
    out[key] = value;
  }
  return out;
}

interface Root {
  layer: LayerName;
  /** Folder name (workspace folder or project id) shown with the skill. */
  folder: string;
  dir: string;
  /** The skills folder under dir; default .claude/skills. */
  skills?: string;
}

/** The skill roots, from the resolved workspace and workspace.toml layers (paths come from the .code-workspace only). */
export function skillRoots(ctx: Context): Root[] {
  const w = ctx.get("workspace");
  const byName = new Map<string, LayerName>();
  if (ctx.has("config")) for (const l of ctx.get("config").workspace.layers) byName.set(l.folder, l.layer);
  const wsFolder = w.folders.find((f) => resolve(f.path) === resolve(w.root))?.name ?? "workspace";
  const roots: Root[] = [
    { layer: "system", folder: "system", dir: w.deliveryRoot },
    { layer: "workspace", folder: wsFolder, dir: w.root, skills: join(w.root, "harness", "skills") },
    { layer: "workspace", folder: wsFolder, dir: w.root },
  ];
  if (w.author) roots.push({ layer: "personal", folder: w.author, dir: w.root, skills: join(w.root, "people", w.author, "skills") });
  roots.push({ layer: "local", folder: "local", dir: w.root, skills: join(w.root, LOCAL_DIR, "skills") });
  for (const f of w.folders) {
    const layer = byName.get(f.name) ?? (f.layer === "product" ? "project" : f.layer);
    if (layer === "project") roots.push({ layer, folder: f.name, dir: f.path });
  }
  return roots;
}

async function scanDir(skillsDir: string, layer: LayerName, folder: string, root: string): Promise<SkillEntry[]> {
  let names: string[];
  try {
    names = (await readdir(skillsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out: SkillEntry[] = [];
  for (const n of names.sort()) {
    const file = join(skillsDir, n, "SKILL.md");
    if (!existsSync(file) || isGeneratedSkill(join(skillsDir, n))) continue;
    const fm = parseFrontmatter(await readFile(file, "utf8"));
    const rel = relative(root, file).replace(/\\/g, "/");
    out.push({ name: fm.name || n, description: fm.description ?? "", layer, folder, path: rel });
  }
  return out;
}

export function createSkills(ctx: Context): SkillsService {
  const list = async (): Promise<RankedSkill[]> => {
    const w = ctx.get("workspace");
    const root = w.root;
    const seen = new Set<string>();
    const out: RankedSkill[] = [];
    const add = async (dir: string, layer: LayerName, folder: string, skills = join(dir, ".claude", "skills")) => {
      const key = resolve(skills).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(...(await scanDir(skills, layer, folder, root)));
    };
    for (const r of skillRoots(ctx)) await add(r.dir, r.layer, r.folder, r.skills);
    // Project overlays in the knowledge repo (F87).
    const projects = join(root, "projects");
    const ids = await readdir(projects, { withFileTypes: true }).then(
      (ds) => ds.filter((d) => d.isDirectory()).map((d) => d.name),
      () => [] as string[],
    );
    for (const id of ids.sort()) await add(join(projects, id), "project", id);
    return rank(out, root, w.deliveryRoot, w.author);
  };

  return {
    list,
    async find(query): Promise<(RankedSkill & { score: number })[]> {
      const q = query.toLowerCase().trim();
      const qWords = new Set(q.match(/[a-z0-9]+/g) ?? []);
      if (!qWords.size) return [];
      const all = await list();
      const scored = all.map((s) => {
        const name = s.name.toLowerCase();
        const nameWords = new Set(name.split(/[^a-z0-9]+/).filter(Boolean));
        const descWords = new Set(s.description.toLowerCase().match(/[a-z0-9]+/g) ?? []);
        let nameScore = 0;
        if (name === q) nameScore = 1;
        else if ([...qWords].some((w) => nameWords.has(w) || w === name)) nameScore = 0.7;
        else if ([...qWords].some((w) => w.length > 2 && name.includes(w))) nameScore = 0.4;
        const overlap = [...qWords].filter((w) => descWords.has(w) || [...descWords].some((d) => w.length > 3 && d.startsWith(w))).length / qWords.size;
        const score = Math.round((0.6 * nameScore + 0.4 * overlap) * 100) / 100;
        return { ...s, score };
      });
      // Same name in several layers: if one matches, show them all (F89), never pick silently.
      const hitNames = new Set(scored.filter((s) => s.score > 0).map((s) => s.name));
      return scored
        .filter((s) => hitNames.has(s.name))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
    },
  };
}

/** Mark the winner among same-named skills of the system, workspace, personal and local layers (harness/layers.ts). */
function rank(items: RankedSkill[], root: string, deliveryRoot: string, author: string | undefined): RankedSkill[] {
  let resolved: ReturnType<typeof resolveItems>;
  try {
    resolved = resolveItems(root, deliveryRoot, author).filter((r) => r.kind === "skill");
  } catch {
    return items;
  }
  const key = (p: string) => p.replace(/\/SKILL\.md$/, "").toLowerCase();
  const byPath = new Map<string, { winner: boolean; overrides?: LayerName[]; overridden_by?: LayerName }>();
  for (const r of resolved) {
    byPath.set(key(r.winner.path), { winner: true, ...(r.hidden.length ? { overrides: r.hidden.map((h) => h.layer) } : {}) });
    for (const h of r.hidden) byPath.set(key(h.path), { winner: false, overridden_by: r.winner.layer });
  }
  return items.map((s) => (s.layer === "project" ? s : { ...s, ...(byPath.get(key(s.path)) ?? {}) }));
}

const verb = <I extends z.ZodType>(d: VerbDef<I>): VerbDef => d as unknown as VerbDef;
const standing = (s: RankedSkill) =>
  s.overrides?.length ? `  (overrides ${s.overrides.join(", ")})` : s.overridden_by ? `  (hidden by ${s.overridden_by})` : "";
const row = (s: RankedSkill & { score?: number }) =>
  `${s.score === undefined ? "" : `${s.score.toFixed(2)} `}${`${s.layer}${s.layer === "project" ? `:${s.folder}` : ""}`.padEnd(18)} ${s.name.padEnd(20)} ${s.description}${standing(s)}`;

function verbs(): VerbDef[] {
  return [
    verb({
      id: "skill list",
      summary: "List skills in the system, workspace, personal, local and project layers. Same-named skills are all shown, with the layer that wins.",
      examples: ["hl skill list", "hl skill list --json", "hl skill list --same-name"],
      input: z.object({ same_name: z.preprocess((v) => v === true || v === "true", z.boolean()).optional() }),
      writes: false,
      async run(v, input) {
        let items = await v.ctx.get("skills").list();
        if (input.same_name) {
          const count = new Map<string, number>();
          for (const s of items) count.set(s.name, (count.get(s.name) ?? 0) + 1);
          items = items.filter((s) => (count.get(s.name) ?? 0) > 1);
        }
        return { ok: true, data: items, text: items.length ? items.map(row).join("\n") : "no skills found" };
      },
    }),
    verb({
      id: "skill find",
      summary: "Find skills by name and description across all layers, ranked.",
      examples: ['hl skill find "run the wms tests"', "hl skill find build --json"],
      args: ["query"],
      input: z.object({ query: z.string().trim().min(1), limit: z.coerce.number().int().positive().optional() }),
      writes: false,
      async run(v, input) {
        const hits = await v.ctx.get("skills").find(input.query);
        const items = input.limit ? hits.slice(0, input.limit) : hits;
        return { ok: true, data: items, text: items.length ? items.map(row).join("\n") : `no skill matches "${input.query}"` };
      },
    }),
  ];
}

const plugin: PluginModule = {
  name: "skills",
  requires: ["files", "verbs", "workspace"],
  async apply(ctx) {
    ctx.provide("skills", createSkills(ctx));
    for (const def of verbs()) await ctx.effect(() => ctx.get("verbs").register(def));
  },
};

export default plugin;

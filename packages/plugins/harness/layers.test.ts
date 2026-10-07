import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ResolvedItem, SkillEntry } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { TEMPLATE_DIR } from "../scaffold/scaffold.ts";
import { agentNotice, overridesView, SKILL_MARKER } from "./layers.ts";
import { lintHarness } from "./lint.ts";
import { syncHarness } from "./sync.ts";

const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const agent = (dir: string, name: string, body: string) =>
  put(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: The ${name} agent (${body}).\n---\n\n${body}\n`);
const skill = (dir: string, name: string, body: string) =>
  put(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${body} skill for the layer tests. Use when testing layer precedence.\n---\n\n# ${name}\n\n## Steps\n\n${body}\n\n## Rules\n\n- none\n\n## Output\n\n- none\n`,
  );

/** <base>/delivery (system layer) and <base>/kc (knowledge repo with a minimal harness source). */
function layered() {
  const base = mkdtempSync(join(tmpdir(), "hl-layers-"));
  const delivery = join(base, "delivery");
  const root = join(base, "kc");
  agent(join(delivery, ".claude/agents"), "builder", "system builder");
  agent(join(delivery, ".claude/agents"), "analyst", "system analyst");
  skill(join(delivery, ".claude/skills"), "spec", "system spec");
  skill(join(delivery, ".claude/skills"), "plan", "system plan");
  skill(join(delivery, ".claude/skills"), "verify", "system verify");
  put(join(root, "harness/harness.toml"), "");
  put(join(root, "harness/agents/README.md"), "# Workspace agents\n");
  agent(join(root, "harness/agents"), "builder", "workspace builder");
  agent(join(root, "people/sa/agents"), "builder", "personal builder");
  agent(join(root, ".hl-local/agents"), "builder", "local builder");
  agent(join(root, "people/sa/agents"), "scout", "personal scout");
  agent(join(root, "people/jo/agents"), "builder", "someone else's builder");
  skill(join(root, "harness/skills"), "spec", "workspace spec");
  skill(join(root, "people/sa/skills"), "spec", "personal spec");
  skill(join(root, ".hl-local/skills"), "plan", "local plan");
  skill(join(root, "harness/skills"), "glossary", "workspace glossary");
  put(join(root, "harness/skills/glossary/reference/terms.md"), "terms\n");
  return { base, delivery, root, done: () => rmSync(base, { recursive: true, force: true }) };
}

const row = (v: ResolvedItem[], kind: string, name: string) => v.find((i) => i.kind === kind && i.name === name);

test("layer precedence: local > personal > workspace > system, for agents and skills; only my personal layer counts", () => {
  const t = layered();
  try {
    const v = overridesView(t.root, t.delivery, "sa");
    const builder = row(v, "agent", "builder");
    assert.equal(builder?.layer, "local");
    assert.equal(builder?.path, ".hl-local/agents/builder.md");
    assert.deepEqual(
      builder?.overrides.map((o) => `${o.layer} ${o.path}`),
      ["personal people/sa/agents/builder.md", "workspace harness/agents/builder.md", "system ../delivery/.claude/agents/builder.md"],
    );
    assert.equal(row(v, "agent", "analyst")?.layer, "system");
    assert.equal(row(v, "agent", "scout")?.layer, "personal");
    assert.equal(row(v, "agent", "README"), undefined, "README.md is not an agent");
    assert.deepEqual(
      row(v, "skill", "spec")?.overrides.map((o) => o.layer),
      ["workspace", "system"],
    );
    assert.equal(row(v, "skill", "spec")?.layer, "personal");
    assert.equal(row(v, "skill", "plan")?.layer, "local");
    assert.equal(row(v, "skill", "glossary")?.layer, "workspace");
    assert.equal(row(v, "skill", "verify")?.layer, "system");
    // No author: the personal layer is skipped; another person's variants never apply.
    const anon = overridesView(t.root, t.delivery, undefined);
    assert.deepEqual(
      row(anon, "agent", "builder")?.overrides.map((o) => o.layer),
      ["workspace", "system"],
    );
    assert.equal(row(anon, "skill", "spec")?.layer, "workspace");
    assert.equal(row(anon, "agent", "scout"), undefined);
  } finally {
    t.done();
  }
});

test("sync writes the winners stamped GENERATED, copies only non-system skills, and replaces generated files only", () => {
  const t = layered();
  try {
    // Hand-made files in the output folders, and a copy left by the old system-agent step.
    agent(join(t.root, ".claude/agents"), "mine", "hand-made");
    agent(join(t.root, ".claude/agents"), "analyst", "hand-made analyst");
    skill(join(t.root, ".claude/skills"), "handmade", "hand-made");
    put(
      join(t.root, ".claude/agents/old.md"),
      "---\nname: old\n---\n<!-- GENERATED by hl harness sync 0123abcd: a copy of the system agent; edit it in the delivery repo -->\nold\n",
    );

    assert.ok(syncHarness(t.root, t.delivery, { check: true, author: "sa" }).some((r) => r.status === "missing"));
    const res = syncHarness(t.root, t.delivery, { author: "sa" });
    const status = (p: string) => res.find((r) => r.path === p);
    assert.equal(status(".claude/agents/builder.md")?.status, "written");
    assert.equal(status(".claude/skills/spec/")?.status, "written");
    assert.deepEqual(status(".claude/agents/old.md"), { path: ".claude/agents/old.md", status: "written", removed: true });
    assert.ok(!existsSync(join(t.root, ".claude/agents/old.md")));

    const builder = readFileSync(join(t.root, ".claude/agents/builder.md"), "utf8");
    assert.match(
      builder,
      /^---\nname: builder\n[\s\S]*?\n---\n<!-- GENERATED by hl harness sync [0-9a-f]{12}: a copy of the local agent \.hl-local\/agents\/builder\.md/,
    );
    assert.match(builder, /local builder/);
    assert.match(readFileSync(join(t.root, ".claude/agents/scout.md"), "utf8"), /personal scout/);
    // hand-made files are never touched, and a hand-made agent outranks every layer
    assert.match(readFileSync(join(t.root, ".claude/agents/analyst.md"), "utf8"), /hand-made analyst/);
    assert.match(readFileSync(join(t.root, ".claude/agents/mine.md"), "utf8"), /hand-made/);
    assert.equal(row(overridesView(t.root, t.delivery, "sa"), "agent", "analyst")?.path, ".claude/agents/analyst.md");
    assert.ok(existsSync(join(t.root, ".claude/skills/handmade/SKILL.md")) && !existsSync(join(t.root, ".claude/skills/handmade", SKILL_MARKER)));

    // skills: the winner above system is copied whole with a marker; system-only skills are not copied
    assert.match(readFileSync(join(t.root, ".claude/skills/spec/SKILL.md"), "utf8"), /personal spec/);
    assert.match(readFileSync(join(t.root, ".claude/skills/spec", SKILL_MARKER), "utf8"), /personal skill people\/sa\/skills\/spec/);
    assert.match(readFileSync(join(t.root, ".claude/skills/plan/SKILL.md"), "utf8"), /local plan/);
    assert.ok(existsSync(join(t.root, ".claude/skills/glossary/reference/terms.md")));
    assert.ok(!existsSync(join(t.root, ".claude/skills/verify")));

    // in sync: nothing to do, and the check is clean
    assert.ok(syncHarness(t.root, t.delivery, { check: true, author: "sa" }).every((r) => r.status === "unchanged"));

    // a source changes or goes: check says stale, sync replaces or removes the generated copy only
    rmSync(join(t.root, ".hl-local/agents/builder.md"));
    rmSync(join(t.root, "harness/skills/glossary"), { recursive: true });
    put(join(t.root, "harness/skills/spec/extra.md"), "x\n");
    put(join(t.root, ".claude/skills/spec/stray.md"), "left in a generated folder\n");
    const check = syncHarness(t.root, t.delivery, { check: true, author: "sa" });
    assert.equal(check.find((r) => r.path === ".claude/agents/builder.md")?.status, "stale");
    assert.deepEqual(
      check.find((r) => r.path === ".claude/skills/glossary/"),
      { path: ".claude/skills/glossary/", status: "stale", removed: true },
    );
    assert.equal(check.find((r) => r.path === ".claude/skills/spec/")?.status, "stale");
    syncHarness(t.root, t.delivery, { author: "sa" });
    assert.match(readFileSync(join(t.root, ".claude/agents/builder.md"), "utf8"), /personal builder/);
    assert.ok(!existsSync(join(t.root, ".claude/skills/glossary")));
    assert.ok(!existsSync(join(t.root, ".claude/skills/spec/stray.md")));
    assert.ok(!existsSync(join(t.root, ".claude/skills/spec/extra.md")), "the personal spec wins; the workspace extra file is not copied");
    assert.ok(existsSync(join(t.root, ".claude/skills/handmade/SKILL.md")));

    // the lock is committed, so per-machine agents stay out of it
    assert.ok(!readFileSync(join(t.root, ".claude/harness.lock"), "utf8").includes(".claude/agents/"));
  } finally {
    t.done();
  }
});

test("a run with --agent gets a notice when .claude/agents is behind its layer winner", () => {
  const t = layered();
  try {
    assert.match(agentNotice(t.root, t.delivery, "sa", "builder") ?? "", /not in \.claude\/agents yet; run `hl harness sync`/);
    syncHarness(t.root, t.delivery, { author: "sa" });
    assert.equal(agentNotice(t.root, t.delivery, "sa", "builder"), undefined);
    agent(join(t.root, ".hl-local/agents"), "builder", "local builder, edited");
    assert.match(agentNotice(t.root, t.delivery, "sa", "builder") ?? "", /out of date with local: \.hl-local\/agents\/builder\.md/);
    assert.match(agentNotice(t.root, t.delivery, "sa", "ghost") ?? "", /in no layer/);
    assert.equal(agentNotice(t.delivery, t.delivery, "sa", "builder"), undefined, "the delivery repo has no copies");
  } finally {
    t.done();
  }
});

test("lint covers the layer sources and skips generated skills and agents", () => {
  const t = layered();
  try {
    syncHarness(t.root, t.delivery, { author: "sa" });
    // a broken generated copy is not linted; a broken personal source is
    put(join(t.root, ".claude/skills/spec/SKILL.md"), "no frontmatter\n");
    put(join(t.root, "people/sa/skills/broken/SKILL.md"), "no frontmatter\n");
    put(join(t.root, ".hl-local/agents/bad.md"), "---\nname: bad\n---\nno sections\n");
    put(
      join(t.root, "harness/agents/refs.md"),
      "---\nname: refs\ndescription: x\n---\nUse `/spec` and `/nowhere`.\n**Scope:** x\n**Never:** x\n## Steps\n## Rules\n## Hand-off\n",
    );
    const f = lintHarness(t.root, {}, { deliveryRoot: t.delivery });
    const errors = f.filter((x) => x.level === "error").map((x) => `${x.rule} ${x.file}`);
    assert.ok(errors.includes("lint:frontmatter people/sa/skills/broken/SKILL.md"), errors.join("\n"));
    assert.ok(errors.includes("lint:agent-format .hl-local/agents/bad.md"), errors.join("\n"));
    assert.ok(!errors.some((e) => e.includes(".claude/skills/spec") || e.includes(".claude/agents/")), errors.join("\n"));
    const cmds = f.filter((x) => x.rule === "lint:command").map((x) => x.message);
    assert.deepEqual(cmds, ["command resolves to no skill or alias: /nowhere"], "system skills are known commands in a knowledge repo");
  } finally {
    t.done();
  }
});

test("knowledge-repo template: generated agent and skill folders and .hl-local are gitignored; harness READMEs scaffolded", () => {
  const gi = readFileSync(join(TEMPLATE_DIR, ".gitignore.tmpl"), "utf8").split(/\r?\n/);
  for (const line of [".claude/agents/", ".claude/skills/", ".hl-local/"]) assert.ok(gi.includes(line), `${line} in .gitignore.tmpl`);
  assert.ok(!gi.includes(".claude/"), "the rest of .claude (settings.json, harness.lock) stays committed");
  for (const d of ["agents", "skills"]) assert.match(readFileSync(join(TEMPLATE_DIR, "harness", d, "README.md"), "utf8"), /people\/<your id>/);
});

test("hl overrides and hl skill list show the winning layer through the verb registry", async () => {
  const t = layered();
  const ws = await createTestWorkspace({ catalog, env: { HL_DELIVERY: t.delivery } });
  try {
    const author = ws.runtime.ctx.get("workspace").author as string;
    skill(join(ws.root, "harness/skills"), "spec", "workspace spec");
    skill(join(ws.root, "people", author, "skills"), "spec", "personal spec");
    agent(join(ws.root, ".hl-local/agents"), "builder", "local builder");
    put(join(ws.root, "harness/harness.toml"), "");
    const res = await ws.run("overrides", { overridden: true });
    assert.ok(res.ok, JSON.stringify(res));
    const items = res.data as ResolvedItem[];
    assert.deepEqual(
      items.map((i) => `${i.kind} ${i.name} ${i.layer} < ${i.overrides.map((o) => o.layer).join(",")}`),
      ["agent builder local < system", "skill spec personal < workspace,system"],
    );
    assert.match(res.text ?? "", /skill\s+spec\s+personal\s+people\/[^/]+\/skills\/spec\s+\(overrides workspace, system\)/);

    // sync writes the personal spec into .claude/skills; the index skips the generated copy and marks the winner
    assert.ok((await ws.run("harness sync", {})).ok);
    assert.ok(existsSync(join(ws.root, ".claude/skills/spec", SKILL_MARKER)));
    const list = await ws.run("skill list", { same_name: true });
    assert.ok(list.ok);
    const specs = (list.data as (SkillEntry & { winner?: boolean; overrides?: string[]; overridden_by?: string })[]).filter((s) => s.name === "spec");
    assert.deepEqual(
      specs.map((s) => `${s.layer} ${s.winner} ${s.overrides?.join(",") ?? s.overridden_by}`),
      ["system false personal", "workspace false personal", `personal true workspace,system`],
    );
    assert.match(list.text ?? "", /personal\s+spec .*\(overrides workspace, system\)/);
    assert.match(list.text ?? "", /system\s+spec .*\(hidden by personal\)/);
  } finally {
    await ws.cleanup();
    t.done();
  }
});

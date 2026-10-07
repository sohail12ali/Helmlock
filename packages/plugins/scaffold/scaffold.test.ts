import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { createRuntime, ProjectToml, type Runtime } from "@helmlock/core";
import { DELIVERY_ROOT } from "@helmlock/core/testing";
import { parse } from "smol-toml";
import { catalog } from "../registry.ts";
import { relPath, renderTemplate } from "./scaffold.ts";

const temps: string[] = [];
after(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

function tempDir(base = tmpdir()): string {
  mkdirSync(base, { recursive: true });
  const d = mkdtempSync(join(base, "hl-s6-"));
  temps.push(d);
  return d;
}

const FLAGS = { name: "Acme", author: "Sam Abbott", initials: "sa", email: "sam@example.com" };

async function withRuntime<T>(cwd: string, fn: (rt: Runtime) => Promise<T>): Promise<T> {
  const rt = await createRuntime({ cwd, env: { HL_DELIVERY: DELIVERY_ROOT }, catalog });
  try {
    return await fn(rt);
  } finally {
    await rt.dispose();
  }
}

/** Runs `hl init` from an empty scratch folder and returns the new repo path. */
async function init(base?: string, extra: Record<string, unknown> = {}): Promise<string> {
  const parent = tempDir(base);
  const target = join(parent, "acme");
  const res = await withRuntime(parent, (rt) => rt.run("init", { dir: target, ...FLAGS, ...extra }));
  assert.ok(res.ok, JSON.stringify(res));
  return target;
}

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === ".git") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...allFiles(p));
    else out.push(p);
  }
  return out;
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

test("init with all flags scaffolds a valid, committed knowledge center that `where` resolves", async () => {
  const root = await init();
  for (const p of ["workspace.toml", "people.toml", "CLAUDE.md", "template.toml", "Acme.code-workspace", "Acme.code-workspace.template", "hl", "hl.cmd"]) {
    assert.ok(existsSync(join(root, p)), p);
  }
  for (const d of ["artifacts", "archive", "logs", "activity", "projects", "shared/wiki/standards", "shared/digests", "todos", ".obsidian"]) {
    assert.ok(statSync(join(root, d)).isDirectory(), d);
  }
  for (const f of allFiles(root)) assert.ok(!readFileSync(f, "utf8").includes("{{"), `leftover in ${f}`);
  assert.ok(readFileSync(join(root, "CLAUDE.md"), "utf8").startsWith("@"), "CLAUDE.md imports the system rulebook");
  assert.match(readFileSync(join(root, "hl.cmd"), "utf8"), /\r\n/);

  const log = git(root, "log", "--oneline");
  assert.equal(log.stdout.trim().split("\n").length, 1);
  assert.match(log.stdout, /Scaffold Acme knowledge center/);
  assert.equal(readFileSync(join(root, "author.local"), "utf8").trim(), "sam-abbott");
  assert.equal(git(root, "check-ignore", "-q", "author.local").status, 0, "author.local is ignored");
  assert.equal(git(root, "check-ignore", "-q", "Acme.code-workspace").status, 0, "personal workspace file is ignored");
  assert.equal(git(root, "status", "--porcelain").stdout.trim(), "", "nothing left uncommitted");
  assert.match(git(root, "ls-files", "-s", "hl").stdout, /^100755/, "hl launcher is executable");

  const people = parse(readFileSync(join(root, "people.toml"), "utf8")) as { person: { id: string; email?: string }[] };
  assert.equal(people.person[0]?.id, "sam-abbott");
  assert.equal(people.person[0]?.email, "sam@example.com");

  await withRuntime(root, async (rt) => {
    const res = await rt.run("where", {});
    assert.ok(res.ok);
    const data = res.data as { name: string; author: string; folders: { name: string; path: string; layer: string }[] };
    assert.equal(data.name, "Acme");
    assert.equal(data.author, "sam-abbott");
    const sys = data.folders.find((f) => f.name === "system");
    assert.ok(sys, "system folder");
    assert.ok(same(sys.path, DELIVERY_ROOT), `${sys.path} vs ${DELIVERY_ROOT}`);
    assert.equal(sys.layer, "system");
  });
});

test("init refuses an existing non-empty folder", async () => {
  const parent = tempDir();
  writeFileSync(join(parent, "keep.txt"), "x");
  const res = await withRuntime(parent, (rt) => rt.run("init", { dir: parent, ...FLAGS }));
  assert.ok(!res.ok);
  assert.equal(res.error.rule, "target-exists");
  assert.deepEqual(readdirSync(parent), ["keep.txt"]);
});

test("init dry run lists files and writes nothing", async () => {
  const parent = tempDir();
  const target = join(parent, "acme");
  const res = await withRuntime(parent, (rt) => rt.run("init", { dir: target, ...FLAGS }, { dryRun: true }));
  assert.ok(res.ok);
  const files = (res.data as { files: string[] }).files;
  assert.ok(files.includes("workspace.toml") && files.includes("Acme.code-workspace") && files.includes("author.local"));
  assert.ok(!existsSync(target));
});

test("init without required flags and no TTY fails listing them", async () => {
  const parent = tempDir();
  const res = await withRuntime(parent, (rt) => rt.run("init", { dir: join(parent, "x"), name: "Acme" }));
  assert.ok(!res.ok);
  assert.equal(res.error.rule, "missing-args");
  assert.match(res.error.message, /--author/);
  assert.match(res.error.message, /--initials/);
});

test("init validates name and initials", async () => {
  const parent = tempDir();
  const bad = await withRuntime(parent, (rt) => rt.run("init", { dir: join(parent, "x"), ...FLAGS, name: "Acme Corp" }));
  assert.ok(!bad.ok);
  assert.equal(bad.error.rule, "bad-name");
  const badI = await withRuntime(parent, (rt) => rt.run("init", { dir: join(parent, "x"), ...FLAGS, initials: "SAM1" }));
  assert.ok(!badI.ok);
  assert.equal(badI.error.rule, "bad-initials");
});

test("init --no-git leaves no repo", async () => {
  const root = await init(undefined, { no_git: true });
  assert.ok(!existsSync(join(root, ".git")));
});

test("a template with an unknown placeholder fails with template-leftover", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "x.md"), "hello {{NOPE}}");
  assert.throws(
    () => renderTemplate({ NAME: "a" }, dir),
    (e: Error & { rule?: string }) => e.rule === "template-leftover",
  );
});

test("relPath gives forward slashes", () => {
  assert.equal(relPath(join("a", "b", "kc"), join("a", "helmlock")), "../../helmlock");
  assert.equal(relPath("x", "x"), ".");
});

test("project add: dry run, confirm gate, write, then duplicate refused", async () => {
  const root = await init();
  const wsFile = join(root, "Acme.code-workspace");
  const before = readFileSync(wsFile, "utf8");
  await withRuntime(root, async (rt) => {
    const dry = await rt.run("project add", { folder: "wms-api", path: "../wms-api", id: "wms" }, { dryRun: true });
    assert.ok(dry.ok);
    assert.match(dry.text ?? "", /wms-api/);
    assert.equal(readFileSync(wsFile, "utf8"), before);
    assert.ok(!existsSync(join(root, "projects", "wms")));

    const gated = await rt.run("project add", { folder: "wms-api", path: "../wms-api", id: "wms" });
    assert.ok(!gated.ok);
    assert.equal(gated.code, 2);
    assert.equal(gated.error.rule, "confirm-required");
    assert.equal(readFileSync(wsFile, "utf8"), before);

    const done = await rt.run("project add", { folder: "wms-api", path: "../wms-api", id: "wms", yes: true });
    assert.ok(done.ok, JSON.stringify(done));
    for (const f of [wsFile, `${wsFile}.template`]) {
      const ws = JSON.parse(readFileSync(f, "utf8")) as { folders: { name: string; path: string }[] };
      assert.deepEqual(ws.folders.at(-1), { name: "wms-api", path: "../wms-api" });
    }
    const pt = ProjectToml.parse(parse(readFileSync(join(root, "projects", "wms", "project.toml"), "utf8")));
    assert.equal(pt.project.id, "wms");
    assert.deepEqual(pt.project.repos, ["wms-api"]);
    assert.deepEqual(pt.project.owners, ["sam-abbott"]);
    assert.ok(existsSync(join(root, "projects", "wms", "README.md")));

    const again = await rt.run("project add", { folder: "wms-api", path: "../other", id: "wms2", yes: true });
    assert.ok(!again.ok);
    assert.equal(again.error.rule, "duplicate-folder");
    assert.ok(!existsSync(join(root, "projects", "wms2")));
  });
});

test("the generated hl.cmd runs `where` from another folder", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  // Inside the delivery repo's gitignored cache so DELIVERY_REL is a real relative path.
  const root = await init(join(DELIVERY_ROOT, ".hl-cache", "s6-tests"));
  assert.match(readFileSync(join(root, "hl.cmd"), "utf8"), /%~dp0\.\.\\/);
  const env = { ...process.env };
  delete env.HL_DELIVERY;
  delete env.HL_WORKSPACE;
  const r = spawnSync(`"${join(root, "hl.cmd")}" where --json`, { shell: true, cwd: tmpdir(), env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const { data } = JSON.parse(r.stdout) as { data: { name: string; author: string; workspace: string; delivery: string } };
  assert.equal(data.name, "Acme");
  assert.equal(data.author, "sam-abbott");
  assert.ok(same(data.workspace, root));
  assert.ok(same(data.delivery, DELIVERY_ROOT), `${data.delivery}`);
});

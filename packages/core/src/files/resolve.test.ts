import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { INSTALL_ROOT, parseDotEnv, resolveWorkspace } from "./resolve.ts";

const FIXTURES = resolve(import.meta.dirname, "../../../../test/fixtures");

let tmp: string;
let acme: string;
before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "hl-s2-ws-")));
  acme = join(tmp, "acme");
  cpSync(join(FIXTURES, "s2-ws"), acme, { recursive: true });
});
after(() => rmSync(tmp, { recursive: true, force: true }));

describe("resolveWorkspace", () => {
  test("ws-min: root, folders, layers, delivery from the system folder, author", () => {
    const root = join(FIXTURES, "ws-min");
    const info = resolveWorkspace(root, {});
    assert.equal(info.root, root);
    assert.equal(info.name, "Test");
    assert.equal(info.codeWorkspaceFile, join(root, "Test.code-workspace"));
    assert.deepEqual(
      info.folders.map((f) => [f.name, f.layer]),
      [
        ["knowledge", "workspace"],
        ["system", "system"],
      ],
    );
    assert.equal(info.deliveryRoot, resolve(root, "../helmlock"));
    assert.equal(info.sources.deliveryRoot, "code-workspace folder 'system'");
    assert.ok(info.author);
    assert.equal(info.sources.author, "author.local");
  });

  test("nested cwd walks up; JSONC workspace file; [[layers]] by folder name; unnamed folder uses its base name", () => {
    const info = resolveWorkspace(join(acme, "nested", "deep"), {});
    assert.equal(info.root, acme);
    assert.equal(info.name, "Acme");
    assert.deepEqual(
      info.folders.map((f) => [f.name, f.path, f.layer]),
      [
        ["knowledge", acme, "workspace"],
        ["system", join(tmp, "delivery"), "system"],
        ["wms-api", join(tmp, "wms-api"), "product"],
        ["overlay", join(acme, "overlays", "wms"), "project"],
      ],
    );
    assert.equal(info.deliveryRoot, join(tmp, "delivery"));
    assert.equal(info.author, "sohail"); // comment and blank lines skipped
    assert.match(info.sources.root ?? "", /^found /);
    assert.equal(info.sources.layers, "workspace.toml [[layers]]");
  });

  test("HL_DELIVERY overrides the system folder", () => {
    const info = resolveWorkspace(acme, { HL_DELIVERY: join(tmp, "elsewhere") });
    assert.equal(info.deliveryRoot, join(tmp, "elsewhere"));
    assert.equal(info.sources.deliveryRoot, "HL_DELIVERY");
  });

  test("HL_WORKSPACE overrides cwd (a folder or the file itself)", () => {
    const fromDir = resolveWorkspace(tmp, { HL_WORKSPACE: acme });
    assert.equal(fromDir.root, acme);
    assert.match(fromDir.sources.root ?? "", /^HL_WORKSPACE/);
    const fromFile = resolveWorkspace(join(FIXTURES, "ws-min"), { HL_WORKSPACE: join(acme, "Acme.code-workspace") });
    assert.equal(fromFile.root, acme);
    assert.equal(fromFile.name, "Acme");
  });

  test("started from the delivery checkout: the .env there names the default workspace (F39)", () => {
    const install = join(tmp, "install");
    mkdirSync(join(install, "packages", "cli"), { recursive: true });
    writeFileSync(join(install, ".env"), '# default workspace\nexport HL_WORKSPACE="../acme"\n');
    const info = resolveWorkspace(join(install, "packages", "cli"), {}, { installRoot: install });
    assert.equal(info.root, acme);
    assert.match(info.sources.root ?? "", /^\.env HL_WORKSPACE/);
    // Not inside the install: .env is not consulted.
    const outside = resolveWorkspace(join(tmp, "nowhere"), {}, { installRoot: install });
    assert.equal(outside.codeWorkspaceFile, undefined);
  });

  test("no workspace file: root is cwd, delivery is this install, author missing", () => {
    const dir = join(tmp, "empty");
    mkdirSync(dir, { recursive: true });
    const info = resolveWorkspace(dir, {}, { installRoot: join(tmp, "install-x") });
    assert.equal(info.root, dir);
    assert.deepEqual(info.folders, []);
    assert.equal(info.deliveryRoot, join(tmp, "install-x"));
    assert.equal(info.author, undefined);
    assert.equal(info.sources.author, "missing");
  });

  test("INSTALL_ROOT is the delivery repo root", () => {
    assert.equal(INSTALL_ROOT, resolve(FIXTURES, "../.."));
  });
});

describe("parsers", () => {
  test("parseDotEnv", () => {
    assert.deepEqual(parseDotEnv("A=1\n# B=2\nexport C='three'\nD = four # note\r\nbad line\n"), { A: "1", C: "three", D: "four" });
  });
});

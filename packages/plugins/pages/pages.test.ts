import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "../registry.ts";
import { ticketIdsOf } from "./index.ts";
import { renderMarkdown } from "./markdown.ts";
import { parseTestCases } from "./render.ts";

const demo = () => createTestWorkspace({ catalog, fixture: "ws-demo" });
const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");

test("page build writes the ticket page with header, decision, open question and rendered spec", async () => {
  const ws = await demo();
  try {
    const res = await ws.run("page build", { ticket: "T-001-sa" });
    assert.equal(res.ok, true, JSON.stringify(res));
    const html = read(ws.root, "site/t/T-001-sa.html");
    assert.match(html, /Gift card redemption at checkout/);
    assert.match(html, /<td><a href="[^"]*D-001-sa\.toml">D-001-sa<\/a><\/td><td>Where the balance lives<\/td><td>Gift card service<\/td>/);
    assert.match(html, /Blocking<\/span><a [^>]*>Q-001-sa<\/a> Can a customer use two gift cards on one order\?/);
    assert.match(html, /<h2[^>]*>Acceptance criteria<\/h2>/);
    assert.match(html, /AC-3/);
    assert.match(html, /Spec draft ready for review/);
    assert.match(html, /href="\.\.\/\.\.\/artifacts\/T-001-sa\/T-001-sa-spec\.md"/);
    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /<link[^>]+stylesheet/);
    assert.ok(existsSync(join(ws.root, "site/index.html")));
  } finally {
    await ws.cleanup();
  }
});

test("tasks show progress and the AC trace", async () => {
  const ws = await demo();
  try {
    await ws.run("page build", { ticket: "T-002-sa" });
    const html = read(ws.root, "site/t/T-002-sa.html");
    assert.match(html, /1 of 2 done \(50%\)/);
    assert.match(html, /Acceptance criteria trace/);
    assert.match(html, /CSV endpoint/);
  } finally {
    await ws.cleanup();
  }
});

test("a blocked ticket shows the blocker and its open bug", async () => {
  const ws = await demo();
  try {
    await ws.run("page build", { ticket: "T-004-sa" });
    const html = read(ws.root, "site/t/T-004-sa.html");
    assert.match(html, /Finance to confirm rounding rule/);
    assert.match(html, /class="hot"><td><a [^>]*>B-001-sa<\/a>/);
    assert.match(html, /chip bad">Blocked/);
  } finally {
    await ws.cleanup();
  }
});

test("the sanitizer drops script and raw html from markdown; mermaid fences become pre.mermaid", () => {
  const html = renderMarkdown(
    '# Hi\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror="alert(1)">\n\n```mermaid\ngraph TD; A-->B\n```\n',
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /<h1>Hi<\/h1>/);
  assert.match(html, /<pre class="mermaid">graph TD; A--(?:&gt;|>)B\n<\/pre>/);
  assert.match(renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |"), /<table>/);
  assert.match(renderMarkdown("[s](notes/a.md)", { base: "../../artifacts/T-1/" }), /href="\.\.\/\.\.\/artifacts\/T-1\/notes\/a\.md"/);
});

test("a script in the spec never reaches the page", async () => {
  const ws = await demo();
  try {
    const spec = join(ws.root, "artifacts/T-002-sa/T-002-sa-spec.md");
    writeFileSync(spec, `${readFileSync(spec, "utf8")}\n<script>alert("x")</script>\n`);
    await ws.run("page build", { ticket: "T-002-sa" });
    const html = read(ws.root, "site/t/T-002-sa.html");
    assert.doesNotMatch(html, /alert\("x"\)/);
  } finally {
    await ws.cleanup();
  }
});

test("dry run writes nothing and lists what it would write", async () => {
  const ws = await demo();
  try {
    const res = await ws.run("page build", {}, { dryRun: true });
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(ws.root, "site")), false);
    const data = (res as { data: { written: string[]; dryRun: boolean } }).data;
    assert.equal(data.dryRun, true);
    assert.equal(data.written.length, 6);
  } finally {
    await ws.cleanup();
  }
});

test("index lists the five tickets grouped by stage in workflow order", async () => {
  const ws = await demo();
  try {
    await ws.run("page build");
    const html = read(ws.root, "site/index.html");
    const links = html.match(/href="t\/T-\d{3}-sa\.html"/g) ?? [];
    assert.equal(links.length, 5);
    const order = [...html.matchAll(/<section class="stage" id="stage-([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(order.indexOf("backlog") < order.indexOf("spec") && order.indexOf("spec") < order.indexOf("build"), order.join(","));
    const spec = html.slice(html.indexOf('id="stage-spec"'), html.indexOf('id="stage-plan"'));
    assert.match(spec, /T-001-sa/);
    assert.match(spec, /T-004-sa/);
    for (const id of ["T-001-sa", "T-002-sa", "T-003-sa", "T-004-sa", "T-005-sa"]) assert.ok(existsSync(join(ws.root, `site/t/${id}.html`)));
  } finally {
    await ws.cleanup();
  }
});

test("the post-execute hook rewrites the page after ticket comment, and not in a dry run", async () => {
  const ws = await demo();
  try {
    // One hl call mounts only the plugins its verb needs; the console (mountAll) keeps pages mounted.
    await ws.runtime.mountForVerb("page build");
    const page = join(ws.root, "site/t/T-001-sa.html");
    assert.equal(existsSync(page), false);
    const res = await ws.run("ticket comment", { id: "T-001-sa", text: "Second look done" });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.match(readFileSync(page, "utf8"), /Second look done/);
    assert.ok(existsSync(join(ws.root, "site/index.html")));
    assert.equal(existsSync(join(ws.root, "site/t/T-002-sa.html")), false, "only the named ticket is rebuilt");

    const dry = await ws.run("ticket comment", { id: "T-001-sa", text: "Only a preview" }, { dryRun: true });
    assert.equal(dry.ok, true);
    assert.doesNotMatch(readFileSync(page, "utf8"), /Only a preview/);
  } finally {
    await ws.cleanup();
  }
});

test("page path prints the page file", async () => {
  const ws = await demo();
  try {
    const res = await ws.run("page path", { ticket: "T-003-sa" });
    assert.equal(res.ok, true);
    const data = (res as { data: { rel: string; exists: boolean } }).data;
    assert.equal(data.rel, "site/t/T-003-sa.html");
    assert.equal(data.exists, false);
  } finally {
    await ws.cleanup();
  }
});

test("test cases are listed from test-cases/*.md and traced to ACs", async () => {
  const ws = await demo();
  try {
    const dir = join(ws.root, "artifacts/T-001-sa/test-cases");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "T-001-sa-test-cases.md"),
      "# Cases\n\n| Id | AC | What |\n|---|---|---|\n| TC-U-01 | AC-1 | balance deducted |\n| TC-E-01 | AC-3 | unknown code |\n",
    );
    await ws.run("page build", { ticket: "T-001-sa" });
    const html = read(ws.root, "site/t/T-001-sa.html");
    assert.match(html, /<code>TC-U-01<\/code>/);
    assert.match(html, /<td>AC-3<\/td><td><span class="na">no task<\/span><\/td><td>TC-E-01<\/td>/);
    assert.match(html, /test-cases\/T-001-sa-test-cases\.md/);
  } finally {
    await ws.cleanup();
  }
});

test("ticketIdsOf finds ids in input and in a returned Ticket", () => {
  assert.deepEqual(ticketIdsOf({ id: "T-001-sa", text: "x" }, { ts: "now" }), ["T-001-sa"]);
  assert.deepEqual(ticketIdsOf({ title: "x" }, { schema_version: 1, ticket: { id: "T-009-sa" } }), ["T-009-sa"]);
  assert.deepEqual(ticketIdsOf({ ticket: "T-002-sa", id: "S1-T1" }, {}), ["T-002-sa"]);
  assert.deepEqual(ticketIdsOf({ id: "TD-001-sa" }, {}), []);
  assert.deepEqual(parseTestCases("- TC-N-2 rejects bad input\n- TC-N-2 dup").length, 1);
});

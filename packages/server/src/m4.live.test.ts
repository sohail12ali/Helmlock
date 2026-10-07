// Live: a real Claude Code run (haiku) started through the console API asks for `git status` via the PreToolUse
// hook; the card is answered in the console; the run finishes. Skipped unless HL_LIVE=1 (costs tokens, needs a login).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { type ApiResponse, type ApprovalCard, type RunDetail, type RunEventLine, WRITE_HEADER } from "@helmlock/core";
import { createTestWorkspace } from "@helmlock/core/testing";
import { catalog } from "@helmlock/plugins";
import { startServer } from "./server.ts";

const live = process.env.HL_LIVE === "1";

test("live claude: Bash git status -> a permission card -> allowed in the console -> the run finishes", {
  skip: !live && "set HL_LIVE=1",
  timeout: 300000,
}, async () => {
  const ws = await createTestWorkspace({ catalog, fixture: "ws-demo" });
  const srv = await startServer({ runtime: ws.runtime, port: 0, log: () => {} });
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(new URL(`/api/v1${path}`, srv.url), {
      method,
      headers: { "content-type": "application/json", [WRITE_HEADER]: "1" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const j = (await res.json()) as ApiResponse<T>;
    if (!j.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(j.error)}`);
    return j.data;
  };
  try {
    execFileSync("git", ["init", "-q"], { cwd: ws.root });
    const run = await api<RunDetail>("POST", "/runs", {
      task: "Use the Bash tool to run exactly this command once: git status\nThen reply with the single word DONE.",
      mode: "ask",
      model: "haiku",
    });
    const t0 = Date.now();
    let card: ApprovalCard | undefined;
    while (!card && Date.now() - t0 < 180000) {
      card = (await api<ApprovalCard[]>("GET", "/approvals?status=pending")).find((c) => c.run_id === run.id);
      const s = await api<RunDetail>("GET", `/runs/${run.id}`);
      if (!card && s.status !== "running") break;
      if (!card) await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(card, "a permission card appeared");
    process.stdout.write(`# card: ${card.action} ${JSON.stringify(card.detail)} tool=${card.tool}\n`);
    assert.equal(card.tool, "Bash");
    assert.match(card.detail, /git status/);
    await api<ApprovalCard>("POST", `/approvals/${card.id}`, { decision: "allow" });

    // Follow the run to its end over SSE.
    const res = await fetch(new URL(`/api/v1/runs/${run.id}/events`, srv.url));
    const text = await res.text();
    const lines = text
      .split("\n\n")
      .filter((b) => b.includes("event: event"))
      .map((b) => JSON.parse(b.slice(b.indexOf("data: ") + 6)) as RunEventLine);
    const final = await api<RunDetail>("GET", `/runs/${run.id}`);
    const tools = lines
      .filter((l) => l.event.type === "tool")
      .map((l) => {
        const e = l.event as { phase: string; name: string; isError?: boolean };
        return `${e.phase}:${e.name}${e.isError ? ":error" : ""}`;
      });
    process.stdout.write(`# run ${run.id}: status=${final.status} result=${JSON.stringify(final.first_result_line)} tools=${tools.join(",")}\n`);
    assert.equal(final.status, "done");
    assert.ok(tools.includes("start:Bash"));
    assert.ok(tools.includes("end:Bash"), "the allowed command ran (no error)");
  } finally {
    await srv.close();
    await ws.cleanup();
  }
});

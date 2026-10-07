import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FIXTURES } from "@helmlock/core/testing";

const SCRIPT = join(import.meta.dirname, "pretool.ts");
const POLICY = join(FIXTURES, "s5-harness", "harness", "harness.toml");
const cwd = join(FIXTURES, "s5-harness");

let server: Server;
let url: string;
const seen: { token: string | undefined; body: Record<string, unknown> }[] = [];
/** What the fake console answers next. */
let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, data: { decision: "allow", reason: "approved by sam" } } };

const readBody = (req: IncomingMessage) =>
  new Promise<string>((res) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
    });
    req.on("end", () => res(s));
  });

before(async () => {
  server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    seen.push({ token: req.headers["x-helmlock-hook-token"] as string | undefined, body });
    assert.equal(req.url, "/api/v1/hooks/pretooluse");
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
});

function run(args: string[], payload: unknown, env: Record<string, string | undefined>): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, HL_SERVER_URL: undefined, HL_HOOK_TOKEN: undefined, HL_RUN_ID: undefined, CLAUDE_PROJECT_DIR: "", ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("close", (code) => res({ code, out: out.trim() }));
    child.stdin.end(JSON.stringify(payload));
  });
}
const payload = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status" }, tool_use_id: "tu1", cwd };
const decision = (out: string) =>
  (JSON.parse(out) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }).hookSpecificOutput;

test("server mode: posts the tool call with the token and prints the person's allow", async () => {
  answer = { status: 200, body: { ok: true, data: { decision: "allow", reason: "approved by sam" } } };
  const r = await run(["--host", "claude", "--server"], payload, { HL_SERVER_URL: url, HL_HOOK_TOKEN: "t0k", HL_RUN_ID: "run-1" });
  assert.equal(r.code, 0);
  assert.deepEqual(decision(r.out), { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "approved by sam" });
  const last = seen.at(-1);
  assert.equal(last?.token, "t0k");
  assert.deepEqual(last?.body, { run_id: "run-1", tool_name: "Bash", tool_input: { command: "git status" }, tool_use_id: "tu1" });
});

test("server mode: a deny, a refused call and anything unexpected all deny", async () => {
  const env = { HL_SERVER_URL: url, HL_HOOK_TOKEN: "t0k", HL_RUN_ID: "run-1" };
  answer = { status: 200, body: { ok: true, data: { decision: "deny", reason: "declined by sam" } } };
  assert.equal(decision((await run(["--host", "claude", "--server"], payload, env)).out).permissionDecision, "deny");
  answer = { status: 403, body: { ok: false, error: { rule: "hook-token", message: "wrong token" } } };
  const refused = decision((await run(["--host", "claude", "--server"], payload, env)).out);
  assert.equal(refused.permissionDecision, "deny");
  assert.match(refused.permissionDecisionReason, /wrong token/);
  answer = { status: 200, body: { ok: true, data: { decision: "maybe" } } };
  assert.equal(decision((await run(["--host", "claude", "--server"], payload, env)).out).permissionDecision, "deny");
  const noToken = decision((await run(["--host", "claude", "--server"], payload, { HL_SERVER_URL: url, HL_RUN_ID: "run-1" })).out);
  assert.equal(noToken.permissionDecision, "deny");
  const garbage = await run(["--host", "claude", "--server"], "not json", env);
  assert.equal(decision(garbage.out).permissionDecision, "deny");
});

test("server mode: the console is down -> deny (fail-closed)", async () => {
  const down = createServer();
  await new Promise<void>((r) => down.listen(0, "127.0.0.1", () => r()));
  const port = (down.address() as AddressInfo).port;
  await new Promise<void>((r) => down.close(() => r()));
  const r = await run(["--host", "claude", "--server"], payload, { HL_SERVER_URL: `http://127.0.0.1:${port}`, HL_HOOK_TOKEN: "t0k", HL_RUN_ID: "run-1" });
  assert.equal(r.code, 0);
  const d = decision(r.out);
  assert.equal(d.permissionDecision, "deny");
  assert.match(d.permissionDecisionReason, /unreachable/);
});

test("policy hook inside a server run: deny_shell still denies, everything else defers to the server hook", async () => {
  const env = { HL_SERVER_URL: url, HL_HOOK_TOKEN: "t0k", HL_RUN_ID: "run-1" };
  const before = seen.length;
  const quiet = await run(["--host", "claude", "--policy", POLICY], { ...payload, tool_input: { command: "git push" } }, env);
  assert.equal(quiet.out, "", "ask is the server hook's job: no second card");
  const denied = await run(["--host", "claude", "--policy", POLICY], { ...payload, tool_input: { command: "rm -rf /" } }, env);
  assert.equal(decision(denied.out).permissionDecision, "deny");
  assert.equal(seen.length, before, "the policy hook never calls the server");
  const outside = await run(["--host", "claude", "--policy", POLICY], { ...payload, tool_input: { command: "git push" } }, {});
  assert.equal(decision(outside.out).permissionDecision, "ask", "no server: today's behaviour");
});

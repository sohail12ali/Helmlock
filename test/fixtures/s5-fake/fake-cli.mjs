// A fake agent CLI for spawn tests. Speaks a minimal stream-json both normalisers understand.
// FAKE_MODE: echo | hang | linger | silent | write | fail | child
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const mode = process.env.FAKE_MODE ?? "echo";
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const session = "11111111-2222-3333-4444-555555555555";
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  prompt += d;
});
process.stdin.on("end", main);

function result(text, extra = {}) {
  out({ type: "result", subtype: "success", is_error: false, result: text, session_id: session, usage: { input_tokens: 3, output_tokens: 2 }, ...extra });
}

function main() {
  if (process.env.FAKE_PIDFILE) writeFileSync(process.env.FAKE_PIDFILE, String(process.pid));
  out({ type: "system", subtype: "init", session_id: session, model: "fake-1" });
  if (mode === "echo") {
    out({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: `PROMPT<<${prompt}>>` }] } });
    out({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: `ARGS<<${JSON.stringify(args)}>>` }] } });
    result(prompt);
    return;
  }
  if (mode === "fail") {
    const resume = args.includes("--resume");
    if (resume) {
      out({ type: "result", subtype: "error_during_execution", is_error: true, result: "No conversation found with session id abc", session_id: session });
      process.exit(1);
    }
    result("fresh");
    return;
  }
  if (mode === "write") {
    const f = process.env.FAKE_WRITE;
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, "stage = \"done\"\n");
    result("wrote it");
    return;
  }
  if (mode === "linger") {
    result("done but lingering");
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "child") {
    const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    if (process.env.FAKE_CHILDFILE) writeFileSync(process.env.FAKE_CHILDFILE, String(c.pid));
    out({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "working" }] } });
    setInterval(() => out({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "tick" }] } }), 200);
    return;
  }
  if (mode === "silent") {
    setInterval(() => {}, 1000);
    return;
  }
  // hang: keep printing so the silence watchdog never fires
  setInterval(() => out({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "tick" }] } }), 200);
}

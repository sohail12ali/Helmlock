// A fake agent CLI for spawn tests. Speaks a minimal stream-json both normalisers understand.
// FAKE_MODE: echo | hang | linger | silent | write | fail | child
// With --input-format stream-json (a live session) each stdin line is a user message: it is acknowledged when
// --replay-user-messages is given, the first one starts `main`, and in echo mode later ones are turns of their own
// (a message that arrives while a turn is busy joins that turn, like Claude Code). FAKE_TURN_MS delays each turn.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const mode = process.env.FAKE_MODE ?? "echo";
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const session = "11111111-2222-3333-4444-555555555555";
const live = args.includes("--input-format");
let prompt = "";
process.stdin.setEncoding("utf8");
if (!live) {
  process.stdin.on("data", (d) => {
    prompt += d;
  });
  process.stdin.on("end", main);
} else {
  let buf = "";
  let started = false;
  let turn; // texts of the busy turn
  const late = []; // FAKE_LATE=1: messages that arrive mid-turn are taken in only after the turn's result
  const turnMs = Number(process.env.FAKE_TURN_MS ?? 0);
  const ack = (m) => {
    if (args.includes("--replay-user-messages")) out({ ...m, session_id: session, isReplay: true });
  };
  const runTurn = (first) => {
    turn = [first];
    setTimeout(() => {
      const text = turn.join(" + ");
      turn = undefined;
      out({ type: "assistant", message: { id: `m-${Date.now()}`, content: [{ type: "text", text: `TURN<<${text}>>` }] } });
      result(text);
      const next = late.shift();
      if (next) {
        out({ type: "system", subtype: "init", session_id: session, model: "fake-1" });
        ack(next.m);
        runTurn(next.text);
      }
    }, turnMs);
  };
  process.stdin.on("data", (d) => {
    buf += d;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      const text = (m.message?.content ?? []).map((c) => c.text ?? "").join("");
      if (started && turn && process.env.FAKE_LATE === "1") {
        late.push({ m, text });
        continue;
      }
      ack(m);
      if (!started) {
        started = true;
        prompt = text;
        if (mode === "echo" && turnMs > 0) {
          out({ type: "system", subtype: "init", session_id: session, model: "fake-1" });
          runTurn(text);
        } else main();
      } else if (mode === "echo") {
        if (turn) turn.push(text);
        else runTurn(text);
      }
    }
  });
}

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

// A fake `hl` for hook tests (HL_HOOK_HL points here).
const a = process.argv.slice(2).join(" ");
if (a === "context --session") {
  process.stdout.write("In flight: T-001-sa (build)\n");
} else if (a.startsWith("validate --changed ")) {
  if (a.includes("bad")) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: 1, error: { rule: "layout:ticket-folder", message: "ticket.toml edited by hand", fix: "use hl ticket move" } })}\n`);
    process.exitCode = 1;
  } else if (a.includes("warn")) {
    process.stdout.write(`${JSON.stringify([{ level: "warn", rule: "x", message: "only a warning" }])}\n`);
  } else {
    process.stdout.write("[]\n");
  }
} else if (a === "log show") {
  process.stdout.write("2026-10-07 sam: one line\n");
} else {
  process.stderr.write(`unknown command: ${a}\n`);
  process.exitCode = 1;
}

// PostToolUse on Edit|Write (Claude) / afterFileEdit (Cursor): `hl validate --changed <file> --json`.
// Errors: Claude gets them on stderr with exit 2 (fed back to the model); Cursor gets a followup_message.
import { isAbsolute, join } from "node:path";
import { guarded, isForeign, parseArgs, print, projectDir, readPayload, runHl } from "./common.ts";
import { editedFile, editMessage, findingsFrom } from "./logic.ts";

await guarded(async () => {
  const a = parseArgs(process.argv.slice(2));
  const p = await readPayload();
  if (isForeign(a.host, p)) return 0;
  const file = editedFile(p);
  if (!file) return 0;
  const dir = projectDir(p);
  const abs = isAbsolute(file) ? file : join(dir, file);
  const r = await runHl([...(a.hl.length ? a.hl : ["validate", "--changed"]), abs, "--json"], dir);
  const errors = findingsFrom(r.stdout).filter((f) => (f.level ?? "error") === "error");
  if (!errors.length) return 0;
  const msg = editMessage(file, errors);
  if (a.host === "claude") {
    process.stderr.write(`${msg}\n`);
    return 2;
  }
  print({ followup_message: msg });
  return 0;
});

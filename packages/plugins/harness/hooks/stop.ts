// Stop (Claude) / stop (Cursor): the work-log reminder. Once per stop, when the turn changed files and did not
// log, asks the agent to log using the hook's `text` from harness.toml, followed by the configured hl command's
// output (e.g. `hl log show`).
import { guarded, isForeign, parseArgs, print, projectDir, readPayload, resolvePolicy, runHl } from "./common.ts";
import { stopEnvelope, stopIsQuiet, stopText, transcriptVerdict } from "./logic.ts";

await guarded(async () => {
  const a = parseArgs(process.argv.slice(2));
  const p = await readPayload();
  if (isForeign(a.host, p) || stopIsQuiet(p)) return 0;
  const text = a.policy ? stopText(resolvePolicy(p, a.policy)) : undefined;
  if (!text) return 0;
  const v = transcriptVerdict(p);
  if (v && (v.logged || !v.wrote)) return 0;
  let today = "";
  if (a.hl.length) {
    const r = await runHl(a.hl, projectDir(p));
    if (r.code === 0) today = r.stdout.trim().slice(0, 800);
  }
  print(stopEnvelope(a.host, today ? `${text}\n\nLogged so far today:\n${today}` : text));
  return 0;
});

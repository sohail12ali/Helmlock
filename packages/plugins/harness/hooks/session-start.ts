// SessionStart (Claude) / sessionStart (Cursor): inject the digest from `hl context --session`.
import { guarded, isForeign, parseArgs, print, projectDir, readPayload, runHl } from "./common.ts";
import { MAX_CONTEXT, sessionEnvelope } from "./logic.ts";

await guarded(async () => {
  const a = parseArgs(process.argv.slice(2));
  const p = await readPayload();
  if (isForeign(a.host, p)) return 0;
  const r = await runHl(a.hl.length ? a.hl : ["context", "--session"], projectDir(p));
  const text = r.code === 0 ? r.stdout.trim() : "";
  if (text) print(sessionEnvelope(a.host, text.slice(0, MAX_CONTEXT)));
  return 0;
});

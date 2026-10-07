// beforeShellExecution (Cursor) / PreToolUse on Bash (Claude): allow, ask or deny a shell command from
// harness.toml [permissions] ask and deny_shell. Fail closed: any internal error denies.
import { parse } from "smol-toml";
import { guarded, isForeign, parseArgs, print, readPayload, readText, resolvePolicy } from "./common.ts";
import { commandOf, decide, shellEnvelope } from "./logic.ts";

const args = parseArgs(process.argv.slice(2));
await guarded(
  async () => {
    const p = await readPayload();
    if (isForeign(args.host, p)) return 0;
    const command = commandOf(p);
    if (command === undefined) throw new Error("no shell command in the hook payload");
    if (!args.policy) throw new Error("no --policy given");
    const t = parse(readText(resolvePolicy(p, args.policy))) as { permissions?: { ask?: string[]; deny_shell?: string[] } };
    const { decision, reason } = decide(command, t.permissions ?? {});
    print(shellEnvelope(args.host, decision, reason));
    return 0;
  },
  (e) => print(shellEnvelope(args.host, "deny", `helmlock pretool hook failed (${(e as Error).message}); denied fail-closed`)),
);

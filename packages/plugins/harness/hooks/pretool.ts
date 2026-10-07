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
    if (!args.policies.length) throw new Error("no --policy given");
    // Every policy layer counts (system, then workspace): their ask and deny_shell lists are unioned.
    const ask: string[] = [];
    const denyShell: string[] = [];
    for (const policy of args.policies) {
      const t = parse(readText(resolvePolicy(p, policy))) as { permissions?: { ask?: string[]; deny_shell?: string[] } };
      ask.push(...(t.permissions?.ask ?? []));
      denyShell.push(...(t.permissions?.deny_shell ?? []));
    }
    const { decision, reason } = decide(command, { ask, deny_shell: denyShell });
    print(shellEnvelope(args.host, decision, reason));
    return 0;
  },
  (e) => print(shellEnvelope(args.host, "deny", `helmlock pretool hook failed (${(e as Error).message}); denied fail-closed`)),
);

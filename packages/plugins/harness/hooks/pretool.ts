// beforeShellExecution (Cursor) / PreToolUse on Bash (Claude): allow, ask or deny a shell command from
// harness.toml [permissions] ask and deny_shell. Fail closed: any internal error denies.
//
// Server mode (a run started by `hl serve`, which sets HL_SERVER_URL, HL_HOOK_TOKEN and HL_RUN_ID):
//   --server   the per-run settings hook: POST the tool call to /api/v1/hooks/pretooluse and wait for a person's
//              answer (control-center hooks/pretooluse.py). Any error, timeout or missing value denies.
//   otherwise  the workspace policy hook still denies deny_shell commands, and defers everything else to the
//              server hook (prints nothing), so one tool call never makes two cards.
import { parse } from "smol-toml";
import { guarded, isForeign, parseArgs, print, readPayload, readText, resolvePolicy } from "./common.ts";
import { askServer, commandOf, decide, shellEnvelope } from "./logic.ts";

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const serverFlag = argv.includes("--server");
const timeoutArg = argv.indexOf("--timeout");
const timeoutSec = timeoutArg >= 0 ? Number(argv[timeoutArg + 1]) || 300 : 300;
const serverEnv = Boolean(process.env.HL_SERVER_URL && process.env.HL_HOOK_TOKEN);

function policyOf(p: Record<string, unknown>): { ask: string[]; deny_shell: string[] } {
  // Every policy layer counts (system, then workspace): their ask and deny_shell lists are unioned.
  const ask: string[] = [];
  const denyShell: string[] = [];
  for (const policy of args.policies) {
    const t = parse(readText(resolvePolicy(p, policy))) as { permissions?: { ask?: string[]; deny_shell?: string[] } };
    ask.push(...(t.permissions?.ask ?? []));
    denyShell.push(...(t.permissions?.deny_shell ?? []));
  }
  return { ask, deny_shell: denyShell };
}

await guarded(
  async () => {
    const p = await readPayload();
    if (serverFlag) {
      const { decision, reason } = await askServer(p, {
        url: process.env.HL_SERVER_URL,
        token: process.env.HL_HOOK_TOKEN,
        runId: process.env.HL_RUN_ID,
        timeoutMs: (timeoutSec + 30) * 1000,
      });
      print(shellEnvelope("claude", decision, reason));
      return 0;
    }
    if (isForeign(args.host, p)) return 0;
    const command = commandOf(p);
    if (command === undefined) throw new Error("no shell command in the hook payload");
    if (!args.policies.length) throw new Error("no --policy given");
    const { decision, reason } = decide(command, policyOf(p));
    if (serverEnv && args.host === "claude" && decision !== "deny") return 0; // the server hook asks the person
    print(shellEnvelope(args.host, decision, reason));
    return 0;
  },
  (e) => print(shellEnvelope(serverFlag ? "claude" : args.host, "deny", `helmlock pretool hook failed (${(e as Error).message}); denied fail-closed`)),
);

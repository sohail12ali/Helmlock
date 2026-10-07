// `hl serve [--port 4317] [--open]`: the read-only console for the resolved workspace, until Ctrl+C.
import { spawn } from "node:child_process";
import type { MainIo } from "./main.ts";
import { type Out, printFailure } from "./output.ts";

export const SERVE_HELP = `Usage: hl serve [--port 4317] [--open]

Start the read-only console for this workspace on http://127.0.0.1:<port>/ (localhost only).
Every change still goes through hl verbs; the console follows them live.

Options:
  --port <n>   port to listen on (default 4317)
  --open       open the console in the default browser

Examples:
  hl serve
  hl serve --port 4400 --open
`;

export interface ServeArgs {
  port: number;
  open: boolean;
}

export function parseServeArgs(argv: readonly string[]): ServeArgs | { error: string } {
  const out: ServeArgs = { port: 4317, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "serve" && i === 0) continue;
    if (a === "--open") out.open = true;
    else if (a === "--port" || a.startsWith("--port=")) {
      const v = a.includes("=") ? a.slice(7) : argv[++i];
      const n = Number(v);
      if (!v || !Number.isInteger(n) || n < 0 || n > 65535) return { error: `--port needs a number from 0 to 65535, got ${v ?? "nothing"}` };
      out.port = n;
    } else return { error: `unknown argument ${a}` };
  }
  return out;
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // the URL is printed; opening is a convenience
  }
}

/** Runs until SIGINT or SIGTERM (or `stop` resolves, for tests). */
export async function serve(io: MainIo, rest: readonly string[], json: boolean, out: Out, stop?: Promise<void>): Promise<number> {
  const args = parseServeArgs(rest);
  if ("error" in args) return printFailure({ rule: "bad-args", message: `hl serve: ${args.error}`, fix: "see `hl serve --help`" }, 1, json, out);
  const [{ createRuntime }, { startServer }] = await Promise.all([import("../../core/src/runtime/runtime.ts"), import("@helmlock/server")]);
  const rt = await createRuntime({ cwd: io.cwd, env: io.env, catalog: io.catalog });
  if (rt.configError) {
    const e = rt.configError as Error & { rule?: string; file?: string; fix?: string };
    await rt.dispose();
    return printFailure({ rule: e.rule ?? "config", message: e.message, ...(e.file ? { file: e.file } : {}), ...(e.fix ? { fix: e.fix } : {}) }, 1, json, out);
  }
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({ runtime: rt, port: args.port, log: (l) => io.stderr(`hl serve: ${l}\n`) });
  } catch (e) {
    await rt.dispose();
    const err = e as Error & { rule?: string; fix?: string };
    return printFailure({ rule: err.rule ?? "serve", message: err.message, ...(err.fix ? { fix: err.fix } : {}) }, 1, json, out);
  }
  if (json) io.stdout(`${JSON.stringify({ ok: true, data: { url: server.url, port: server.port, root: rt.info.root } })}\n`);
  else io.stdout(`Helmlock console for ${rt.info.name}: ${server.url}\nRead-only; press Ctrl+C to stop.\n`);
  if (args.open) openBrowser(server.url);

  await new Promise<void>((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
    stop?.then(done);
  });
  if (!json) io.stdout("Stopping the console...\n");
  await server.close();
  await rt.dispose();
  return 0;
}

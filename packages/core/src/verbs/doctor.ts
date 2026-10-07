// `hl doctor` checks. CheckResult shape ported from Paperclip cli/src/checks/index.ts
// (MIT, Copyright (c) 2025 Paperclip AI): {name, status, message, canRepair, repair(), repairHint}.
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Context, MountResult } from "../contracts/kernel.ts";

export interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  canRepair?: boolean;
  repair?: () => void | Promise<void>;
  repairHint?: string;
}

export interface DoctorEnv {
  ctx: Context;
  env: Record<string, string | undefined>;
  nodeVersion: string;
  configError: Error | undefined;
  /** Raw workspace.toml when it parsed. */
  workspaceRaw: () => Promise<Record<string, unknown> | undefined>;
  mountAll: () => Promise<MountResult[]>;
  pending: () => { id: string; waitingFor: string[] }[];
  cycles: () => string[];
  dryRun: boolean;
}

/** Find a command on PATH without spawning (PATHEXT on Windows). */
export function which(cmd: string, env: Record<string, string | undefined>): string | undefined {
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";")] : [""];
  for (const d of dirs)
    for (const e of exts) {
      const p = join(d, cmd + e);
      try {
        if (statSync(p).isFile()) return p;
      } catch {}
    }
  return undefined;
}

export function versionAtLeast(have: string, want: string): boolean {
  const a = have.replace(/^v/, "").split(".").map(Number);
  const b = want.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

const PER_MACHINE = ["author.local", "workspace.local.toml", ".env"];

export async function runChecks(d: DoctorEnv): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const nodeOk = versionAtLeast(d.nodeVersion, "24.11.0");
  out.push({
    name: "node",
    status: nodeOk ? "pass" : "fail",
    message: `node ${d.nodeVersion}${nodeOk ? "" : " (need 24.11 or newer)"}`,
    repairHint: nodeOk ? undefined : "install Node 24 LTS",
  });

  const tools: [string, string[], "fail" | "warn", string][] = [
    ["pnpm", ["pnpm"], "fail", "corepack enable pnpm"],
    ["git", ["git"], "fail", "install git"],
    ["rg", ["rg"], "warn", "install ripgrep (hl search falls back to a slower scan)"],
    ["claude", ["claude"], "warn", "install Claude Code: npm i -g @anthropic-ai/claude-code"],
    ["cursor agent", ["cursor-agent", "agent"], "warn", "install the Cursor CLI: https://cursor.com/cli"],
  ];
  for (const [name, cmds, missing, hint] of tools) {
    let found: string | undefined;
    for (const c of cmds) found ??= which(c, d.env);
    if (!found && name === "cursor agent" && d.env.LOCALAPPDATA) {
      const p = join(d.env.LOCALAPPDATA, "cursor-agent", "agent.cmd");
      if (existsSync(p)) found = p;
    }
    out.push(found ? { name, status: "pass", message: found } : { name, status: missing, message: "not found on PATH", repairHint: hint });
  }

  const w = d.ctx.get("workspace");
  out.push(
    w.codeWorkspaceFile
      ? { name: "workspace", status: "pass", message: `${w.root} (${w.codeWorkspaceFile})` }
      : { name: "workspace", status: "fail", message: "no .code-workspace found from here", repairHint: "cd into a knowledge repo or set HL_WORKSPACE" },
  );
  out.push(
    existsSync(join(w.deliveryRoot, "packages", "core"))
      ? { name: "delivery", status: "pass", message: `${w.deliveryRoot} (${w.sources.deliveryRoot})` }
      : {
          name: "delivery",
          status: "fail",
          message: `${w.deliveryRoot} is not a helmlock delivery repo`,
          repairHint: "add a folder named 'system' to the .code-workspace or set HL_DELIVERY",
        },
  );

  // workspace.toml parses and matches the schema
  if (d.configError) {
    const e = d.configError as Error & { fix?: string };
    out.push({ name: "workspace.toml", status: "fail", message: e.message, repairHint: e.fix });
  } else {
    const raw = await d.workspaceRaw();
    if (!raw) out.push({ name: "workspace.toml", status: "warn", message: "missing; using the delivery-lite bundle", repairHint: "run hl init" });
    else {
      const { validateWorkspaceToml } = await import("../config/config.ts");
      const issues = await validateWorkspaceToml(raw);
      out.push(
        issues.length ? { name: "workspace.toml", status: "fail", message: issues.join("; ") } : { name: "workspace.toml", status: "pass", message: "parses" },
      );
    }
  }

  // plugins: failed and pending
  const results = d.configError ? [] : await d.mountAll();
  const failed = results.filter((r) => r.state === "failed");
  const pending = d.pending();
  out.push(
    failed.length
      ? { name: "plugins", status: "fail", message: failed.map((f) => `${f.id}: ${f.error}`).join("; ") }
      : pending.length
        ? { name: "plugins", status: "warn", message: `pending: ${pending.map((p) => `${p.id} (waiting for ${p.waitingFor.join(", ")})`).join("; ")}` }
        : { name: "plugins", status: "pass", message: `${results.length} mounted` },
  );

  const cycles = d.cycles();
  if (cycles.length)
    out.push({
      name: "plugin order",
      status: "warn",
      message: `requires cycle in plugin.toml: ${cycles.join("; ")}`,
      repairHint: "one side should get the service at call time and drop it from requires",
    });

  // author is set and in the roster
  if (!w.author)
    out.push({ name: "author", status: "fail", message: "author.local is missing or empty", repairHint: "write your slug from people.toml into author.local" });
  else if (!d.ctx.has("roster")) out.push({ name: "author", status: "warn", message: `${w.author} (roster plugin not active; not checked)` });
  else {
    const p = await d.ctx.get("roster").get(w.author);
    out.push(
      p
        ? { name: "author", status: "pass", message: `${w.author} (${p.name})` }
        : { name: "author", status: "fail", message: `${w.author} is not in people.toml`, repairHint: "add the person to people.toml or fix author.local" },
    );
  }

  // per-machine files are gitignored (safe repair: append to .gitignore)
  if (w.codeWorkspaceFile) {
    const files = d.ctx.get("files");
    const text = (await files.exists(".gitignore")) ? await files.readText(".gitignore") : "";
    const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const missing = PER_MACHINE.filter((f) => !lines.has(f) && !lines.has(`/${f}`));
    out.push(
      missing.length
        ? {
            name: "gitignore",
            status: "warn",
            message: `not ignored: ${missing.join(", ")}`,
            canRepair: true,
            repairHint: "hl doctor --repair adds them to .gitignore",
            repair: async () => {
              const sep = text === "" || text.endsWith("\n") ? "" : "\n";
              await files.writeText(".gitignore", `${text}${sep}${missing.join("\n")}\n`, { dryRun: d.dryRun });
            },
          }
        : { name: "gitignore", status: "pass", message: "per-machine files are ignored" },
    );
  }
  return out;
}

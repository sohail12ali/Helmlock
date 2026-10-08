// The "loop" runtime adapter: the Helmlock model engine behind the same RuntimeAdapter contract as Claude Code and
// Cursor (Blueprint 33). It can resume (session log), steer (a message at the next step), approve (approval queue)
// and run any configured provider model.
import type { EngineCheck, EngineTest, RunHandle, RunOptions, RuntimeAdapter } from "@helmlock/core";
import { type LoopDeps, startLoop } from "./loop.ts";

export const LOOP_ID = "loop";

export function createLoopAdapter(deps: LoopDeps): RuntimeAdapter {
  return {
    id: LOOP_ID,
    label: "Helmlock loop",
    capabilities: { resume: true, steer: true, approve: true, models: true },
    async detect() {
      const p = deps.providers();
      if (!p?.providers().length) return null;
      const model = p.defaultModel();
      return { command: "built-in", ...(model ? { version: model } : {}) };
    },
    async test(o?: { model?: string }): Promise<EngineTest> {
      const checks: EngineCheck[] = [];
      const fail = (message: string): EngineTest => ({ ok: false, checks: [...checks, { level: "error", message }] });
      const p = deps.providers();
      if (!p) return fail("the providers plugin is not mounted: add it to workspace.toml");
      const model = o?.model ?? p.defaultModel();
      if (!model) return fail("no model is set: add a provider and a default model in Settings > Models");
      const provider = p.providers().find((x) => model.startsWith(`${x.id}/`) && model.length > x.id.length + 1);
      if (!provider) return fail(`unknown model "${model}": model ids look like <provider>/<model> with a configured provider`);
      const info = p.models().find((m) => m.id === model);
      if (!info) checks.push({ level: "warn", message: `${model} is not in the models table; the context window is assumed to be 32k` });
      else if (!info.capabilities.tool_calls)
        checks.push({ level: "warn", message: `${model} is not marked as able to call tools; the loop needs tool calls` });
      let probe: Awaited<ReturnType<typeof p.probe>>;
      try {
        probe = await p.probe(provider.id);
      } catch (e) {
        return fail(`cannot probe ${provider.id}: ${(e as Error).message}`);
      }
      if (!probe.reachable) return fail(`${provider.label || provider.id} is not reachable${probe.error ? `: ${probe.error.message}` : ""}`);
      if (probe.error) return fail(`${provider.id}: ${probe.error.message}`);
      if (!probe.chat) return fail(`${provider.id} answered the model list but not a chat request`);
      checks.push({ level: "info", message: `${provider.id} is reachable (${probe.models.length} models)` });
      if (!probe.tool_calls) checks.push({ level: "warn", message: `the probe model ${probe.model ?? ""} did not make a tool call` });
      return { ok: true, checks };
    },
    async start(opts: RunOptions): Promise<RunHandle> {
      return startLoop(deps, opts);
    },
  };
}

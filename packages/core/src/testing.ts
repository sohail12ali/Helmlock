// Test helper shared by every stream (owned by integration). Copies a fixture workspace to a temp dir
// and returns a runtime with the given plugin catalog.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PluginCatalog } from "./contracts/catalog.ts";
import type { VerbResult } from "./contracts/verbs.ts";
import { createRuntime, type Runtime, type RunVerbOptions } from "./runtime/runtime.ts";

/** Repo root of the delivery repo (helmlock). */
export const DELIVERY_ROOT = resolve(import.meta.dirname, "../../..");
export const FIXTURES = join(DELIVERY_ROOT, "test", "fixtures");

export interface TestWorkspace {
  root: string;
  runtime: Runtime;
  run(verb: string, input?: Record<string, unknown>, opts?: RunVerbOptions): Promise<VerbResult>;
  cleanup(): Promise<void>;
}

export async function createTestWorkspace(o: { catalog: PluginCatalog; fixture?: string; env?: Record<string, string> }): Promise<TestWorkspace> {
  const root = mkdtempSync(join(tmpdir(), "hl-test-"));
  cpSync(join(FIXTURES, o.fixture ?? "ws-min"), root, { recursive: true });
  const runtime = await createRuntime({
    cwd: root,
    env: { HL_DELIVERY: DELIVERY_ROOT, ...o.env },
    catalog: o.catalog,
  });
  return {
    root,
    runtime,
    run: (verb, input = {}, opts) => runtime.run(verb, input, opts),
    async cleanup() {
      await runtime.dispose();
      // Windows can hold a just-closed folder for a moment (EPERM/EBUSY): retry rather than fail the test.
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

// Settings page reads: the plugins this server loaded, the .env names (never values), and the engine re-test.
// Each tolerates an older server without the route (404 -> null) so the page still renders.
import type { EngineTestResult, MachineEnvView, ServerPluginsView } from "@helmlock/core/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get } from "./client";
import { post } from "./m4";

const missing = (e: unknown) => e instanceof ApiError && e.status === 404;

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

export const settingsKeys = {
  plugins: ["settings", "server-plugins"] as const,
  env: ["settings", "env"] as const,
};

export const useServerPlugins = (enabled = true) =>
  useQuery({
    queryKey: settingsKeys.plugins,
    queryFn: ({ signal }) => orNull(get<ServerPluginsView>("/server/plugins", undefined, signal)),
    enabled,
    retry: false,
  });

export const useMachineEnv = (enabled = true) =>
  useQuery({
    queryKey: settingsKeys.env,
    queryFn: ({ signal }) => orNull(get<MachineEnvView>("/settings/env", undefined, signal)),
    enabled,
    retry: false,
  });

/** Drop the cached engine tests and run them again; the crew view refreshes with the new results. */
export function useEngineTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<EngineTestResult>("/engines/test", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["crew"] }),
  });
}

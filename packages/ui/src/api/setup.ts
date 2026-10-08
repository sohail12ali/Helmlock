// Onboarding v2 client (Blueprint 34): detection, engine tests, "this is me" and silent upkeep for /welcome.
// Types only from core (contracts/api.ts).
import type { SetupDetect, SetupEngineTest, SetupEngineTestBody, SetupUpkeep, SetupYouBody, SetupYouResult } from "@helmlock/core/contracts";
import { useQuery } from "@tanstack/react-query";
import { get } from "./client";
import { post } from "./m4";

export const setupKeys = {
  detect: ["setup", "detect"] as const,
};

export const setupApi = {
  detect: (s?: AbortSignal) => get<SetupDetect>("/setup/detect", undefined, s),
  testEngine: (body: SetupEngineTestBody) => post<SetupEngineTest>("/setup/test-engine", body),
  you: (body: SetupYouBody) => post<SetupYouResult>("/setup/you", body),
  upkeep: () => post<SetupUpkeep>("/setup/upkeep", {}),
};

/** Under the "setup" root, so every write that refreshes the step list refreshes detection too. */
export const useSetupDetect = () => useQuery({ queryKey: setupKeys.detect, queryFn: ({ signal }) => setupApi.detect(signal), retry: false, staleTime: 30_000 });

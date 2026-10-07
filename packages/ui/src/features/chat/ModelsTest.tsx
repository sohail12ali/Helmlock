// Settings > Models: "Test connection" per provider (POST /models/test) and the ProbeResult it returns.
import type { ModelProbe } from "@helmlock/core/contracts";
import { CheckCircle2, XCircle } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "@/api/client";
import { useModels, useProbe } from "@/api/m4";
import { Mono } from "@/components/common";
import { Select } from "@/components/forms/controls";
import { Button } from "@/components/ui/button";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {ok ? <CheckCircle2 className="size-3.5 text-ok" aria-hidden /> : <XCircle className="size-3.5 text-destructive" aria-hidden />}
      {label} {ok ? "yes" : "no"}
    </span>
  );
}

/** What to check next for a probe error code. */
export function probeHint(code: string): string {
  switch (code) {
    case "network":
      return "Is the server running and reachable from this machine? Check the IP and port, and that LM Studio's server allows LAN access (Serve on Local Network).";
    case "timeout":
      return "The server did not answer in time. A local model may still be loading; try again in a moment.";
    case "auth":
      return "The server wants a key: set the environment variable named above for hl serve, then restart it.";
    case "bad_request":
      return "Check the base URL, the model name and the key variable name.";
    case "rate_limit":
      return "The server is rate limiting; wait a little and try again.";
    case "context_exceeded":
      return "The model's context is too small for the test prompt; load it with a larger context.";
    case "server":
      return "The server answered with an error; its log says why.";
    default:
      return "";
  }
}

export function ProbeError({ error }: { error: { code: string; message: string } }) {
  const hint = probeHint(error.code);
  return (
    <div className="flex flex-col gap-0.5 text-destructive" role="alert">
      <p>
        <Mono>{error.code}</Mono> {error.message}
      </p>
      {hint && <p className="text-ink2">{hint}</p>}
    </div>
  );
}

export function ProbeView({ r, steps = true }: { r: ModelProbe; steps?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-sunk p-2 text-xs" data-testid="probe-result" role="status">
      <p className="flex flex-wrap gap-3">
        <Check ok={r.reachable} label="reachable" />
        {steps && (
          <>
            <Check ok={r.chat} label="chat" />
            <Check ok={r.streaming} label="streaming" />
            <Check ok={r.tool_calls} label="tool calls" />
          </>
        )}
      </p>
      {steps && r.model && (
        <p className="text-muted-foreground">
          tested <Mono>{r.model}</Mono>
        </p>
      )}
      {r.models.length > 0 && (
        <p className="text-muted-foreground">
          {r.models.length} model{r.models.length === 1 ? "" : "s"}: <Mono>{r.models.slice(0, 6).join(", ")}</Mono>
          {r.models.length > 6 ? " …" : ""}
        </p>
      )}
      {r.error && <ProbeError error={r.error} />}
    </div>
  );
}

export function ModelsTest() {
  const id = useId();
  const models = useModels();
  const probe = useProbe();
  const providers = models.data?.providers ?? [];
  const [provider, setProvider] = useState<string>();
  const chosen = provider ?? providers[0]?.id;
  if (!providers.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-2.5 text-sm">
      <p className="font-medium">Test connection</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Provider
        </label>
        <Select id={id} value={chosen} onChange={(e) => setProvider(e.target.value)} className="w-auto max-w-xs">
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label || p.id}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="outline" disabled={!chosen || probe.isPending} onClick={() => chosen && probe.mutate(chosen)}>
          {probe.isPending ? "Testing" : "Test connection"}
        </Button>
        {models.data?.default && (
          <span className="text-xs text-muted-foreground">
            default model <Mono>{models.data.default}</Mono>
          </span>
        )}
      </div>
      {probe.data && <ProbeView r={probe.data} />}
      {probe.isError && (
        <p role="alert" className="text-xs text-destructive">
          {probe.error instanceof ApiError ? probe.error.message : "The test did not run."}
        </p>
      )}
    </div>
  );
}

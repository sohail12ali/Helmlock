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

export function ProbeView({ r }: { r: ModelProbe }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-sunk p-2 text-xs" data-testid="probe-result" role="status">
      <p className="flex flex-wrap gap-3">
        <Check ok={r.reachable} label="reachable" />
        <Check ok={r.chat} label="chat" />
        <Check ok={r.streaming} label="streaming" />
        <Check ok={r.tool_calls} label="tool calls" />
      </p>
      {r.models.length > 0 && (
        <p className="text-muted-foreground">
          {r.models.length} model{r.models.length === 1 ? "" : "s"}: <Mono>{r.models.slice(0, 6).join(", ")}</Mono>
          {r.models.length > 6 ? " …" : ""}
        </p>
      )}
      {r.error && (
        <p className="text-destructive">
          {r.error.message} <Mono>{r.error.code}</Mono>
        </p>
      )}
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

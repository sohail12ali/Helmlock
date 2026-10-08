// Save a secret (bot token, API key) on this machine through `secret set` (milestone 7). The value goes to the
// knowledge repo's gitignored .env; it is never shown again, and the field is cleared after saving. A badge says where
// the name is found now: this machine's .env, the environment, or missing (from `secret status`, names only).
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { callVerb } from "@/api/verbs";
import { INVALIDATE } from "@/api/write-hooks";
import { Mono } from "@/components/common";
import { Field } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SecretSource = "environment" | ".env" | "missing";

const SOURCE: Record<SecretSource, { label: string; variant: "ok" | "accent" | "warn" }> = {
  ".env": { label: "this machine's .env", variant: "ok" },
  environment: { label: "environment", variant: "accent" },
  missing: { label: "missing", variant: "warn" },
};

/** Where `name` is found (names only; the server never returns values). */
export function useSecretSource(name: string) {
  return useQuery({
    queryKey: ["secrets", name],
    enabled: name !== "",
    queryFn: async ({ signal }): Promise<SecretSource | undefined> => {
      const r = await callVerb("secret status", { names: [name] }, { signal });
      if (!r.ok || !Array.isArray(r.data)) return undefined;
      const row = (r.data as { name?: string; source?: string }[]).find((x) => x.name === name);
      return row?.source && row.source in SOURCE ? (row.source as SecretSource) : undefined;
    },
  });
}

export function SecretSourceBadge({ name }: { name: string }) {
  const q = useSecretSource(name);
  if (!q.data) return null;
  const s = SOURCE[q.data];
  return (
    <Badge variant={s.variant} title={`where ${name} is found on this machine`} data-testid="secret-source">
      {s.label}
    </Badge>
  );
}

/** A password field with "Save on this machine". `label` names what the secret is (e.g. "Bot token"). */
export function MachineSecret({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  const id = useId();
  const [value, setValue] = useState("");
  const save = useVerbRun("secret set", [...INVALIDATE.settings, "setup", "secrets"]);
  const valid = /^[A-Z][A-Z0-9_]*$/.test(name);

  return (
    <div className="flex flex-col gap-1.5">
      <Field
        label={label}
        htmlFor={id}
        hint={
          <>
            Saved only on this machine, in <Mono>.env</Mono>, which git ignores. Stored as <Mono>{name || "(no name)"}</Mono>; never shown again.
          </>
        }
      >
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim() || !valid) return;
            void save.run({ name, value }).then((r) => {
              if (r.ok) setValue("");
            });
          }}
        >
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="max-w-xs font-mono"
            value={value}
            placeholder={placeholder ?? "paste it here"}
            onChange={(e) => {
              setValue(e.target.value);
              if (save.last) save.clear();
            }}
          />
          <Button type="submit" size="sm" disabled={save.pending || !value.trim() || !valid}>
            Save on this machine
          </Button>
          <SecretSourceBadge name={name} />
        </form>
      </Field>
      {save.last && <VerbResult result={save.last.result} okText={`Saved ${name} on this machine.`} />}
    </div>
  );
}

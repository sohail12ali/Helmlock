// One plugin-declared setting (F44) as a settings row that saves itself through `config set`: switches and selects on
// change, text and numbers on blur or Enter (never per keystroke). Chips say where it is stored (shared workspace.toml
// or this machine's workspace.local.toml), whether it differs from the plugin default (with Reset to default, which
// is `config set --unset`), and when a change takes effect. A server refusal is shown on the row and the settings
// reload. Secrets are stored by env-var NAME only; the secret itself is pasted into MachineSecret below the row.
import type { PluginSettings, SettingApplies, SettingField } from "@helmlock/core/api";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { INVALIDATE } from "@/api/write-hooks";
import { Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { Chip, SettingRow, SettingSwitch } from "@/components/settings";
import { Input } from "@/components/ui/input";
import { MachineSecret } from "@/features/setup/MachineSecret";
import { cn } from "@/lib/utils";

type Current = PluginSettings["values"][string] | undefined;
type Source = PluginSettings["values"][string]["source"];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function toDraft(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(", ");
  return v === undefined || v === null ? "" : String(v);
}

/** A "list" setting is typed as comma-separated text and saved as an array (empty entries dropped). */
export function toList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** True when the value differs from the plugin's declared default (no default: anything non-empty). */
export function isChanged(field: SettingField, value: unknown): boolean {
  if (field.default === undefined) return !isEmpty(value);
  return toDraft(value) !== toDraft(field.default);
}

export const APPLIES: Record<SettingApplies, { label: string; tone: "ok" | "info" | "warn"; title: string }> = {
  live: { label: "live", tone: "ok", title: "Takes effect at once, also in this running console." },
  "next-run": { label: "next run", tone: "info", title: "Takes effect from the next agent run." },
  restart: { label: "restart needed", tone: "warn", title: "hl commands use it at once; restart hl serve for this console to use it." },
};

export function ScopeChip({ scope }: { scope: SettingField["scope"] }) {
  return scope === "local" ? (
    <Chip title="Stored in workspace.local.toml on this machine (gitignored)">this machine</Chip>
  ) : (
    <Chip title="Stored in workspace.toml, committed and shared with the team">shared</Chip>
  );
}

export function LockChip({ title }: { title: string }) {
  return (
    <Chip title={title}>
      <Lock aria-hidden /> read-only
    </Chip>
  );
}

function SourceChips({ field, source }: { field: SettingField; source: Source }) {
  if (field.scope === "workspace" && source === "workspace.local.toml")
    return (
      <Chip tone="info" title="This machine overrides the shared value in workspace.local.toml">
        local override
      </Chip>
    );
  if (source === "bundle") return <Chip title="The value comes from a bundle's plugin row">bundle</Chip>;
  if (source === "flags") return <Chip title="Set by a command-line flag of hl serve">flag</Chip>;
  return null;
}

const fmt = (v: unknown) => (isEmpty(v) ? "(empty)" : Array.isArray(v) ? v.join(", ") : String(v));

export function PluginSettingRow({
  plugin,
  field,
  current,
  models,
  chips,
  secretLabel,
}: {
  plugin: string;
  field: SettingField;
  current: Current;
  /** Configured model ids: a string setting named `model` or `*_model` becomes a picker. */
  models?: string[];
  /** Extra chips (for example fail-closed). */
  chips?: ReactNode;
  /** Label of the paste field for a secret-env setting. */
  secretLabel?: string;
}) {
  const uid = useId();
  const id = `${uid}-${field.key}`;
  const qc = useQueryClient();
  const value = current?.value ?? field.default ?? null;
  const source: Source = current?.source ?? "default";
  const [draft, setDraft] = useState(() => toDraft(value));
  // Follow the stored value when it changes (a save here or elsewhere).
  const [base, setBase] = useState(() => toDraft(value));
  // The draft last sent: blur after Enter (or a second blur) must not send it again before the reload lands.
  const [sent, setSent] = useState<string>();
  if (toDraft(value) !== base) {
    setBase(toDraft(value));
    setDraft(toDraft(value));
    setSent(undefined);
  }
  const [problem, setProblem] = useState<string>();
  const v = useVerbRun("config set", INVALIDATE.settings);
  const dirty = draft !== toDraft(value);
  const changed = isChanged(field, value);
  const canReset = changed && (source === "workspace.toml" || source === "workspace.local.toml");

  const send = async (input: Record<string, unknown>) => {
    const r = await v.run(input);
    if (!r.ok) {
      // The server said no: show why on the row and reload what is really stored.
      setSent(undefined);
      setDraft(toDraft(value));
      void qc.invalidateQueries({ queryKey: ["settings"] });
    }
  };
  const save = (next: unknown) => {
    setProblem(undefined);
    const input: Record<string, unknown> = { plugin, key: field.key, value: next };
    if (field.scope === "local") input.local = true;
    void send(input);
  };
  const reset = () => {
    setProblem(undefined);
    const input: Record<string, unknown> = { plugin, key: field.key, unset: true };
    if (source === "workspace.local.toml") input.local = true;
    void send(input);
  };
  const saveDraft = () => {
    if (!dirty || v.pending || draft === sent) return;
    setProblem(undefined);
    if (field.type === "number") {
      const n = Number(draft);
      if (draft.trim() === "" || !Number.isFinite(n)) return setProblem("enter a number");
      return save(n);
    }
    if (field.type === "list") return save(toList(draft));
    if (field.type === "secret-env" && draft.trim() !== "" && !ENV_NAME.test(draft.trim()))
      return setProblem("an environment variable name, such as OPENROUTER_API_KEY");
    save(draft.trim());
  };
  const saveDraftOnce = () => {
    const before = draft;
    saveDraft();
    setSent(before);
  };

  const modelPicker = field.type === "string" && models && (field.key === "model" || field.key.endsWith("_model"));
  let control: ReactNode;
  if (field.type === "boolean") {
    control = <SettingSwitch id={id} checked={value === true} disabled={v.pending} onCheckedChange={(b) => save(b)} aria-label={field.label} />;
  } else if (field.type === "select" || modelPicker) {
    const options = field.type === "select" ? (field.options ?? []) : (models ?? []);
    control = (
      <Select
        id={id}
        value={draft}
        disabled={v.pending}
        className="w-auto max-w-[16rem] min-w-[9rem]"
        onChange={(e) => {
          setDraft(e.target.value);
          save(e.target.value);
        }}
      >
        {modelPicker && <option value="">{field.key === "default_model" ? "(first configured model)" : "(the default model)"}</option>}
        {!options.includes(draft) && !(modelPicker && draft === "") && <option value={draft}>{draft || "(not set)"}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    );
  } else {
    control = (
      <Input
        id={id}
        className={cn(
          "h-8",
          field.type === "number" ? "w-28" : "w-full max-w-[16rem] min-w-[9rem]",
          (field.type === "secret-env" || field.type === "list") && "font-mono",
        )}
        type={field.type === "number" ? "number" : "text"}
        step={field.type === "number" ? "any" : undefined}
        value={draft}
        aria-invalid={!!problem || undefined}
        placeholder={field.type === "secret-env" ? "ENV_VAR_NAME" : field.type === "list" ? "one, two, three" : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          if (v.last) v.clear();
        }}
        onBlur={saveDraftOnce}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            saveDraftOnce();
          } else if (e.key === "Escape") {
            setDraft(toDraft(value));
            setProblem(undefined);
          }
        }}
      />
    );
  }

  const applies = APPLIES[field.applies ?? "live"];
  const status = v.pending ? (
    <span role="status" className="text-[11px] text-ink3">
      Saving…
    </span>
  ) : v.last?.result.ok ? (
    <span role="status" className="text-[11px] text-ok" title={v.last.result.text}>
      Saved
    </span>
  ) : null;

  return (
    <SettingRow
      data-setting={`${plugin}.${field.key}`}
      label={field.label}
      htmlFor={id}
      hint={
        <>
          {field.hint}
          {field.type === "secret-env" && <span className="block">Only the variable name is stored; save the secret itself on this machine below.</span>}
          {field.type === "list" && <span className="block">Separate entries with commas.</span>}
          {problem && (
            <span className="block text-destructive" role="alert">
              {problem}
            </span>
          )}
        </>
      }
      chips={
        <>
          <ScopeChip scope={field.scope} />
          <SourceChips field={field} source={source} />
          {changed && (
            <Chip tone="accent" title={`Differs from the plugin default: ${field.default === undefined ? "(none)" : fmt(field.default)}`}>
              changed
            </Chip>
          )}
          <Chip tone={applies.tone} title={applies.title}>
            {applies.label}
          </Chip>
          {chips}
        </>
      }
      control={
        <>
          {control}
          {status}
          {canReset && (
            <button
              type="button"
              disabled={v.pending}
              className="text-[11px] text-primary hover:underline disabled:opacity-50"
              aria-label={`Reset ${field.label} to default`}
              title={`Back to ${field.default === undefined ? "no value" : fmt(field.default)}`}
              onClick={reset}
            >
              Reset to default
            </button>
          )}
        </>
      }
      footer={
        (v.last && !v.last.result.ok) || (field.type === "secret-env" && typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value)) ? (
          <>
            {v.last && !v.last.result.ok && <VerbResult result={v.last.result} />}
            {field.type === "secret-env" && typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value) && (
              <MachineSecret name={value} label={secretLabel ?? `Value of ${value}`} />
            )}
          </>
        ) : undefined
      }
    />
  );
}

/** A setting someone cannot change from the console: the value, a lock chip and why. */
export function ReadOnlyRow({ label, hint, value, why, chips }: { label: ReactNode; hint?: ReactNode; value: ReactNode; why: string; chips?: ReactNode }) {
  return (
    <SettingRow
      label={label}
      hint={hint}
      chips={
        <>
          <LockChip title={why} />
          {chips}
        </>
      }
      control={<span className="min-w-0 text-[12.5px] break-all text-ink2">{value}</span>}
    />
  );
}

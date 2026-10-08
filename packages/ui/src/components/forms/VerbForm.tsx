// A form generated from a verb's inputs (F9c): one control per VerbField, Preview (dry run) and Submit through useVerb.
import type { VerbCallResult, VerbField, VerbInfo } from "@helmlock/core/api";
import { useId, useMemo, useState } from "react";
import { useVerb } from "@/api/verbs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { coerce, type Draft, emptyDraft, humanize, orderedFields } from "./coerce";
import { Field, Select, Switch, Textarea } from "./controls";
import { skippedReason, VerbResult } from "./VerbResult";

export interface VerbFormProps {
  verb: VerbInfo;
  /** Starting values by field key. */
  initial?: Record<string, unknown>;
  /** Values fixed by the caller (for example the ticket id on a ticket page); their fields are not shown. */
  fixed?: Record<string, unknown>;
  /** Query roots to refresh after a successful write. */
  invalidate?: readonly string[];
  submitLabel?: string;
  /** Hide the Preview button (verbs that do not write gain nothing from a dry run). */
  noPreview?: boolean;
  onDone?: (r: VerbCallResult) => void;
  className?: string;
}

function FieldControl({
  field,
  id,
  value,
  onChange,
  invalid,
}: {
  field: VerbField;
  id: string;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
  invalid: boolean;
}) {
  const common = { id, "aria-invalid": invalid || undefined, "aria-required": field.required || undefined };
  if (field.kind === "boolean") return <Switch {...common} checked={value === true} onCheckedChange={onChange} aria-label={humanize(field.key)} />;
  const text = typeof value === "string" ? value : "";
  if (field.choices && field.choices.length > 0)
    return (
      <Select {...common} value={text} onChange={(e) => onChange(e.target.value)}>
        {!field.required || text === "" ? <option value="">{field.required ? "Choose…" : "(default)"}</option> : null}
        {field.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    );
  if (field.kind === "array") return <Textarea {...common} rows={3} value={text} onChange={(e) => onChange(e.target.value)} placeholder="one per line" />;
  if (field.kind === "number")
    return <Input {...common} type="number" inputMode="decimal" step="any" value={text} onChange={(e) => onChange(e.target.value)} />;
  if (field.key === "text" || field.key === "body" || field.key === "message")
    return <Textarea {...common} rows={2} value={text} onChange={(e) => onChange(e.target.value)} />;
  return <Input {...common} value={text} onChange={(e) => onChange(e.target.value)} />;
}

export function VerbForm({ verb, initial, fixed, invalidate, submitLabel, noPreview, onDone, className }: VerbFormProps) {
  const uid = useId();
  const fields = useMemo(() => orderedFields(verb).filter((f) => !fixed || !(f.key in fixed)), [verb, fixed]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(fields, initial));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [last, setLast] = useState<{ result: VerbCallResult; preview: boolean }>();
  const m = useVerb(verb.id, invalidate);

  const run = async (dryRun: boolean) => {
    const c = coerce(fields, draft);
    setProblems(c.problems);
    if (Object.keys(c.problems).length > 0) {
      setLast(undefined);
      return;
    }
    let result: VerbCallResult;
    try {
      result = await m.mutateAsync({ input: { ...c.input, ...fixed }, dryRun });
    } catch {
      setLast(undefined); // m.isError shows the offline message
      return;
    }
    setLast({ result, preview: dryRun });
    if (!dryRun) {
      onDone?.(result);
      if (result.ok && !skippedReason(result)) setDraft(emptyDraft(fields, initial));
    }
  };

  return (
    <form
      noValidate
      aria-label={humanize(verb.id)}
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(e) => {
        e.preventDefault();
        void run(false);
      }}
    >
      {fields.length === 0 && <p className="text-sm text-muted-foreground">This action takes no input.</p>}
      {fields.map((f) => {
        const id = `${uid}-${f.key}`;
        const problem = problems[f.key];
        return (
          <Field
            key={f.key}
            label={humanize(f.key)}
            htmlFor={id}
            required={f.required}
            hint={
              problem ? (
                <span className="text-destructive" role="alert">
                  {humanize(f.key)}: {problem}
                </span>
              ) : (
                f.description
              )
            }
          >
            <FieldControl field={f} id={id} value={draft[f.key] ?? ""} invalid={!!problem} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          </Field>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={m.isPending}>
          {m.isPending ? "Working…" : (submitLabel ?? humanize(verb.id))}
        </Button>
        {!noPreview && verb.writes && (
          <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => void run(true)}>
            Preview
          </Button>
        )}
      </div>
      {m.isError && (
        <p role="alert" className="text-sm text-destructive">
          The console server is not reachable. Start it with <code className="font-mono">hl serve</code>.
        </p>
      )}
      <VerbResult result={last?.result} preview={last?.preview} />
    </form>
  );
}

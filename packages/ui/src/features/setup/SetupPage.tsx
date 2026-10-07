// First-run setup wizard (F1a after the writable console, F84, B25, mockup 08). The CLI already created the knowledge
// repo; this finishes the rest: author, a model, Telegram (optional), the first ticket, agents and trust.
// Progress comes from GET /setup (derived from the files), so leaving and coming back resumes where it stands.
import type { SetupStatus, VerbCallResult } from "@helmlock/core/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Circle } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { useWorkspace } from "@/api/hooks";
import { useModels, useProbe } from "@/api/m4";
import { addProvider, useSetup } from "@/api/m5";
import { INVALIDATE, useSettings } from "@/api/write-hooks";
import { openNewTicket } from "@/components/actions/NewTicket";
import { CopyCommand, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { Field, Select } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ModelsTest, ProbeView } from "@/features/chat/ModelsTest";
import { readPref, writePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { ENV_NAME, PRESETS, PROVIDER_ID, splitList } from "./presets";

type Step = SetupStatus["steps"][number];
const STEP_KEY = "setup.step";

/** The step to show first: the remembered one, else the first open step, else the last. */
export function startIndex(steps: Step[], remembered: string | undefined): number {
  const r = steps.findIndex((s) => s.id === remembered);
  if (r >= 0) return r;
  const open = steps.findIndex((s) => !s.done);
  return open >= 0 ? open : Math.max(0, steps.length - 1);
}

function Action({ action }: { action?: string }) {
  if (!action) return null;
  return /^(hl|claude|cursor|git|pnpm|npx)\b/.test(action.trim()) ? (
    <CopyCommand className="max-w-xl" command={action.trim()} />
  ) : (
    <p className="text-sm text-ink2">{action}</p>
  );
}

// ---------- model ----------

function ModelStep() {
  const uid = useId();
  const qc = useQueryClient();
  const models = useModels();
  const probe = useProbe();
  const [preset, setPreset] = useState(PRESETS[0]!.id);
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0]!;
  const [id, setId] = useState(p.id);
  const [baseUrl, setBaseUrl] = useState(p.base_url);
  const [keyEnv, setKeyEnv] = useState(p.key_env ?? "");
  const [model, setModel] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerbCallResult>();
  const [problem, setProblem] = useState<string>();

  const choose = (next: string) => {
    const n = PRESETS.find((x) => x.id === next) ?? PRESETS[0]!;
    // Keep what the person typed; follow the preset only where they kept the previous preset's value.
    if (id === p.id) setId(n.id === "custom" ? "" : n.id);
    if (baseUrl === p.base_url) setBaseUrl(n.base_url);
    if (keyEnv === (p.key_env ?? "")) setKeyEnv(n.key_env ?? "");
    setPreset(n.id);
  };

  const submit = async () => {
    setProblem(undefined);
    setResult(undefined);
    const pid = id.trim();
    if (!PROVIDER_ID.test(pid)) return setProblem("Provider id: letters, digits, dot, dash or underscore.");
    if (!/^https?:\/\//.test(baseUrl.trim())) return setProblem("Base URL must start with http:// or https://.");
    if (keyEnv.trim() && !ENV_NAME.test(keyEnv.trim()))
      return setProblem("Key: the NAME of an environment variable, such as OPENROUTER_API_KEY. The key itself stays in your environment.");
    if (!model.trim()) return setProblem("Model id is required, for example qwen3:14b.");
    setPending(true);
    try {
      const r = await addProvider({
        id: pid,
        preset,
        base_url: baseUrl.trim(),
        ...(keyEnv.trim() ? { key_env: keyEnv.trim() } : {}),
        model: model.trim(),
      });
      setResult(r);
      if (r.ok) {
        void qc.invalidateQueries({ queryKey: ["models"] });
        void qc.invalidateQueries({ queryKey: ["setup"] });
        void qc.invalidateQueries({ queryKey: ["settings"] });
        probe.mutate(pid);
      }
    } catch {
      setResult({ ok: false, code: 1, error: { rule: "offline", message: "The console server is not reachable.", fix: "start it with hl serve" } });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="grid grid-cols-2 gap-2 @2xl:grid-cols-4" aria-label="Provider preset">
        {PRESETS.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={preset === x.id}
            onClick={() => choose(x.id)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-md border bg-card px-3 py-2 text-left text-sm hover:border-primary/50",
              preset === x.id && "border-primary bg-accent",
            )}
          >
            <span className="font-medium">{x.label}</span>
            <span className="text-xs text-muted-foreground">{x.hint}</span>
          </button>
        ))}
      </fieldset>
      <form
        aria-label="Add a provider"
        className="grid grid-cols-1 gap-2 @2xl:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Preset" htmlFor={`${uid}-preset`}>
          <Select id={`${uid}-preset`} value={preset} onChange={(e) => choose(e.target.value)}>
            {PRESETS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider id" htmlFor={`${uid}-id`} required>
          <Input id={`${uid}-id`} className="font-mono" value={id} onChange={(e) => setId(e.target.value)} placeholder="ollama" />
        </Field>
        <Field label="Base URL" htmlFor={`${uid}-url`} required>
          <Input id={`${uid}-url`} className="font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434/v1" />
        </Field>
        <Field label="Key variable (name only)" htmlFor={`${uid}-key`} hint="The secret stays in your environment; only its variable name is saved.">
          <Input
            id={`${uid}-key`}
            className="font-mono"
            value={keyEnv}
            onChange={(e) => setKeyEnv(e.target.value)}
            placeholder={p.key_env ?? "none for local servers"}
          />
        </Field>
        <Field label="Model id" htmlFor={`${uid}-model`} required hint="As the server names it, for example qwen3:14b or openai/gpt-5-mini.">
          <Input id={`${uid}-model`} className="font-mono" value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" disabled={pending || probe.isPending}>
            {pending ? "Saving" : probe.isPending ? "Testing" : "Save and test connection"}
          </Button>
        </div>
      </form>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {result && !result.ok && <VerbResult result={result} />}
      {result?.ok && <p className="text-sm text-ok">Provider saved.</p>}
      {probe.data && <ProbeView r={probe.data} />}
      {probe.isError && (
        <p role="alert" className="text-sm text-destructive">
          The connection test did not run.
        </p>
      )}
      {(models.data?.providers.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            Already configured: <Mono>{models.data?.providers.map((x) => x.id).join(", ")}</Mono>
          </p>
          <ModelsTest />
        </div>
      )}
    </div>
  );
}

// ---------- telegram ----------

function TelegramStep() {
  const uid = useId();
  const settings = useSettings();
  const plugin = settings.data?.sections.flatMap((s) => s.plugins).find((p) => p.plugin === "telegram");
  const cur = (k: string) => plugin?.values[k]?.value;
  const curIds = cur("allowed_user_ids");
  const [tokenEnv, setTokenEnv] = useState<string>();
  const [ids, setIds] = useState<string>();
  const tokenDraft = tokenEnv ?? (typeof cur("token_env") === "string" ? (cur("token_env") as string) : "HL_TELEGRAM_TOKEN");
  const idsDraft = ids ?? (Array.isArray(curIds) ? curIds.join(", ") : typeof curIds === "string" ? curIds : "");
  const invalidate = [...INVALIDATE.settings, "setup"];
  const token = useVerbRun("config set", invalidate);
  const allow = useVerbRun("config set", invalidate);
  const [problem, setProblem] = useState<string>();

  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-ink2">
        <li>
          In Telegram, open a chat with <Mono>@BotFather</Mono> and send <Mono>/newbot</Mono>.
        </li>
        <li>Pick a name and a username ending in "bot". BotFather replies with a token.</li>
        <li>
          Put the token in an environment variable on this machine (for example <Mono>HL_TELEGRAM_TOKEN</Mono>), never in a file in the repo.
        </li>
        <li>
          Send any message to <Mono>@userinfobot</Mono> to learn your numeric user id, and allow it below.
        </li>
        <li>
          Restart <Mono>hl serve</Mono>; the bot starts when the variable is set. Everyone not allowed gets nothing.
        </li>
      </ol>
      <Field label="Bot token variable (name only)" htmlFor={`${uid}-tok`} hint="Stored in workspace.local.toml (this machine only).">
        <div className="flex flex-wrap gap-2">
          <Input id={`${uid}-tok`} className="max-w-xs font-mono" value={tokenDraft} onChange={(e) => setTokenEnv(e.target.value)} />
          <Button
            size="sm"
            disabled={token.pending}
            onClick={() => {
              setProblem(undefined);
              if (!ENV_NAME.test(tokenDraft.trim())) return setProblem("An environment variable name, such as HL_TELEGRAM_TOKEN.");
              void token.run({ plugin: "telegram", key: "token_env", value: tokenDraft.trim(), local: true });
            }}
          >
            Save variable
          </Button>
        </div>
      </Field>
      {token.last && <VerbResult result={token.last.result} okText="Saved." />}
      <Field label="Allowed Telegram user ids" htmlFor={`${uid}-ids`} hint="Comma-separated numeric ids. Empty means nobody (fail-closed).">
        <div className="flex flex-wrap gap-2">
          <Input
            id={`${uid}-ids`}
            className="max-w-xs font-mono"
            value={idsDraft}
            onChange={(e) => setIds(e.target.value)}
            placeholder="123456789, 987654321"
          />
          <Button
            size="sm"
            disabled={allow.pending}
            onClick={() => {
              setProblem(undefined);
              const list = splitList(idsDraft);
              if (list.some((x) => !/^\d+$/.test(x))) return setProblem("Telegram user ids are numbers.");
              void allow.run({ plugin: "telegram", key: "allowed_user_ids", value: list, local: true });
            }}
          >
            Save ids
          </Button>
        </div>
      </Field>
      {allow.last && <VerbResult result={allow.last.result} okText="Saved." />}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Telegram is optional. Skip it with Continue; it can be set later under Settings.</p>
    </div>
  );
}

// ---------- the rest ----------

function StepBody({ step }: { step: Step }) {
  const ws = useWorkspace();
  switch (step.id) {
    case "model":
      return <ModelStep />;
    case "telegram":
      return <TelegramStep />;
    case "first-ticket":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-ink2">Describe one piece of work. It starts in the first stage of the board.</p>
          <div>
            <Button onClick={openNewTicket}>New ticket</Button>
          </div>
        </div>
      );
    case "agents":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-ink2">
            Copy the system agents and skills into this knowledge repo so Claude Code and Cursor find them. Run it in a terminal at the repo root.
          </p>
          <CopyCommand className="max-w-xl" command="hl harness sync" />
        </div>
      );
    case "trust":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-ink2">
            Open Claude Code once in the knowledge repo and accept the folder trust prompt. Agent runs started from the console cannot answer that prompt for
            you.
          </p>
          <CopyCommand className="max-w-xl" label={ws.data?.root ? "in the repo root" : undefined} command="claude" />
        </div>
      );
    default:
      return null;
  }
}

function Stepper({ steps, index, onPick }: { steps: Step[]; index: number; onPick: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Setup steps">
      {steps.map((s, i) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onPick(i)}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm",
              i === index ? "border-primary bg-accent text-primary" : "text-ink2 hover:bg-accent",
            )}
          >
            {s.done ? <Check className="size-3.5 text-ok" aria-hidden /> : <Circle className="size-3 text-muted-foreground" aria-hidden />}
            {s.label}
            <span className="sr-only">{s.done ? " (done)" : " (open)"}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Wizard({ steps }: { steps: Step[] }) {
  const navigate = useNavigate();
  const [index, setIndexState] = useState(() => startIndex(steps, readPref(STEP_KEY, "")));
  const i = Math.min(index, steps.length - 1);
  const step = steps[i]!;
  const done = steps.filter((s) => s.done).length;
  const setIndex = (n: number) => {
    setIndexState(n);
    if (steps[n]) writePref(STEP_KEY, steps[n]!.id);
  };
  const last = i === steps.length - 1;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {done} of {steps.length} done
        </p>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-sunk"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
        >
          <span className="block h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${steps.length ? done / steps.length : 0})` }} />
        </div>
        <Stepper steps={steps} index={i} onPick={setIndex} />
      </div>
      <Card role="region" aria-label={`Step: ${step.label}`}>
        <CardHeader>
          <CardTitle>{step.label}</CardTitle>
          <Badge variant={step.done ? "ok" : step.id === "telegram" ? "default" : "warn"}>
            {step.done ? "done" : step.id === "telegram" ? "optional" : "to do"}
          </Badge>
        </CardHeader>
        <CardContent className="@container flex flex-col gap-3">
          {step.detail && <p className="text-sm text-ink2">{step.detail}</p>}
          <StepBody step={step} />
          {!["agents", "trust"].includes(step.id) && <Action action={step.action} />}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => navigate("/")}>
          Save and exit
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" disabled={i === 0} onClick={() => setIndex(i - 1)}>
          Back
        </Button>
        <Button
          onClick={() => {
            if (last) {
              writePref(STEP_KEY, "");
              navigate("/");
            } else setIndex(i + 1);
          }}
        >
          {last ? "Finish" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

export function SetupPage() {
  const q = useSetup();
  return (
    <PageLayout id="setup">
      <PageHeader title="Finish setup">
        <span className="text-xs text-muted-foreground">Resumes where you left off</span>
      </PageHeader>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data ? (
        <div className="flex max-w-xl flex-col gap-2 text-sm">
          <p>This console server has no setup checklist yet. The same checks run in the terminal:</p>
          <CopyCommand command="hl doctor" />
        </div>
      ) : q.data.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to set up.</p>
      ) : (
        <Wizard steps={q.data.steps} />
      )}
    </PageLayout>
  );
}

// Settings (F9a sections, F9b layers, F9c/F44 forms from plugin manifests). Each field saves through `config set`;
// shared fields go to workspace.toml (committed), local ones to workspace.local.toml. Secrets are stored by env-var name
// only; the secret itself can be saved on this machine (the gitignored .env) next to its name, through `secret set`.
import type { PluginSettings, SettingField, SettingsView } from "@helmlock/core/api";
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { useWorkspace } from "@/api/hooks";
import { INVALIDATE, useSettings } from "@/api/write-hooks";
import { CopyCommand, ErrorState, Loading, Mono, PageHeader } from "@/components/common";
import { Field, Select, Switch } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { PageLayout } from "@/components/layout/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ModelsTest } from "@/features/chat/ModelsTest";
import { OverridesSection } from "@/features/people/OverridesSection";
import { MachineSecret } from "@/features/setup/MachineSecret";
import { ProviderForm } from "@/features/setup/ProviderForm";
import { ProvidersList } from "@/features/setup/ProvidersList";
import { type ThemePref, useTheme } from "@/lib/theme";

type SectionId = SettingsView["sections"][number]["id"];
type Source = PluginSettings["values"][string]["source"];

/** What an empty section is waiting for. */
const COMING: Record<SectionId, string> = {
  workspace: "No plugin declares workspace settings yet.",
  models: "The provider layer arrives with the assistant. Providers and models will be set here.",
  agents: "Agent and backend choices arrive with agent runs from the console.",
  permissions: "Approval rules arrive with the approval gate in the console.",
  telegram: "The telegram plugin is not enabled in this workspace.",
};

const SOURCE_LABEL: Record<Source, string> = {
  default: "default",
  bundle: "bundle",
  "workspace.toml": "workspace.toml",
  "workspace.local.toml": "workspace.local.toml",
  flags: "flags",
};

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Settings > Models: the saved providers and their models (default, add, remove), the connection test, and add a
 *  provider (try before save). */
function ModelsSection() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <ProvidersList />
      <ModelsTest />
      {adding ? (
        <div className="@container flex flex-col gap-2 rounded-md border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm font-medium">Add provider</p>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Close
            </Button>
          </div>
          <ProviderForm />
        </div>
      ) : (
        <div>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add provider
          </Button>
        </div>
      )}
    </div>
  );
}

function toDraft(v: unknown): string {
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

function SettingRow({ plugin, field, current }: { plugin: string; field: SettingField; current: { value: unknown; source: Source } | undefined }) {
  const uid = useId();
  const id = `${uid}-${field.key}`;
  const value = current?.value ?? field.default;
  const [draft, setDraft] = useState(() => toDraft(value));
  // Follow the stored value when it changes (a save here or elsewhere), keeping the last result on screen.
  const [base, setBase] = useState(() => toDraft(value));
  if (toDraft(value) !== base) {
    setBase(toDraft(value));
    setDraft(toDraft(value));
  }
  const [problem, setProblem] = useState<string>();
  const v = useVerbRun("config set", INVALIDATE.settings);
  const local = field.scope === "local";
  const dirty = draft !== toDraft(value);

  const save = async (next: unknown) => {
    const input: Record<string, unknown> = { plugin, key: field.key, value: next };
    if (local) input.local = true;
    await v.run(input);
  };
  const saveDraft = () => {
    setProblem(undefined);
    if (field.type === "number") {
      const n = Number(draft);
      if (draft.trim() === "" || !Number.isFinite(n)) return setProblem("enter a number");
      return void save(n);
    }
    if (field.type === "list") return void save(toList(draft));
    if (field.type === "secret-env" && draft.trim() !== "" && !ENV_NAME.test(draft.trim()))
      return setProblem("an environment variable name, such as OPENROUTER_API_KEY");
    void save(draft.trim());
  };

  const source = current?.source ?? "default";
  const meta = (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant={source === "default" || source === "bundle" ? "outline" : "accent"} title="where the current value comes from">
        {SOURCE_LABEL[source]}
      </Badge>
      <span className="text-xs text-muted-foreground">{local ? "this machine only (workspace.local.toml)" : "shared with the team (workspace.toml)"}</span>
    </span>
  );

  let control: ReactNode;
  if (field.type === "boolean") {
    control = <Switch id={id} checked={value === true} disabled={v.pending} onCheckedChange={(b) => void save(b)} aria-label={field.label} />;
  } else if (field.type === "select") {
    control = (
      <Select id={id} value={draft} onChange={(e) => setDraft(e.target.value)} className="max-w-xs">
        {!field.options?.includes(draft) && <option value={draft}>{draft || "(not set)"}</option>}
        {field.options?.map((o) => (
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
        className={field.type === "secret-env" ? "max-w-xs font-mono" : "max-w-xs"}
        type={field.type === "number" ? "number" : "text"}
        step={field.type === "number" ? "any" : undefined}
        value={draft}
        aria-invalid={!!problem || undefined}
        placeholder={field.type === "secret-env" ? "ENV_VAR_NAME" : field.type === "list" ? "one, two, three" : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && dirty) {
            e.preventDefault();
            saveDraft();
          }
        }}
      />
    );
  }

  return (
    <li className="flex flex-col gap-1.5 py-3" data-setting={`${plugin}.${field.key}`}>
      <Field
        label={field.label}
        htmlFor={id}
        hint={
          <>
            {field.hint && <span className="block">{field.hint}</span>}
            {field.type === "secret-env" && (
              <span className="block">Only the variable name is saved here. Save the secret itself on this machine below, or set it in your environment.</span>
            )}
            {field.type === "list" && <span className="block">Separate entries with commas.</span>}
            {problem && (
              <span className="block text-destructive" role="alert">
                {problem}
              </span>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {control}
          {field.type !== "boolean" && dirty && (
            <>
              <Button size="sm" disabled={v.pending} onClick={saveDraft} aria-label={`Save ${field.label}`}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(toDraft(value));
                  setProblem(undefined);
                }}
              >
                Undo
              </Button>
            </>
          )}
        </div>
      </Field>
      {meta}
      {v.last && <VerbResult result={v.last.result} okText="Saved." />}
      {field.type === "secret-env" && typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value) && (
        <MachineSecret name={value} label={plugin === "telegram" ? "Bot token" : `Value of ${value}`} />
      )}
    </li>
  );
}

function PluginCard({ p }: { p: PluginSettings }) {
  return (
    <div className="rounded-md border px-3">
      <p className="flex items-baseline gap-2 pt-2.5 text-sm font-medium">
        {p.label} <Mono className="text-xs text-muted-foreground">{p.plugin}</Mono>
      </p>
      {p.fields.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No settings.</p>
      ) : (
        <ul className="divide-y">
          {p.fields.map((f) => (
            <SettingRow key={f.key} plugin={p.plugin} field={f} current={p.values[f.key]} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Appearance() {
  const { pref, setPref } = useTheme();
  const resetLayout = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("hl.layout.") || k.startsWith("hl.tickets.")) localStorage.removeItem(k);
    } catch {
      /* storage blocked */
    }
    location.reload();
  };
  return (
    <Card id="appearance">
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="mb-1.5 text-muted-foreground">Theme (stored in this browser only)</legend>
          {(["system", "light", "dark"] as ThemePref[]).map((p) => (
            <Button key={p} size="sm" variant={pref === p ? "secondary" : "outline"} aria-pressed={pref === p} onClick={() => setPref(p)}>
              {p === "system" ? "Follow system" : p === "light" ? "Light" : "Dark"}
            </Button>
          ))}
        </fieldset>
        <div>
          <Button size="sm" variant="outline" onClick={resetLayout}>
            Reset panel sizes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceFacts() {
  const ws = useWorkspace();
  if (ws.isError) return <ErrorState error={ws.error} />;
  if (!ws.data) return <Loading />;
  return (
    <div className="text-sm">
      <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{ws.data.name}</dd>
        <dt className="text-muted-foreground">Author</dt>
        <dd>{ws.data.author ? `${ws.data.author.name} (${ws.data.author.id})` : "not set"}</dd>
        <dt className="text-muted-foreground">Root</dt>
        <dd className="break-all font-mono text-xs">{ws.data.root}</dd>
        <dt className="text-muted-foreground">Delivery</dt>
        <dd className="break-all font-mono text-xs">{ws.data.delivery}</dd>
        <dt className="text-muted-foreground">Folders</dt>
        <dd className="flex flex-col gap-0.5">
          {ws.data.folders.map((f) => (
            <span key={f.path}>
              <Mono>{f.name}</Mono> <Badge variant="outline">{f.layer}</Badge>
            </span>
          ))}
        </dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd>
          <Mono>
            helmlock {ws.data.version.helmlock} · api v{ws.data.version.api}
          </Mono>
        </dd>
      </dl>
      <CopyCommand className="mt-3 max-w-md" label="Resolved paths" command="hl where" />
    </div>
  );
}

export function SettingsPage() {
  const q = useSettings();
  const sections = q.data?.sections ?? [];
  return (
    <PageLayout id="settings">
      <PageHeader title="Settings">
        <Link to="/actions" className="text-xs text-primary hover:underline">
          All actions
        </Link>
      </PageHeader>
      <div className="grid w-full gap-3">
        {sections.length > 0 && (
          <nav aria-label="Settings sections" className="flex flex-wrap gap-1.5 text-xs">
            {sections.map((s) => (
              <a key={s.id} href={`#settings-${s.id}`} className="rounded-full border px-2.5 py-0.5 text-ink2 hover:bg-accent">
                {s.label}
              </a>
            ))}
            <a href="#settings-overrides" className="rounded-full border px-2.5 py-0.5 text-ink2 hover:bg-accent">
              Your agents and skills
            </a>
            <a href="#appearance" className="rounded-full border px-2.5 py-0.5 text-ink2 hover:bg-accent">
              Appearance
            </a>
          </nav>
        )}
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          sections.map((s) => (
            <Card key={s.id} id={`settings-${s.id}`} aria-labelledby={`settings-${s.id}-title`}>
              <CardHeader>
                <CardTitle id={`settings-${s.id}-title`}>{s.label}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {s.id === "workspace" && <WorkspaceFacts />}
                {s.id === "models" && <ModelsSection />}
                {s.plugins.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{COMING[s.id]}</p>
                ) : (
                  s.plugins.map((p) => <PluginCard key={p.plugin} p={p} />)
                )}
              </CardContent>
            </Card>
          ))
        )}
        {q.isError && (
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
            </CardHeader>
            <CardContent>
              <WorkspaceFacts />
            </CardContent>
          </Card>
        )}
        <Card id="settings-overrides" aria-labelledby="settings-overrides-title">
          <CardHeader>
            <CardTitle id="settings-overrides-title">Your agents and skills</CardTitle>
          </CardHeader>
          <CardContent>
            <OverridesSection />
          </CardContent>
        </Card>
        <Appearance />
      </div>
    </PageLayout>
  );
}

// The Settings page panels (control-center style). Plugin-declared settings are placed by subject: Models (default
// model, providers), Assistant (per-role models), Agents (engines and runtime settings), Permissions, Telegram, Work
// log, Workspace; the rest are facts read from the server (This machine, Loaded on the server). Every panel folds and
// remembers; help sits behind the ⓘ button.
import type { PluginSettings, SettingField, SettingsView } from "@helmlock/core/api";
import { useQuery } from "@tanstack/react-query";
import { Bot, Clock, Cpu, FolderTree, Laptop, MessageSquare, Palette, Send, Server, ShieldCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useWorkspace } from "@/api/hooks";
import { useModels } from "@/api/m4";
import { useSetup } from "@/api/m5";
import { useCrew } from "@/api/m8";
import { useEngineTest, useMachineEnv, useServerPlugins } from "@/api/settings";
import { callVerb } from "@/api/verbs";
import { CopyCommand, ErrorState, Loading, Mono } from "@/components/common";
import { Chip, Panel, PanelGroup, SettingRow, SettingRows } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { ModelsTest } from "@/features/chat/ModelsTest";
import { ProviderForm } from "@/features/setup/ProviderForm";
import { ProvidersList } from "@/features/setup/ProvidersList";
import { type ThemePref, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { PluginSettingRow, ReadOnlyRow } from "./PluginSettingRow";

type SectionId = SettingsView["sections"][number]["id"];

/** Settings query state handed to the panels that show plugin settings. */
export interface SettingsData {
  view: SettingsView | undefined;
  pending: boolean;
  error: unknown;
}

/** Every (plugin, field) pair in a section, optionally filtered. */
function fieldsOf(view: SettingsView | undefined, section: SectionId | undefined, keep: (p: PluginSettings, f: SettingField) => boolean = () => true) {
  const out: { p: PluginSettings; f: SettingField }[] = [];
  for (const s of view?.sections ?? []) {
    if (section && s.id !== section) continue;
    for (const p of s.plugins) for (const f of p.fields) if (keep(p, f)) out.push({ p, f });
  }
  return out;
}

/** The plugin rows that declare settings in a section (for "not enabled" notes). */
const pluginsIn = (view: SettingsView | undefined, section: SectionId) => view?.sections.find((s) => s.id === section)?.plugins ?? [];

function Muted({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[12px] text-ink3">{children}</p>;
}

function SettingsState({ data, children }: { data: SettingsData; children: ReactNode }) {
  if (data.pending) return <Loading />;
  if (data.error) return <ErrorState error={data.error} />;
  return <>{children}</>;
}

function Rows({
  items,
  models,
  extra,
}: {
  items: { p: PluginSettings; f: SettingField }[];
  models?: string[];
  extra?: (p: PluginSettings, f: SettingField) => ReactNode;
}) {
  return (
    <SettingRows>
      {items.map(({ p, f }) => (
        <PluginSettingRow key={`${p.plugin}.${f.key}`} plugin={p.plugin} field={f} current={p.values[f.key]} models={models} chips={extra?.(p, f)} />
      ))}
    </SettingRows>
  );
}

const ASSISTANT_ROLES = new Set(["assistant_model", "summariser_model", "titles_model", "refiner_model"]);
const isAssistantRole = (p: PluginSettings, f: SettingField) => p.plugin === "providers" && ASSISTANT_ROLES.has(f.key);
const isWorkLog = (p: PluginSettings) => p.plugin === "work-log";

function useModelIds(): string[] | undefined {
  const q = useModels();
  return q.data?.models.map((m) => m.id);
}

// ---------- Appearance ----------

const SWATCH: Record<ThemePref, { label: string; cells: string[] }> = {
  system: { label: "Follow system", cells: ["#f6f7f9", "#121214", "#2563eb", "#4d9bea"] },
  light: { label: "Light", cells: ["#f6f7f9", "#ffffff", "#2563eb", "#16181d"] },
  dark: { label: "Dark", cells: ["#121214", "#1b1b1f", "#4d9bea", "#e8e9ed"] },
};

export function AppearancePanel() {
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
    <Panel
      id="settings-appearance"
      title="Appearance"
      icon={<Palette />}
      defaultOpen
      help={<>How this console looks. Stored in this browser only (localStorage), never in the knowledge repo.</>}
    >
      <SettingRows>
        <SettingRow
          label="Theme"
          hint="A light and a dark palette; Follow system tracks your OS setting."
          chips={<Chip title="Stored in this browser only">this browser</Chip>}
          wide
          control={
            <fieldset aria-label="Theme" className="flex flex-wrap gap-[7px]">
              {(["system", "light", "dark"] as ThemePref[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={pref === p}
                  aria-label={SWATCH[p].label}
                  title={SWATCH[p].label}
                  onClick={() => setPref(p)}
                  className="flex flex-col items-center gap-1 text-[11px] text-ink2"
                >
                  <span
                    className={cn(
                      "grid size-11 grid-cols-2 gap-0.5 rounded-lg border-2 bg-card p-[3px]",
                      pref === p ? "border-primary ring-2 ring-primary/25" : "border-border",
                    )}
                  >
                    {SWATCH[p].cells.map((c, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: four fixed cells
                      <i key={i} className="block rounded-[2px]" style={{ background: c }} />
                    ))}
                  </span>
                  {SWATCH[p].label}
                </button>
              ))}
            </fieldset>
          }
        />
        <SettingRow
          label="Panel sizes"
          hint="Put every resizable split and the ticket list columns back to their defaults."
          chips={<Chip title="Stored in this browser only">this browser</Chip>}
          control={
            <Button size="sm" variant="outline" onClick={resetLayout}>
              Reset panel sizes
            </Button>
          }
        />
      </SettingRows>
    </Panel>
  );
}

// ---------- Models ----------

export function ModelsPanel({ data }: { data: SettingsData }) {
  const [adding, setAdding] = useState(false);
  const models = useModelIds();
  const items = fieldsOf(data.view, "models", (p, f) => !isAssistantRole(p, f));
  return (
    <Panel
      id="settings-models"
      title="Models"
      icon={<Cpu />}
      className="@[620px]:col-span-2"
      help={
        <>
          Model providers (an OpenAI-compatible server each) and the default model. Providers and models are stored in the <Mono>providers</Mono> row of{" "}
          <Mono>workspace.toml</Mono>; API keys only by variable name, the key itself in this machine's <Mono>.env</Mono>.
        </>
      }
    >
      <SettingsState data={data}>
        {items.length > 0 ? <Rows items={items} models={models} /> : <Muted>The providers plugin is not enabled in this workspace.</Muted>}
      </SettingsState>
      <PanelGroup title="Providers">
        <div className="@container flex flex-col gap-2.5">
          <ProvidersList />
          {adding ? (
            <div className="@container flex flex-col gap-2 rounded-md border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-[12.8px] font-semibold">Add provider</p>
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
      </PanelGroup>
      <PanelGroup title="Connection test">
        <ModelsTest />
      </PanelGroup>
    </Panel>
  );
}

// ---------- Assistant ----------

export function AssistantPanel({ data }: { data: SettingsData }) {
  const models = useModelIds();
  const items = fieldsOf(data.view, "models", isAssistantRole);
  return (
    <Panel
      id="settings-assistant"
      title="Assistant"
      icon={<MessageSquare />}
      help={
        <>
          Which model does each assistant job: the console and Telegram chat, summaries, chat titles and cleaning up dictated text. Empty means the default
          model. Stored in the <Mono>providers</Mono> row of <Mono>workspace.toml</Mono>.
        </>
      }
    >
      <SettingsState data={data}>
        {items.length > 0 ? <Rows items={items} models={models} /> : <Muted>The providers plugin is not enabled in this workspace.</Muted>}
      </SettingsState>
    </Panel>
  );
}

// ---------- Agents ----------

function EnginesGroup() {
  const crew = useCrew();
  const test = useEngineTest();
  const engines = test.data ?? crew.data?.engines;
  const missingCrew = crew.isError;
  return (
    <PanelGroup title="Agent engines">
      {crew.isPending ? (
        <Loading />
      ) : missingCrew || !engines ? (
        <Muted>The crew plugin is not enabled here, so the engines are not listed. Agent CLIs are still found by hl run.</Muted>
      ) : (
        <SettingRows>
          {engines.length === 0 && <Muted>No engine is registered.</Muted>}
          {engines.map((e) => (
            <SettingRow
              key={e.id}
              data-engine={e.id}
              label={e.label}
              hint={
                <>
                  <Mono>{e.id}</Mono>
                  {e.test.checks.map((c) => (
                    <span key={c.message} className={cn("block", c.level === "error" ? "text-destructive" : c.level === "warn" ? "text-warn" : undefined)}>
                      {c.message}
                    </span>
                  ))}
                </>
              }
              chips={e.test.ok ? <Chip tone="ok">found</Chip> : <Chip tone="warn">not found</Chip>}
            />
          ))}
        </SettingRows>
      )}
      {!missingCrew && engines && (
        <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? "Testing…" : "Test engines"}
          </Button>
          {test.isError && <span className="text-[11.8px] text-destructive">{(test.error as Error).message}</span>}
          {test.isSuccess && (
            <span role="status" className="text-[11.8px] text-ok">
              Tested just now
            </span>
          )}
        </div>
      )}
      {crew.data && (
        <ReadOnlyRow
          label="Live runs at once"
          hint={
            <>
              Runs past this wait in the queue. Set <Mono>max_live</Mono> in the <Mono>runtimes</Mono> row of <Mono>workspace.toml</Mono>.
            </>
          }
          value={String(crew.data.max_live)}
          why="Not declared as a console setting yet: edit workspace.toml"
        />
      )}
    </PanelGroup>
  );
}

export function AgentsPanel({ data }: { data: SettingsData }) {
  const items = fieldsOf(data.view, "agents", (p) => !isWorkLog(p));
  return (
    <Panel
      id="settings-agents"
      title="Agents"
      icon={<Bot />}
      className="@[620px]:col-span-2"
      help={
        <>
          The agent CLIs (Claude Code, Cursor) and the Helmlock model loop that runs roles, and how runs behave. Shared choices are stored in{" "}
          <Mono>workspace.toml</Mono>; binary paths are per machine in <Mono>workspace.local.toml</Mono>. Roles are set on the Crew page.
        </>
      }
    >
      <EnginesGroup />
      <PanelGroup title="Runtime settings">
        <SettingsState data={data}>{items.length > 0 ? <Rows items={items} /> : <Muted>No runtime plugin declares settings here.</Muted>}</SettingsState>
      </PanelGroup>
    </Panel>
  );
}

// ---------- Permissions ----------

export function PermissionsPanel({ data }: { data: SettingsData }) {
  const items = fieldsOf(data.view, "permissions");
  return (
    <Panel
      id="settings-permissions"
      title="Permissions"
      icon={<ShieldCheck />}
      help={
        <>
          How agent runs are kept inside the workspace: approval cards and protected state files. Stored in <Mono>workspace.toml</Mono> (shared). An unanswered
          approval is denied (fail-closed).
        </>
      }
    >
      <SettingsState data={data}>{items.length > 0 ? <Rows items={items} /> : <Muted>No plugin declares permission settings here.</Muted>}</SettingsState>
    </Panel>
  );
}

// ---------- Telegram ----------

export function TelegramPanel({ data }: { data: SettingsData }) {
  const setup = useSetup();
  const step = setup.data?.steps.find((s) => s.id === "phone");
  const plugins = pluginsIn(data.view, "telegram");
  const items = fieldsOf(data.view, "telegram");
  const enabled = plugins.some((p) => p.plugin === "telegram");
  return (
    <Panel
      id="settings-telegram"
      title="Telegram"
      icon={<Send />}
      headExtra={
        step && enabled ? (
          step.done ? (
            <Chip tone="ok" title={step.detail}>
              ready
            </Chip>
          ) : (
            <Chip tone="warn" title={step.detail}>
              not ready
            </Chip>
          )
        ) : undefined
      }
      help={
        <>
          Reach the assistant from your phone. The bot runs inside <Mono>hl serve</Mono> and long-polls, so it needs no public address. Every setting is per
          machine (<Mono>workspace.local.toml</Mono>); the bot token is saved in this machine's <Mono>.env</Mono> by name. Only the allowed user ids get
          answers; an empty list means nobody.
        </>
      }
    >
      <SettingsState data={data}>
        {!enabled ? (
          <Muted>The telegram plugin is not enabled in this workspace.</Muted>
        ) : (
          <>
            {step && <p className="px-1 text-[11.8px] text-ink2">{step.detail}</p>}
            <SettingRows>
              {items.map(({ p, f }) => {
                const v = p.values[f.key]?.value;
                const empty = f.key === "allowed_user_ids" && (!Array.isArray(v) || v.length === 0);
                return (
                  <PluginSettingRow
                    key={`${p.plugin}.${f.key}`}
                    plugin={p.plugin}
                    field={f}
                    current={p.values[f.key]}
                    secretLabel={p.plugin === "telegram" ? "Bot token" : undefined}
                    chips={
                      empty ? (
                        <Chip tone="warn" title="Nobody is allowed, so the bot answers nobody and does not start">
                          fail-closed
                        </Chip>
                      ) : undefined
                    }
                  />
                );
              })}
            </SettingRows>
          </>
        )}
      </SettingsState>
    </Panel>
  );
}

// ---------- Work log ----------

export function WorkLogPanel({ data }: { data: SettingsData }) {
  const items = fieldsOf(data.view, undefined, (p) => isWorkLog(p));
  if (!items.length) return null;
  return (
    <Panel
      id="settings-worklog"
      title="Work log"
      icon={<Clock />}
      help={
        <>
          How the daily work log (one TOML file per person per day) spreads hours. Stored in the <Mono>work-log</Mono> row of <Mono>workspace.toml</Mono>.
        </>
      }
    >
      <Rows items={items} />
    </Panel>
  );
}

// ---------- This machine ----------

interface SecretRow {
  name: string;
  source: "environment" | ".env" | "missing";
  used_by?: string;
}

/** Mounted only while its panel is open, so these reads run on demand. */
function EnvFooter() {
  const env = useMachineEnv();
  const status = useQuery({
    queryKey: ["secrets", "all"],
    retry: false,
    queryFn: async ({ signal }) => {
      const r = await callVerb("secret status", {}, { signal });
      return r.ok && Array.isArray(r.data) ? (r.data as SecretRow[]) : [];
    },
  });
  return (
    <div data-testid="env-footer" className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-sunk/40 px-2.5 py-2">
      <p className="text-[12px] font-semibold">Machine secrets file</p>
      {env.data ? (
        <>
          <code className="rounded border bg-sunk px-1.5 py-1 font-mono text-[11.5px] break-all select-all">{env.data.file}</code>
          <p className="text-[11.8px] text-ink3">
            {env.data.exists ? "Gitignored; names it defines (values are never shown):" : "Not created yet. Saving a secret here creates it (gitignored)."}
          </p>
          {env.data.names.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {env.data.names.map((n) => (
                <Chip key={n} className="font-mono">
                  {n}
                </Chip>
              ))}
            </div>
          )}
        </>
      ) : env.isPending ? (
        <Loading />
      ) : (
        <p className="text-[11.8px] text-ink3">
          The knowledge repo's <Mono>.env</Mono> (gitignored).
        </p>
      )}
      {status.data && status.data.length > 0 && (
        <div className="flex flex-col">
          <p className="pt-1 text-[11.5px] font-bold text-ink2">Secrets this workspace refers to</p>
          {status.data.map((s) => (
            <div key={s.name} className="flex flex-wrap items-center gap-1.5 py-0.5 text-[11.8px]">
              <Mono>{s.name}</Mono>
              <Chip tone={s.source === "missing" ? "warn" : s.source === ".env" ? "ok" : "info"}>{s.source === ".env" ? "this machine's .env" : s.source}</Chip>
              {s.used_by && <span className="text-ink3">{s.used_by}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MachinePanel() {
  const ws = useWorkspace();
  return (
    <Panel
      id="settings-machine"
      title="This machine"
      icon={<Laptop />}
      help={
        <>
          Who you are here and where things are on this computer. The author comes from <Mono>author.local</Mono> and the roster (never guessed); per-machine
          settings live in <Mono>workspace.local.toml</Mono> and secrets in the knowledge repo's gitignored <Mono>.env</Mono>.
        </>
      }
    >
      {ws.isError ? (
        <ErrorState error={ws.error} />
      ) : !ws.data ? (
        <Loading />
      ) : (
        <SettingRows>
          <ReadOnlyRow
            label="Author"
            value={ws.data.author ? `${ws.data.author.name} (${ws.data.author.id})` : "not set"}
            why="Set with hl people claim (writes author.local) in a terminal"
          />
          <ReadOnlyRow label="Knowledge repo" value={<Mono>{ws.data.root}</Mono>} why="Chosen when hl starts (the .code-workspace or .env)" />
          <ReadOnlyRow label="Delivery repo" value={<Mono>{ws.data.delivery}</Mono>} why="Chosen when hl starts" />
        </SettingRows>
      )}
      <CopyCommand className="max-w-md" label="Resolved paths" command="hl where" />
      <EnvFooter />
    </Panel>
  );
}

// ---------- Workspace ----------

export function WorkspacePanel({ data }: { data: SettingsData }) {
  const ws = useWorkspace();
  const items = fieldsOf(data.view, "workspace", (p) => !isWorkLog(p));
  return (
    <Panel
      id="settings-workspace"
      title="Workspace"
      icon={<FolderTree />}
      help={
        <>
          This knowledge center: its name, the folders its <Mono>.code-workspace</Mono> opens and the layer each one is. Only <Mono>hl init</Mono> and{" "}
          <Mono>hl project add</Mono> change the folders; shared settings are in <Mono>workspace.toml</Mono>.
        </>
      }
    >
      {ws.isError ? (
        <ErrorState error={ws.error} />
      ) : !ws.data ? (
        <Loading />
      ) : (
        <SettingRows>
          <ReadOnlyRow label="Name" value={ws.data.name} why="The [workspace] name in workspace.toml" />
          <ReadOnlyRow label="Console name" value={ws.data.console_name} why="The [workspace] console_name in workspace.toml" />
          <ReadOnlyRow
            label="Folders"
            hint="From the .code-workspace file; the layer comes from workspace.toml."
            why="Changed with hl project add in a terminal"
            value={
              <span className="flex flex-col gap-0.5">
                {ws.data.folders.map((f) => (
                  <span key={f.path} className="flex flex-wrap items-center gap-1">
                    <Mono>{f.name}</Mono> <Chip>{f.layer}</Chip>
                  </span>
                ))}
              </span>
            }
          />
          <ReadOnlyRow
            label="Version"
            value={
              <Mono>
                helmlock {ws.data.version.helmlock} · api v{ws.data.version.api}
              </Mono>
            }
            why="The running server"
          />
        </SettingRows>
      )}
      {items.length > 0 && <Rows items={items} />}
    </Panel>
  );
}

// ---------- Loaded on the server ----------

const STATUS_TONE = { ok: "ok", pending: "warn", failed: "danger", off: "neutral" } as const;

function ServerPluginsList() {
  const q = useServerPlugins();
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data) return <Muted>This server does not list its plugins (an older hl serve).</Muted>;
  return (
    <>
      {q.data.config_error && <p className="px-1 text-[11.8px] text-destructive">Config error: {q.data.config_error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12px]" aria-label="Plugins loaded on the server">
          <thead className="text-[10.5px] tracking-wide text-ink3 uppercase">
            <tr>
              <th className="py-1 pr-2 font-semibold">Plugin</th>
              <th className="py-1 pr-2 font-semibold">Version</th>
              <th className="py-1 pr-2 font-semibold">Provides</th>
              <th className="py-1 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data.plugins.map((p) => (
              <tr key={p.id} className="border-t border-border/60 align-top">
                <td className="py-1 pr-2">
                  <Mono>{p.id}</Mono>
                  {p.use !== p.id && <span className="text-ink3"> ({p.use})</span>}
                </td>
                <td className="py-1 pr-2 text-ink2">{p.version ?? "-"}</td>
                <td className="py-1 pr-2 text-ink2">{p.provides.length ? p.provides.join(", ") : "-"}</td>
                <td className="py-1">
                  <Chip tone={STATUS_TONE[p.status]} title={p.error ?? (p.waiting_for ? `waiting for ${p.waiting_for.join(", ")}` : undefined)}>
                    {p.status}
                  </Chip>
                  {p.waiting_for && <span className="block text-[11px] text-ink3">waits for {p.waiting_for.join(", ")}</span>}
                  {p.error && <span className="block text-[11px] text-destructive">{p.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ServerPanel() {
  return (
    <Panel
      id="settings-server"
      title="Loaded on the server"
      icon={<Server />}
      tone="info"
      className="@[620px]:col-span-2"
      help={
        <>
          What this <Mono>hl serve</Mono> mounted from the <Mono>[[plugin]]</Mono> rows: ok, pending (waiting for a service another plugin provides), failed, or
          off. <Mono>hl doctor</Mono> says more.
        </>
      }
    >
      <ServerPluginsList />
    </Panel>
  );
}

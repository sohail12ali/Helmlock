// Settings (F9a sections, F9b layers, F9c/F44 forms from plugin manifests), laid out like control-center's: a sticky
// jump bar over a responsive grid of panels that fold and remember. Plugin settings save themselves through
// `config set` (shared ones to workspace.toml, per-machine ones to workspace.local.toml); secrets are stored by
// env-var name only and the secret itself goes to this machine's gitignored .env through `secret set`.
import { Link, useLocation } from "react-router";
import { useSettings } from "@/api/write-hooks";
import { PageHeader } from "@/components/common";
import { PageLayout } from "@/components/layout/PageLayout";
import { JumpBar, PanelsProvider } from "@/components/settings";
import {
  AgentsPanel,
  AppearancePanel,
  AssistantPanel,
  MachinePanel,
  ModelsPanel,
  PermissionsPanel,
  ServerPanel,
  type SettingsData,
  TelegramPanel,
  WorkLogPanel,
  WorkspacePanel,
} from "@/features/settings/panels";

export { toList } from "@/features/settings/PluginSettingRow";

/** Where the open/closed state of every panel is remembered (this browser only). */
export const PANELS_KEY = "hl.settings.panels";

export function SettingsPage() {
  const q = useSettings();
  const { hash } = useLocation();
  const data: SettingsData = { view: q.data, pending: q.isPending, error: q.isError ? q.error : undefined };
  return (
    <PageLayout id="settings">
      <PageHeader title="Settings">
        <Link to="/actions" className="text-xs text-primary hover:underline">
          All actions
        </Link>
      </PageHeader>
      <PanelsProvider storageKey={PANELS_KEY} hash={hash}>
        <JumpBar label="Settings sections" />
        <div className="grid w-full items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr))]">
          <AppearancePanel />
          <ModelsPanel data={data} />
          <AgentsPanel data={data} />
          <AssistantPanel data={data} />
          <PermissionsPanel data={data} />
          <TelegramPanel data={data} />
          <WorkLogPanel data={data} />
          <MachinePanel />
          <WorkspacePanel data={data} />
          <ServerPanel />
        </div>
      </PanelsProvider>
    </PageLayout>
  );
}

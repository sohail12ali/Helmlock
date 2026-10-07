import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Loading } from "@/components/common";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/lib/theme";
import { OverviewPage } from "@/pages/Overview";
import { TicketsPage } from "@/pages/Tickets";

const TicketPage = lazy(() => import("@/pages/TicketPage").then((m) => ({ default: m.TicketPage })));
const ArtifactPage = lazy(() => import("@/pages/TicketPage").then((m) => ({ default: m.ArtifactPage })));
const AgentsPage = lazy(() => import("@/features/agents/AgentsPage").then((m) => ({ default: m.AgentsPage })));
const RunView = lazy(() => import("@/features/agents/RunView").then((m) => ({ default: m.RunView })));
const ChatPage = lazy(() => import("@/features/chat/ChatPage").then((m) => ({ default: m.ChatPage })));
const TodosPage = lazy(() => import("@/pages/Todos").then((m) => ({ default: m.TodosPage })));
const WorkPage = lazy(() => import("@/pages/Work").then((m) => ({ default: m.WorkPage })));
const KnowledgePage = lazy(() => import("@/features/knowledge/KnowledgePage").then((m) => ({ default: m.KnowledgePage })));
const InboxPage = lazy(() => import("@/features/inbox/InboxPage").then((m) => ({ default: m.InboxPage })));
const SetupPage = lazy(() => import("@/features/setup/SetupPage").then((m) => ({ default: m.SetupPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })));
const ActionsPage = lazy(() => import("@/pages/Actions").then((m) => ({ default: m.ActionsPage })));
const SearchPage = lazy(() => import("@/pages/Misc").then((m) => ({ default: m.SearchPage })));
const NotFoundPage = lazy(() => import("@/pages/Misc").then((m) => ({ default: m.NotFoundPage })));

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // SSE drives freshness; refetch on focus only as a fallback when live updates are off.
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        retry: (n, err) => n < 2 && (err as { status?: number }).status !== 404,
      },
    },
  });
}

export function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="inbox" element={s(<InboxPage />)} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="t/:id" element={s(<TicketPage />)} />
        <Route path="t/:id/:artifact" element={s(<ArtifactPage />)} />
        <Route path="agents" element={s(<AgentsPage />)} />
        <Route path="agents/runs/:id" element={s(<RunView />)} />
        <Route path="chat" element={s(<ChatPage />)} />
        <Route path="todos" element={s(<TodosPage />)} />
        <Route path="work" element={s(<WorkPage />)} />
        <Route path="knowledge" element={s(<KnowledgePage />)} />
        <Route path="settings" element={s(<SettingsPage />)} />
        <Route path="setup" element={s(<SetupPage />)} />
        <Route path="actions" element={s(<ActionsPage />)} />
        <Route path="search" element={s(<SearchPage />)} />
        <Route path="*" element={s(<NotFoundPage />)} />
      </Route>
    </Routes>
  );
}

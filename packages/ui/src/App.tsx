import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Loading } from "@/components/common";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/lib/theme";
import { InboxPage, OverviewPage } from "@/pages/Overview";
import { TicketsPage } from "@/pages/Tickets";

const TicketPage = lazy(() => import("@/pages/TicketPage").then((m) => ({ default: m.TicketPage })));
const ArtifactPage = lazy(() => import("@/pages/TicketPage").then((m) => ({ default: m.ArtifactPage })));
const AgentsPage = lazy(() => import("@/pages/Agents").then((m) => ({ default: m.AgentsPage })));
const TodosPage = lazy(() => import("@/pages/Misc").then((m) => ({ default: m.TodosPage })));
const WorkPage = lazy(() => import("@/pages/Misc").then((m) => ({ default: m.WorkPage })));
const KnowledgePage = lazy(() => import("@/pages/Misc").then((m) => ({ default: m.KnowledgePage })));
const SettingsPage = lazy(() => import("@/pages/Misc").then((m) => ({ default: m.SettingsPage })));
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
        <Route path="inbox" element={<InboxPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="t/:id" element={s(<TicketPage />)} />
        <Route path="t/:id/:artifact" element={s(<ArtifactPage />)} />
        <Route path="agents" element={s(<AgentsPage />)} />
        <Route path="todos" element={s(<TodosPage />)} />
        <Route path="work" element={s(<WorkPage />)} />
        <Route path="knowledge" element={s(<KnowledgePage />)} />
        <Route path="settings" element={s(<SettingsPage />)} />
        <Route path="search" element={s(<SearchPage />)} />
        <Route path="*" element={s(<NotFoundPage />)} />
      </Route>
    </Routes>
  );
}

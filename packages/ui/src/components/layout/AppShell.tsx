import { HelpCircle, Inbox, LayoutDashboard, Menu, MessageSquare, Moon, MoreHorizontal, PanelLeft, Search, SquareKanban, Sun } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useOverview, useWorkspace } from "@/api/hooks";
import { type LiveState, useLiveUpdates } from "@/api/live";
import { useM4Live } from "@/api/m4";
import { useInboxUnread, useM5Live } from "@/api/m5";
import { NewTicketHost } from "@/components/actions/NewTicket";
import { Loading } from "@/components/common";
import { HelpDialog } from "@/components/HelpDialog";
import { Palette } from "@/components/Palette";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ApprovalsBadge } from "@/features/approvals/PendingApprovals";
import { AddProjectHost } from "@/features/projects/AddProject";
import { useActiveProject, useProjectUrlSync } from "@/features/projects/active";
import { CenterSwitcher, ProjectChip, ProjectsNav } from "@/features/projects/Switcher";
import { useAutoWelcome } from "@/features/welcome/auto";
import { WorkNavBadge } from "@/features/work/NavBadge";
import { useGlobalKeys } from "@/lib/keys";
import { NARROW, PHONE, useMediaQuery } from "@/lib/media";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { INBOX_NAV, NAV } from "./nav";
import { ShellContext } from "./shell-context";
import { SplitGroup, SplitHandle, SplitPanel, useSplitPanelRef } from "./split";

// The assistant panel loads on first open (keeps the first chunk small).
const ChatPanel = lazy(() => import("@/features/chat/ChatPanel"));
const CHAT_OPEN_KEY = "hl.chat.open";
function loadChatOpen(): boolean {
  try {
    return localStorage.getItem(CHAT_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function LiveDot({ state }: { state: LiveState }) {
  const label =
    state === "live" ? "Live: updates arrive as files change" : state === "connecting" ? "Connecting to live updates" : "Offline: not receiving updates";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={label} role="status" aria-label={label}>
      <span className={cn("size-2 rounded-full", state === "live" ? "bg-ok animate-live" : state === "connecting" ? "bg-warn" : "bg-muted-foreground")} />
      <span className="hidden lg:inline">{state}</span>
    </span>
  );
}

// Inbox sits under Overview in the side nav (mockup 05) with its unread count; Overview keeps the needs-you count
// only while the server has no inbox.
const SIDE_NAV = [NAV[0]!, INBOX_NAV, ...NAV.slice(1)];

function SideNav({ collapsed, needsYou, unread, onNavigate }: { collapsed: boolean; needsYou?: number; unread?: number; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-0.5 overflow-y-auto bg-sunk/60 p-2">
      {SIDE_NAV.map((n) => (
        <NavLink
          key={n.id}
          to={n.path}
          end={n.path === "/"}
          onClick={onNavigate}
          title={collapsed ? n.label : undefined}
          className={({ isActive }) =>
            cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-ink2 hover:bg-accent hover:text-foreground",
              isActive && "bg-card font-medium text-foreground shadow-xs",
              collapsed && "justify-center px-0",
            )
          }
        >
          <n.icon className="size-4 shrink-0" />
          {!collapsed && <span className="truncate">{n.label}</span>}
          {!collapsed && n.id === "overview" && unread === undefined && !!needsYou && (
            <span className="ml-auto rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground" title="Needs you">
              {needsYou}
            </span>
          )}
          {!collapsed && n.id === "work" && <WorkNavBadge />}
          {!collapsed && n.id === "inbox" && !!unread && (
            <span className="ml-auto rounded-full bg-primary px-1.5 font-mono text-[11px] text-primary-foreground" title="Unread in the inbox">
              {unread}
            </span>
          )}
        </NavLink>
      ))}
      <ProjectsNav collapsed={collapsed} onPick={onNavigate} />
    </nav>
  );
}

function BottomBar({ needsYou, onMore }: { needsYou?: number; onMore: () => void }) {
  const item = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] text-ink2";
  const active = "text-primary";
  return (
    <nav aria-label="Bottom" className="flex border-t bg-card pb-[env(safe-area-inset-bottom)]">
      <NavLink to="/" end className={({ isActive }) => cn(item, isActive && active)}>
        <LayoutDashboard className="size-5" />
        Home
      </NavLink>
      <NavLink to="/inbox" className={({ isActive }) => cn(item, isActive && active)}>
        <span className="relative">
          <Inbox className="size-5" />
          {!!needsYou && (
            <span className="absolute -top-1 -right-2 rounded-full bg-primary px-1 font-mono text-[10px] text-primary-foreground">{needsYou}</span>
          )}
        </span>
        Inbox
      </NavLink>
      <NavLink to="/tickets" className={({ isActive }) => cn(item, isActive && active)}>
        <SquareKanban className="size-5" />
        Tickets
      </NavLink>
      <button type="button" className={item} onClick={onMore}>
        <MoreHorizontal className="size-5" />
        More
      </button>
    </nav>
  );
}

export function AppShell() {
  const narrow = useMediaQuery(NARROW);
  const phone = useMediaQuery(PHONE);
  const navigate = useNavigate();
  const location = useLocation();
  const { resolved, toggle } = useTheme();
  const ws = useWorkspace();
  const overview = useOverview();
  const live = useLiveUpdates();
  useM4Live();
  useM5Live();
  useAutoWelcome();
  const unread = useInboxUnread();
  useProjectUrlSync();
  const { setProject } = useActiveProject();
  const [chatOpen, setChatOpenState] = useState(loadChatOpen);
  const setChatOpen = (o: boolean) => {
    setChatOpenState(o);
    try {
      localStorage.setItem(CHAT_OPEN_KEY, o ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  };
  const toggleChat = () => {
    if (!phone) return setChatOpen(!chatOpen);
    if (location.pathname === "/chat") navigate(-1);
    else navigate("/chat");
  };
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const navRef = useSplitPanelRef();
  const [query, setQuery] = useState("");

  const focusSearch = () => document.getElementById("hl-search")?.focus();
  useGlobalKeys({
    onPalette: () => setPaletteOpen((o) => !o),
    onHelp: () => setHelpOpen(true),
    onSearch: focusSearch,
    onGo: (p) => navigate(p),
  });

  const needsYou = overview.data?.needs_you.length;
  const consoleName = ws.data?.console_name ?? "Helmlock Console";
  const author = ws.data?.author;
  const ctx = useMemo(() => ({ narrow, phone, openPalette: () => setPaletteOpen(true), openHelp: () => setHelpOpen(true) }), [narrow, phone]);

  const toggleNav = () => {
    if (narrow) return setNavOpen(true);
    const p = navRef.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  return (
    <ShellContext.Provider value={ctx}>
      <div className="flex h-dvh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-2 sm:px-3">
          {!phone && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleNav}
              aria-label={narrow ? "Open navigation" : navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {narrow ? <Menu /> : <PanelLeft />}
            </Button>
          )}
          <NavLink to="/" className="flex shrink-0 items-center" title={consoleName} aria-label={`${consoleName}: overview`}>
            <img src="/favicon.svg" alt="" width={22} height={22} className="size-[22px] shrink-0" />
          </NavLink>
          <div className="flex min-w-0 items-center gap-1.5">
            <CenterSwitcher compact={phone} />
            <ProjectChip />
          </div>
          <form
            aria-label="Search the workspace"
            className="relative mx-auto hidden w-full max-w-md sm:block"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="hl-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
              placeholder="Search tickets, decisions, notes"
              aria-label="Search"
              className="h-8 w-full rounded-md border bg-background pr-10 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
          </form>
          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)} aria-label="Open command palette" className="hidden md:inline-flex">
              <Kbd>Ctrl K</Kbd>
            </Button>
            {phone && (
              <Button variant="ghost" size="icon" onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
                <Search />
              </Button>
            )}
            <ApprovalsBadge />
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleChat}
              aria-label={chatOpen && !phone ? "Close assistant" : "Open assistant"}
              aria-pressed={!phone ? chatOpen : location.pathname === "/chat"}
            >
              <MessageSquare />
            </Button>
            <LiveDot state={live} />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              {resolved === "dark" ? <Sun /> : <Moon />}
            </Button>
            {!phone && (
              <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
                <HelpCircle />
              </Button>
            )}
            <span
              className="ml-1 inline-flex size-7 items-center justify-center rounded-full bg-accent font-mono text-xs font-semibold text-primary uppercase"
              title={author ? `${author.name} (${author.id})` : "No author set: run hl doctor"}
            >
              {author?.initials ?? "?"}
            </span>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {narrow ? (
              <main className="h-full overflow-hidden">
                <Outlet />
              </main>
            ) : (
              <SplitGroup id="shell" panelIds={["nav", "content"]}>
                <SplitPanel
                  id="nav"
                  defaultSize={210}
                  minSize={160}
                  maxSize={340}
                  collapsible
                  collapsedSize={52}
                  panelRef={navRef}
                  onCollapsedChange={setNavCollapsed}
                >
                  <SideNav collapsed={navCollapsed} needsYou={needsYou} unread={unread} />
                </SplitPanel>
                <SplitHandle label="Resize sidebar" />
                <SplitPanel id="content" minSize="40%">
                  <main className="h-full overflow-hidden">
                    <Outlet />
                  </main>
                </SplitPanel>
              </SplitGroup>
            )}
          </div>
          {!narrow && chatOpen && (
            <aside aria-label="Assistant panel" className="w-[min(26rem,40vw)] shrink-0 border-l">
              <Suspense fallback={<Loading />}>
                <ChatPanel />
              </Suspense>
            </aside>
          )}
        </div>

        {phone && <BottomBar needsYou={unread ?? needsYou} onMore={() => setNavOpen(true)} />}

        {narrow && (
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent side="left" title="Navigation" className="w-64 pt-10">
              <SideNav collapsed={false} needsYou={needsYou} unread={unread} onNavigate={() => setNavOpen(false)} />
            </SheetContent>
          </Sheet>
        )}

        {narrow && !phone && (
          <Sheet open={chatOpen} onOpenChange={setChatOpen}>
            <SheetContent side="right" title="Assistant" className="w-[min(28rem,92vw)] pt-8">
              <Suspense fallback={<Loading />}>{chatOpen && <ChatPanel />}</Suspense>
            </SheetContent>
          </Sheet>
        )}

        <Palette open={paletteOpen} onOpenChange={setPaletteOpen} pathname={location.pathname} />
        <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
        <NewTicketHost />
        <AddProjectHost onAdded={(ids) => ids.length === 1 && ids[0] && setProject(ids[0])} />
      </div>
    </ShellContext.Provider>
  );
}

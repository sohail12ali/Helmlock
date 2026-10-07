import { BookOpen, Bot, CheckSquare, Clock, Inbox, LayoutDashboard, type LucideIcon, Settings, SquareKanban } from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  hotkey: string;
}

/** F10a tabs. Inbox lives on Overview; /inbox is its focused view for the phone bottom bar. */
export const NAV: NavItem[] = [
  { id: "overview", label: "Overview", path: "/", icon: LayoutDashboard, hotkey: "g o" },
  { id: "tickets", label: "Tickets", path: "/tickets", icon: SquareKanban, hotkey: "g t" },
  { id: "todos", label: "Todos", path: "/todos", icon: CheckSquare, hotkey: "g d" },
  { id: "work", label: "Work", path: "/work", icon: Clock, hotkey: "g w" },
  { id: "agents", label: "Agents and chat", path: "/agents", icon: Bot, hotkey: "g a" },
  { id: "knowledge", label: "Knowledge", path: "/knowledge", icon: BookOpen, hotkey: "g k" },
  { id: "settings", label: "Settings", path: "/settings", icon: Settings, hotkey: "g s" },
];

export const INBOX_NAV: NavItem = { id: "inbox", label: "Inbox", path: "/inbox", icon: Inbox, hotkey: "g i" };

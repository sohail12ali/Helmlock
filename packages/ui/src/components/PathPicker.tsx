// Folder / workspace-file picker backed by the console server (GET /api/v1/fs/list). A browser cannot reveal real paths
// from <input type=file>, and the console may be opened from a phone, so the server lists this machine's folders by name.
// Mode "folder": open folders, then "Select this folder". Mode "workspace": clicking a .code-workspace file picks it.
// Recent picks are kept in this browser (localStorage) and shown as shortcuts.
import type { FsEntry, FsListMode, FsShortcut } from "@helmlock/core/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronRight, FileCode, Folder, HardDrive, History, Star } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { projectsApi } from "@/api/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const RECENT_MAX = 6;
const recentKey = (mode: FsListMode) => `hl.pathpicker.recent.${mode}`;

export function readRecentPicks(mode: FsListMode): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey(mode)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
export function rememberPick(mode: FsListMode, path: string): void {
  try {
    const next = [path, ...readRecentPicks(mode).filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, RECENT_MAX);
    localStorage.setItem(recentKey(mode), JSON.stringify(next));
  } catch {
    /* storage blocked: no recents */
  }
}

/** Looks like an absolute path (drive, UNC or POSIX). */
export const isAbsolutePath = (p: string): boolean => /^([a-zA-Z]:[\\/]|[\\/])/.test(p.trim().replace(/^["']|["']$/g, ""));

const lastSegment = (p: string) =>
  p
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? p;
const parentOf = (p: string) => {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i <= 0 ? p : p.slice(0, /^[a-zA-Z]:$/.test(p.slice(0, i)) ? i + 1 : i);
};

/** "D:\\code\\shop" -> [D:\\, D:\\code, D:\\code\\shop] with labels; "/home/sam" -> [/, /home, /home/sam]. */
export function crumbs(path: string): { label: string; path: string }[] {
  const win = /^[a-zA-Z]:[\\/]?/.exec(path);
  const sep = path.includes("\\") || win ? "\\" : "/";
  let root: string;
  let rest: string;
  if (win) {
    root = `${win[0].slice(0, 2)}\\`;
    rest = path.slice(win[0].length);
  } else if (path.startsWith("\\\\")) {
    const parts = path.slice(2).split(/[\\/]+/);
    root = `\\\\${parts.slice(0, 2).join("\\")}\\`;
    rest = parts.slice(2).join("\\");
  } else {
    root = "/";
    rest = path.replace(/^\/+/, "");
  }
  const out = [{ label: root, path: root }];
  let acc = root;
  for (const seg of rest.split(/[\\/]+/).filter(Boolean)) {
    acc = acc.endsWith(sep) ? `${acc}${seg}` : `${acc}${sep}${seg}`;
    out.push({ label: seg, path: acc });
  }
  return out;
}

function SideButton({ icon, label, title, onClick, active }: { icon: ReactNode; label: string; title: string; onClick: () => void; active?: boolean }) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="max-w-full shrink-0 justify-start sm:w-full"
      title={title}
      aria-current={active ? "location" : undefined}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Button>
  );
}

export interface PathPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: FsListMode;
  /** Absolute path to start in (a file's folder is used); the server's default otherwise. */
  initialPath?: string;
  onPick: (path: string) => void;
}

export function PathPicker({ open, onOpenChange, mode, initialPath, onPick }: PathPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(40rem,calc(100dvh-2rem))] max-w-3xl flex-col gap-3">
        <DialogTitle>{mode === "folder" ? "Choose a folder" : "Choose a .code-workspace file"}</DialogTitle>
        <DialogDescription>
          {mode === "folder"
            ? "Folders on the machine running the console. Open a folder, then select it."
            : "Folders and workspace files on the machine running the console. Click a .code-workspace file to pick it."}
        </DialogDescription>
        {open && (
          <Browser
            mode={mode}
            {...(initialPath ? { initialPath } : {})}
            onPick={(p) => {
              rememberPick(mode, p);
              onPick(p);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function startPath(mode: FsListMode, initial?: string): string | undefined {
  if (!initial || !isAbsolutePath(initial)) return undefined;
  const p = initial.trim().replace(/^["']|["']$/g, "");
  return mode === "workspace" && /\.code-workspace$/i.test(p) ? parentOf(p) : p;
}

function Browser({ mode, initialPath, onPick }: { mode: FsListMode; initialPath?: string; onPick: (path: string) => void }) {
  const uid = useId();
  const [path, setPath] = useState<string | undefined>(() => startPath(mode, initialPath));
  const [filter, setFilter] = useState("");
  const [typed, setTyped] = useState("");
  const [selected, setSelected] = useState<string>();
  const recents = useMemo(() => readRecentPicks(mode), [mode]);
  const q = useQuery({
    queryKey: ["fs-list", mode, path ?? ""],
    queryFn: ({ signal }) => projectsApi.fsList(path, mode, signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 5_000,
  });
  const current = q.isPlaceholderData ? undefined : q.data;
  // The last good listing keeps the places and the breadcrumb on screen after an error.
  const [lastGood, setLastGood] = useState(current);
  const listing = current ?? q.data ?? lastGood;
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (current) {
      setLastGood(current);
      setTyped(current.path);
    }
  }, [current]);

  const go = (p: string) => {
    setPath(p);
    setFilter("");
    setSelected(undefined);
  };
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (current?.entries ?? []).filter((e) => !f || e.name.toLowerCase().includes(f));
  }, [current, filter]);

  const activate = (e: FsEntry) => {
    if (e.kind === "folder") go(e.path);
    else onPick(e.path);
  };
  const onRowKey = (ev: KeyboardEvent<HTMLButtonElement>, e: FsEntry, i: number) => {
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-row]");
    if (ev.key === "Enter") {
      ev.preventDefault();
      activate(e);
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      rows?.[Math.max(0, Math.min((rows?.length ?? 1) - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (ev.key === "Backspace" && current?.parent) {
      ev.preventDefault();
      go(current.parent);
    }
  };

  const err = q.error instanceof ApiError ? q.error : q.error ? new ApiError(String(q.error), "error", 0) : undefined;
  const shortcuts: FsShortcut[] = listing?.shortcuts ?? [];
  const selectedEntry = shown.find((e) => e.path === selected && e.kind === "folder");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form
        className="flex gap-2"
        aria-label="Go to a path"
        onSubmit={(e) => {
          e.preventDefault();
          const t = typed.trim().replace(/^["']|["']$/g, "");
          if (!t) return;
          if (mode === "workspace" && /\.code-workspace$/i.test(t)) onPick(t);
          else go(t);
        }}
      >
        <label htmlFor={`${uid}-typed`} className="sr-only">
          Path
        </label>
        <Input id={`${uid}-typed`} className="font-mono text-xs" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Paste a path" />
        <Button type="submit" variant="outline" disabled={!typed.trim()}>
          Go
        </Button>
      </form>

      <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-[11rem_1fr]">
        <nav aria-label="Places" className="flex min-w-0 gap-1 overflow-x-auto pb-1 sm:flex-col sm:overflow-y-auto sm:overflow-x-visible sm:pb-0">
          {(listing?.roots ?? []).map((r) => (
            <SideButton key={r} icon={<HardDrive />} label={r} title={r} onClick={() => go(r)} active={current?.path === r} />
          ))}
          {shortcuts.map((s) => (
            <SideButton key={`s:${s.path}`} icon={<Star />} label={s.label} title={s.path} onClick={() => go(s.path)} active={current?.path === s.path} />
          ))}
          {recents.map((p) => (
            <SideButton
              key={`r:${p}`}
              icon={<History />}
              label={lastSegment(p)}
              title={`Recent: ${p}`}
              onClick={() => (mode === "workspace" && /\.code-workspace$/i.test(p) ? onPick(p) : go(p))}
            />
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          {listing && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Up one folder"
                disabled={!current?.parent}
                onClick={() => current?.parent && go(current.parent)}
              >
                <ArrowUp />
              </Button>
              <nav aria-label="Current folder" className="min-w-0 flex-1 overflow-x-auto">
                <ol className="flex items-center gap-0.5 font-mono text-xs whitespace-nowrap">
                  {crumbs(listing.path).map((c, i, all) => (
                    <li key={c.path} className="flex items-center gap-0.5">
                      {i > 0 && <ChevronRight className="size-3 text-muted-foreground" aria-hidden />}
                      {i === all.length - 1 ? (
                        <span aria-current="location" className="px-1 font-medium">
                          {c.label}
                        </span>
                      ) : (
                        <button type="button" className="rounded px-1 hover:bg-accent" onClick={() => go(c.path)}>
                          {c.label}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
          )}
          <label htmlFor={`${uid}-filter`} className="sr-only">
            Filter
          </label>
          <Input id={`${uid}-filter`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this folder" className="h-7 text-xs" />

          {err && (
            <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              {err.message}
              {err.fix && <span className="block text-xs text-muted-foreground">{err.fix}</span>}
            </div>
          )}
          {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {current && (
            <ul ref={listRef} aria-label="Folder contents" className="min-h-40 flex-1 overflow-y-auto rounded-md border">
              {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{filter ? "Nothing matches the filter." : "No folders here."}</li>}
              {shown.map((e, i) => (
                <li key={e.path}>
                  <button
                    type="button"
                    data-row
                    aria-pressed={e.kind === "folder" ? selected === e.path : undefined}
                    title={e.kind === "folder" ? `${e.path} (double-click or Enter to open)` : `${e.path} (click to pick)`}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                      selected === e.path && "bg-secondary",
                    )}
                    onClick={() => (e.kind === "folder" ? setSelected(e.path) : onPick(e.path))}
                    onDoubleClick={() => e.kind === "folder" && go(e.path)}
                    onKeyDown={(ev) => onRowKey(ev, e, i)}
                  >
                    {e.kind === "folder" ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <FileCode className="size-4 shrink-0 text-primary" />}
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {e.git && <Badge variant="ok">git repo</Badge>}
                    {e.workspace && <Badge variant="accent">has workspace file</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {current?.truncated && (
            <p className="text-xs text-muted-foreground">Only the first {current.entries.length} entries are shown. Use the filter or type a path.</p>
          )}
        </div>
      </div>

      {mode === "folder" && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {current && (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={selectedEntry?.path ?? current.path}>
              {selectedEntry?.path ?? current.path}
            </span>
          )}
          {selectedEntry && (
            <Button type="button" variant="outline" onClick={() => onPick(selectedEntry.path)}>
              Select “{selectedEntry.name}”
            </Button>
          )}
          <Button type="button" disabled={!current} onClick={() => current && onPick(current.path)}>
            Select this folder
          </Button>
        </div>
      )}
    </div>
  );
}

// Add project (milestone 7): one repo folder (`project add`) or the folders of an existing .code-workspace file
// (`project import`). Only `hl init` and `hl project add` write the workspace file, so every add shows the dry run
// (what will change) first and writes only on confirm. Used in a dialog (sidebar) and in the setup wizard.
import type { VerbCallResult } from "@helmlock/core/api";
import { FolderOpen, FolderPlus } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { slugify } from "@/api/m6";
import { PROJECT_INVALIDATE } from "@/api/projects";
import { Mono } from "@/components/common";
import { Field } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { PathPicker } from "@/components/PathPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** "D:\\code\\wms-api\\" -> "wms-api" */
export function folderOf(path: string): string {
  return (
    path
      .trim()
      .replace(/^["']|["']$/g, "")
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? ""
  );
}

function Preview({ result }: { result: VerbCallResult }) {
  if (!result.ok) return <VerbResult result={result} />;
  return (
    <div className="flex flex-col gap-1" role="status" aria-label="What will change">
      <p className="text-xs font-medium text-ink2">Preview (nothing written yet):</p>
      <pre className="max-h-56 overflow-auto rounded-md border bg-sunk px-3 py-2 font-mono text-xs whitespace-pre">{result.text}</pre>
    </div>
  );
}

// ---------- one repo folder ----------

function FolderForm({ onAdded }: { onAdded?: (ids: string[]) => void }) {
  const uid = useId();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const add = useVerbRun("project add", PROJECT_INVALIDATE);
  const [preview, setPreview] = useState<{ key: string; result: VerbCallResult }>();
  const [browsing, setBrowsing] = useState(false);
  const inputFor = (p: string) => {
    const f = folderOf(p);
    const i = slugify(f);
    return { folder: f, path: p.trim().replace(/^["']|["']$/g, ""), ...(i ? { id: i } : {}), ...(name.trim() ? { name: name.trim() } : {}) };
  };
  const folder = folderOf(path);
  const id = slugify(folder);
  const input = inputFor(path);
  const key = JSON.stringify(input);
  const current = preview?.key === key ? preview.result : undefined;
  const exists = current?.ok ? (current.data as { exists?: boolean } | undefined)?.exists !== false : false;
  const [done, setDone] = useState<VerbCallResult>();

  const runPreview = async (p: string = path) => {
    setDone(undefined);
    const i = inputFor(p);
    setPreview({ key: JSON.stringify(i), result: await add.run(i, true) });
  };
  const confirm = async () => {
    const r = await add.run({ ...input, yes: true });
    setDone(r);
    if (r.ok) {
      setPreview(undefined);
      setPath("");
      setName("");
      onAdded?.([id]);
    }
  };

  return (
    <form
      aria-label="Add one repo folder"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (folder) void runPreview();
      }}
    >
      <Field
        label="Repo folder"
        htmlFor={`${uid}-path`}
        required
        hint="The folder of a product repo on this machine, for example D:\code\wms-api or ../wms-api."
      >
        <div className="flex gap-2">
          <Input id={`${uid}-path`} className="font-mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="../wms-api" />
          <Button type="button" variant="outline" onClick={() => setBrowsing(true)}>
            <FolderOpen />
            Browse…
          </Button>
        </div>
      </Field>
      <PathPicker
        open={browsing}
        onOpenChange={setBrowsing}
        mode="folder"
        initialPath={path}
        onPick={(p) => {
          setPath(p);
          if (folderOf(p)) void runPreview(p);
        }}
      />
      <Field
        label="Project name (optional)"
        htmlFor={`${uid}-name`}
        hint={
          id ? (
            <>
              Project id: <Mono>{id}</Mono>
            </>
          ) : (
            "The id comes from the folder name."
          )
        }
      >
        <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={folder || "Warehouse API"} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={!folder || add.pending}>
          Preview changes
        </Button>
        <Button type="button" disabled={!current?.ok || !exists || add.pending} onClick={() => void confirm()}>
          <FolderPlus />
          Add project
        </Button>
      </div>
      {current && <Preview result={current} />}
      {current?.ok && !exists && (
        <p role="alert" className="text-sm text-destructive">
          That folder does not exist on this machine. Check the path (clone the repo first).
        </p>
      )}
      {done && <VerbResult result={done} okText="Project added." />}
    </form>
  );
}

// ---------- import a .code-workspace ----------

interface Candidate {
  name: string;
  abs: string;
  id: string;
  add: boolean;
  reason?: string;
}

function ImportForm({ onAdded }: { onAdded?: (ids: string[]) => void }) {
  const uid = useId();
  const [file, setFile] = useState("");
  const imp = useVerbRun("project import", PROJECT_INVALIDATE);
  const [list, setList] = useState<{ file: string; candidates: Candidate[] }>();
  const [checked, setChecked] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ key: string; result: VerbCallResult }>();
  const [error, setError] = useState<VerbCallResult>();
  const [done, setDone] = useState<VerbCallResult>();
  const cleanFile = file.trim().replace(/^["']|["']$/g, "");
  const key = JSON.stringify([list?.file, [...checked].sort()]);
  const current = preview?.key === key ? preview.result : undefined;

  const [browsing, setBrowsing] = useState(false);
  const read = async (f: string = cleanFile) => {
    setDone(undefined);
    setError(undefined);
    const r = await imp.run({ file: f }, true);
    if (!r.ok) {
      setList(undefined);
      setError(r);
      return;
    }
    const d = r.data as { file: string; candidates: Candidate[]; folders: string[] };
    setList({ file: d.file, candidates: d.candidates });
    setChecked(d.folders);
    setPreview({ key: JSON.stringify([d.file, [...d.folders].sort()]), result: r });
  };
  const runPreview = async () => {
    if (!list) return;
    setPreview({ key, result: await imp.run({ file: list.file, folders: checked }, true) });
  };
  const confirm = async () => {
    if (!list) return;
    const r = await imp.run({ file: list.file, folders: checked, yes: true });
    setDone(r);
    if (r.ok) {
      const ids = list.candidates.filter((c) => checked.includes(c.name)).map((c) => c.id);
      setList(undefined);
      setPreview(undefined);
      setChecked([]);
      onAdded?.(ids);
    }
  };
  const toggle = (n: string) => setChecked((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));

  return (
    <div className="flex flex-col gap-3">
      <form
        aria-label="Import a workspace file"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (cleanFile) void read();
        }}
      >
        <Field
          label=".code-workspace file"
          htmlFor={`${uid}-file`}
          required
          hint="A VS Code or Cursor workspace file that lists your repos. Its knowledge and system folders are skipped."
        >
          <div className="flex gap-2">
            <Input id={`${uid}-file`} className="font-mono" value={file} onChange={(e) => setFile(e.target.value)} placeholder="D:\code\Shop.code-workspace" />
            <Button type="button" variant="outline" onClick={() => setBrowsing(true)}>
              <FolderOpen />
              Browse…
            </Button>
          </div>
        </Field>
        <div>
          <Button type="submit" variant="outline" disabled={!cleanFile || imp.pending}>
            Read folders
          </Button>
        </div>
      </form>
      <PathPicker
        open={browsing}
        onOpenChange={setBrowsing}
        mode="workspace"
        initialPath={cleanFile}
        onPick={(p) => {
          setFile(p);
          void read(p);
        }}
      />
      {error && <VerbResult result={error} />}
      {list && (
        <fieldset className="flex flex-col gap-1.5" aria-label="Folders to add">
          <legend className="mb-1 text-xs font-medium text-ink2">
            Folders in <Mono>{list.file}</Mono>
          </legend>
          {list.candidates.length === 0 && <p className="text-sm text-muted-foreground">The file lists no folders.</p>}
          {list.candidates.map((c) => (
            <label key={c.name} className={cn("flex items-start gap-2 text-sm", !c.add && "text-muted-foreground")}>
              <input type="checkbox" className="mt-1" disabled={!c.add} checked={c.add && checked.includes(c.name)} onChange={() => toggle(c.name)} />
              <span className="min-w-0">
                <span className="font-medium">{c.name}</span>
                {c.add ? (
                  <>
                    {" "}
                    -&gt; <Mono className="text-xs">projects/{c.id}</Mono>
                  </>
                ) : (
                  <span className="text-xs"> (skipped: {c.reason})</span>
                )}
                <span className="block truncate font-mono text-xs text-muted-foreground" title={c.abs}>
                  {c.abs}
                </span>
              </span>
            </label>
          ))}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={checked.length === 0 || !!current || imp.pending} onClick={() => void runPreview()}>
              Preview changes
            </Button>
            <Button type="button" disabled={!current?.ok || checked.length === 0 || imp.pending} onClick={() => void confirm()}>
              <FolderPlus />
              Add {checked.length} project{checked.length === 1 ? "" : "s"}
            </Button>
          </div>
        </fieldset>
      )}
      {current && checked.length > 0 && <Preview result={current} />}
      {done && <VerbResult result={done} okText="Projects added." />}
    </div>
  );
}

// ---------- the two ways ----------

export function AddProject({ onAdded, className }: { onAdded?: (ids: string[]) => void; className?: string }) {
  const [mode, setMode] = useState<"folder" | "import">("folder");
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <fieldset className="flex flex-wrap gap-1" aria-label="How to add">
        {(
          [
            ["folder", "One repo folder"],
            ["import", "Import a .code-workspace"],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} type="button" size="sm" variant={mode === id ? "secondary" : "outline"} aria-pressed={mode === id} onClick={() => setMode(id)}>
            {label}
          </Button>
        ))}
      </fieldset>
      {mode === "folder" ? <FolderForm onAdded={onAdded} /> : <ImportForm onAdded={onAdded} />}
      <p className="text-xs text-muted-foreground">
        Adding writes <Mono>projects/&lt;id&gt;/</Mono> and the folder list of this knowledge center's <Mono>.code-workspace</Mono> (and its template). Same as{" "}
        <Mono>hl project add</Mono> in a terminal.
      </p>
    </div>
  );
}

// ---------- dialog (sidebar "Add project") ----------

let open = false;
const subs = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  for (const s of subs) s();
};
export const openAddProject = () => setOpen(true);
const useOpen = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => open,
  );

/** Mounted once in the shell. */
export function AddProjectHost({ onAdded }: { onAdded?: (ids: string[]) => void }) {
  const isOpen = useOpen();
  useEffect(() => () => setOpen(false), []);
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Add project</DialogTitle>
        <DialogDescription>Connect a repo to this knowledge center. You see what will change before anything is written.</DialogDescription>
        {isOpen && <AddProject className="mt-2" onAdded={onAdded} />}
      </DialogContent>
    </Dialog>
  );
}

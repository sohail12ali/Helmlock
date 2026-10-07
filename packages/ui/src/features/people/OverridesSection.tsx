// Settings > Your agents and skills (Blueprint 31): every agent and skill after layer resolution (local, then personal,
// then workspace and project, then system), which layer won, what it hides, and where to put your own variant.
import type { ResolvedItem } from "@helmlock/core/contracts";
import { useState } from "react";
import { useOverrides, usePeople } from "@/api/m6";
import { CopyCommand, ErrorState, Loading, Mono } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Layer = ResolvedItem["layer"];

const LAYER: Record<Layer, { variant: "default" | "outline" | "accent" | "warn"; hint: string }> = {
  system: { variant: "default", hint: "From the delivery repo (shared by every workspace)" },
  workspace: { variant: "outline", hint: "From this knowledge repo (Team, committed)" },
  project: { variant: "outline", hint: "From a project overlay (Team, committed)" },
  personal: { variant: "accent", hint: "Your variant under people/<you>/ (committed, visible to the team)" },
  local: { variant: "warn", hint: "This machine only, in .hl-local/ (never committed)" },
};

export function LayerBadge({ layer }: { layer: string }) {
  const l = LAYER[layer as Layer] ?? { variant: "outline" as const, hint: layer };
  return (
    <Badge variant={l.variant} title={l.hint} data-layer={layer}>
      {layer}
    </Badge>
  );
}

/** Where a personal or local override of this item goes. Skills follow the .claude/skills/<name>/SKILL.md shape. */
export function overridePaths(item: Pick<ResolvedItem, "kind" | "name">, me: string | undefined): { personal: string; local: string } {
  const rel = item.kind === "agent" ? `agents/${item.name}.md` : `skills/${item.name}/SKILL.md`;
  return { personal: `people/${me ?? "<you>"}/${rel}`, local: `.hl-local/${rel}` };
}

function Row({ item, me }: { item: ResolvedItem; me?: string }) {
  const [open, setOpen] = useState(false);
  const paths = overridePaths(item, me);
  return (
    <li className="flex flex-col gap-1.5 py-2" data-item={`${item.kind}:${item.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.name}</span>
        <LayerBadge layer={item.layer} />
        {item.overrides.length > 0 && (
          <span className="text-xs text-muted-foreground">
            overrides{" "}
            {item.overrides.map((o, i) => (
              <span key={`${o.layer}-${o.path}`}>
                {i > 0 && ", "}
                <span title={o.path}>{o.layer}</span>
              </span>
            ))}
          </span>
        )}
        <Mono className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={item.path}>
          {item.path}
        </Mono>
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Make my own"}
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 rounded-md border bg-sunk p-2 text-xs">
          {item.overrides.length > 0 && (
            <ul className="text-muted-foreground">
              {item.overrides.map((o) => (
                <li key={`${o.layer}-${o.path}`}>
                  hides <LayerBadge layer={o.layer} /> <Mono>{o.path}</Mono>
                </li>
              ))}
            </ul>
          )}
          <p>Copy the winning file to one of these paths and edit it. Local wins over personal, personal over the shared one.</p>
          <CopyCommand label="Personal (in git, visible to the team)" command={paths.personal} />
          <CopyCommand label="Local (this machine only)" command={paths.local} />
          <CopyCommand label="Then regenerate host config" command="hl harness sync" />
        </div>
      )}
    </li>
  );
}

export function OverridesSection() {
  const q = useOverrides();
  const people = usePeople();
  const me = people.data?.me?.id;
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data) return <p className="text-sm text-muted-foreground">This server does not list agent and skill layers yet.</p>;
  const groups: { kind: ResolvedItem["kind"]; title: string }[] = [
    { kind: "agent", title: "Agents" },
    { kind: "skill", title: "Skills" },
  ];
  const mine = q.data.filter((i) => i.layer === "personal" || i.layer === "local").length;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Which layer each agent and skill comes from. {mine > 0 ? `${mine} use your own variant.` : "None use your own variant yet."} A personal variant lives in{" "}
        <Mono>people/{me ?? "<you>"}/</Mono> (committed, visible to the team); a local one in <Mono>.hl-local/</Mono> (this machine only).
      </p>
      {groups.map((g) => {
        const items = q.data!.filter((i) => i.kind === g.kind).sort((a, b) => a.name.localeCompare(b.name));
        if (items.length === 0) return null;
        return (
          <div key={g.kind}>
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h3>
            <ul className="divide-y" aria-label={g.title}>
              {items.map((i) => (
                <Row key={`${i.kind}:${i.name}`} item={i} me={me} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

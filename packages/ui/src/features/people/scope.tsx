// Storage scopes (Blueprint 31) in one place: the same three words, icons and "where is it stored" line everywhere.
// Team = shared, committed. Personal = committed under people/<you>/, visible to the team. Private = this machine only.
import type { TodoItem } from "@helmlock/core/contracts";
import { Lock, type LucideIcon, User, Users } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Scope = TodoItem["scope"];
export const SCOPE_ORDER: readonly Scope[] = ["team", "personal", "private"];

export const SCOPES: Record<Scope, { label: string; icon: LucideIcon; variant: "accent" | "outline" | "warn"; where: (me?: string) => string }> = {
  team: {
    label: "Team",
    icon: Users,
    variant: "accent",
    where: () => "Shared with the team: committed to the knowledge repo in git.",
  },
  personal: {
    label: "Personal",
    icon: User,
    variant: "outline",
    where: (me) => `Yours, in git under people/${me ?? "<you>"}/: committed and visible to the team.`,
  },
  private: {
    label: "Private",
    icon: Lock,
    variant: "warn",
    where: () => "Only on this machine (.hl-local/): never committed, nobody else sees it.",
  },
};

export function ScopeBadge({ scope, me, label, className }: { scope: Scope; me?: string; label?: string; className?: string }) {
  const s = SCOPES[scope];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} title={s.where(me)} className={className} data-scope={scope}>
      <Icon aria-hidden />
      {label ?? s.label}
      <span className="sr-only">: {s.where(me)}</span>
    </Badge>
  );
}

/** A three-way segmented choice built on native radios (arrow keys move between options). */
export function ScopePicker({
  value,
  onChange,
  me,
  label = "Scope",
  options = SCOPE_ORDER,
  className,
}: {
  value: Scope;
  onChange: (s: Scope) => void;
  me?: string;
  label?: string;
  options?: readonly Scope[];
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1", className)} aria-label={label}>
      <div className="inline-flex w-fit rounded-md border bg-sunk p-0.5">
        {options.map((o) => {
          const s = SCOPES[o];
          const Icon = s.icon;
          const on = o === value;
          return (
            <label
              key={o}
              title={s.where(me)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded px-2.5 text-xs text-ink2 hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40",
                on && "bg-card font-medium text-foreground shadow-xs",
              )}
            >
              <input type="radio" className="sr-only" name={name} value={o} checked={on} onChange={() => onChange(o)} />
              <Icon className="size-3.5" aria-hidden />
              {s.label}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {SCOPES[value].where(me)}
      </p>
    </fieldset>
  );
}

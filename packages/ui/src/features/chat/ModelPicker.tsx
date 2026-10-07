// Model picker grouped by provider (F84, F11c). The default model is marked; capability chips show tools and vision.
import type { ModelInfo, ModelsView } from "@helmlock/core/contracts";
import { useId } from "react";
import { Select } from "@/components/forms/controls";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function groupModels(view: ModelsView): { provider: string; label: string; models: ModelInfo[] }[] {
  const groups = new Map<string, { provider: string; label: string; models: ModelInfo[] }>();
  for (const p of view.providers) groups.set(p.id, { provider: p.id, label: p.label || p.id, models: [] });
  for (const m of view.models) {
    let g = groups.get(m.provider);
    if (!g) {
      g = { provider: m.provider, label: m.provider, models: [] };
      groups.set(m.provider, g);
    }
    g.models.push(m);
  }
  return [...groups.values()].filter((g) => g.models.length > 0);
}

export function CapabilityChips({ model, className }: { model: ModelInfo | undefined; className?: string }) {
  if (!model) return null;
  return (
    <span className={cn("flex items-center gap-1", className)}>
      {model.capabilities.tool_calls && (
        <Badge variant="accent" title="Can call tools">
          tools
        </Badge>
      )}
      {model.capabilities.vision && (
        <Badge variant="accent" title="Accepts images">
          vision
        </Badge>
      )}
    </span>
  );
}

export function ModelPicker({
  view,
  value,
  onChange,
  disabled,
  className,
}: {
  view: ModelsView;
  value: string | undefined;
  onChange: (model: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const groups = groupModels(view);
  const current = view.models.find((m) => m.id === value);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <label htmlFor={id} className="sr-only">
        Model
      </label>
      <Select id={id} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-7 w-auto max-w-[14rem] min-w-0 text-xs">
        {!current && <option value={value ?? ""}>{value || "Pick a model"}</option>}
        {groups.map((g) => (
          <optgroup key={g.provider} label={g.label} data-provider={g.provider}>
            {g.models.map((m) => (
              <option key={`${g.provider}:${m.id}`} value={m.id}>
                {m.label || m.id}
                {m.id === view.default ? " (default)" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <CapabilityChips model={current} />
    </span>
  );
}

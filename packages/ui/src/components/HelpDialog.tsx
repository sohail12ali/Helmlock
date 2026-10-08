import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/input";
import { GO_KEYS } from "@/lib/keys";

const ROWS: [string[], string][] = [
  [["Ctrl", "K"], "Command palette"],
  [["/"], "Search"],
  [["c"], "New ticket"],
  [["j"], "Next row"],
  [["k"], "Previous row"],
  [["Enter"], "Open the selected row"],
  [["Esc"], "Close a drawer or dialog"],
  [["?"], "This help"],
];

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Every change goes through the same verbs as the hl CLI, with the same gates.</DialogDescription>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {ROWS.map(([keys, label]) => (
            <div key={label} className="contents">
              <span className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
              <span className="text-ink2">{label}</span>
            </div>
          ))}
          {Object.entries(GO_KEYS).map(([k, v]) => (
            <div key={k} className="contents">
              <span className="flex gap-1">
                <Kbd>g</Kbd>
                <Kbd>{k}</Kbd>
              </span>
              <span className="text-ink2">Go to {v.label}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

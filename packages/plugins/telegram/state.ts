// Per-DM state (F4d: one DM = one open chat), kept on this machine in .hl-cache/telegram.json (never committed).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DmState {
  /** The assistant chat this DM talks to. */
  chat?: string;
}
interface StateFile {
  schema_version: 1;
  dms: Record<string, DmState>;
}

export const STATE_FILE = ".hl-cache/telegram.json";

export class DmStore {
  private readonly path: string;
  private data: StateFile;
  constructor(root: string) {
    this.path = join(root, STATE_FILE);
    this.data = { schema_version: 1, dms: {} };
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<StateFile>;
      if (raw && typeof raw.dms === "object" && raw.dms) this.data.dms = raw.dms;
    } catch {
      // missing or unreadable: start empty
    }
  }
  get(dm: number): DmState {
    return this.data.dms[String(dm)] ?? {};
  }
  set(dm: number, patch: DmState): void {
    this.data.dms[String(dm)] = { ...this.get(dm), ...patch };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(tmp, this.path);
  }
}

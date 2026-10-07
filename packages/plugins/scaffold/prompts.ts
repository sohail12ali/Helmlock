// Interactive prompts for the scaffold verbs. @clack/prompts is a dependency of packages/cli only, so it is
// resolved from there at call time (contract request: add it to packages/plugins). Never loaded when not interactive.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface Clack {
  text(o: { message: string; placeholder?: string; initialValue?: string; validate?: (v: string | undefined) => string | undefined }): Promise<string | symbol>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
  isCancel(v: unknown): v is symbol;
  note(message: string, title?: string): void;
}

const CLI_PACKAGE = resolve(import.meta.dirname, "../../cli/package.json");

/** Loads @clack/prompts from the cli package; undefined when it cannot be resolved. */
export async function loadClack(): Promise<Clack | undefined> {
  try {
    const path = createRequire(CLI_PACKAGE).resolve("@clack/prompts");
    return (await import(pathToFileURL(path).href)) as Clack;
  } catch {
    return undefined;
  }
}

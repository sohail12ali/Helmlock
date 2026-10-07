// Interactive prompts for the scaffold verbs. @clack/prompts is loaded only when a person is at a terminal.

export interface Clack {
  text(o: { message: string; placeholder?: string; initialValue?: string; validate?: (v: string | undefined) => string | undefined }): Promise<string | symbol>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
  isCancel(v: unknown): v is symbol;
  note(message: string, title?: string): void;
}

/** Loads @clack/prompts; undefined when it cannot be resolved. */
export async function loadClack(): Promise<Clack | undefined> {
  try {
    return (await import("@clack/prompts")) as unknown as Clack;
  } catch {
    return undefined;
  }
}

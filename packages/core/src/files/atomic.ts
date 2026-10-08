// Atomic file replacement: lock file (O_EXCL), temp file, rename over the target.
// Ported from control-center console/server/tomlio.py (_acquire_lock, _replace, atomic_write):
// EPERM/EACCES on the lock and on the rename are transient on Windows and are retried.
import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";

/** A lock older than this is taken to be left behind by a crashed writer. */
export const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = 10_000;
const RENAME_TRIES = 10;

export class LockTimeoutError extends Error {
  readonly rule = "lock-timeout";
  readonly file: string;
  constructor(file: string) {
    super(`could not lock ${file}; another writer holds ${file}.lock`);
    this.file = file;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (e: unknown) => (e as NodeJS.ErrnoException).code;
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);

async function acquire(lock: string, file: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fh = await open(lock, "wx");
      await fh.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await fh.close();
      return;
    } catch (e) {
      const c = code(e);
      if (c !== "EEXIST" && !TRANSIENT.has(c ?? "")) throw e;
      if (c === "EEXIST") {
        try {
          const st = await stat(lock);
          if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
            await unlink(lock).catch(() => undefined);
            continue;
          }
        } catch {
          continue; // the lock vanished between open and stat: try again at once
        }
      }
      if (Date.now() > deadline) throw new LockTimeoutError(file);
      await sleep(5 + Math.random() * 20);
    }
  }
}

async function release(lock: string): Promise<void> {
  for (let i = 0; i < RENAME_TRIES; i++) {
    try {
      await unlink(lock);
      return;
    } catch (e) {
      if (code(e) === "ENOENT") return;
      if (!TRANSIENT.has(code(e) ?? "") || i === RENAME_TRIES - 1) throw e;
      await sleep(10 * (i + 1));
    }
  }
}

async function replace(src: string, dst: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(src, dst);
      return;
    } catch (e) {
      if (!TRANSIENT.has(code(e) ?? "") || i === RENAME_TRIES - 1) throw e;
      await sleep(10 * (i + 1));
    }
  }
}

/** Run `fn` while holding `<file>.lock`. */
export async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await acquire(lock, file);
  try {
    return await fn();
  } finally {
    await release(lock);
  }
}

/** Current bytes of a file, or undefined when it does not exist. */
export async function readIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (e) {
    if (code(e) === "ENOENT" || code(e) === "EISDIR") return undefined;
    throw e;
  }
}

/** Write `text` to `<file>.tmp-<pid>` and rename it over `file`. Call inside withLock. */
export async function replaceFile(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  try {
    await replace(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

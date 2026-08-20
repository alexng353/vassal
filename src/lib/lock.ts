import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { VASSAL_STATE_DIR } from "./state.ts";

const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_STALE_MS = 180_000;

type LockRecord = {
  pid: number;
  acquiredAt: number;
};

export type LockOptions = {
  dir?: string;
  timeoutMs?: number;
  staleMs?: number;
};

/**
 * Run `fn` while holding an exclusive `O_EXCL` lockfile, so concurrent vassal
 * processes serialize instead of racing. A lock whose holder is dead — or that
 * has been held past `staleMs` — is broken and taken over.
 */
export async function withFileLock<T>(
  name: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const dir = opts.dir ?? VASSAL_STATE_DIR;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const path = join(dir, `${name}.lock`);
  mkdirSync(dir, { recursive: true });

  const deadline = Date.now() + timeoutMs;
  while (!acquire(path)) {
    const broke = breakIfStale(path, staleMs);
    if (!broke && Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for lock ${path} — delete it by hand if no vassal is running`,
      );
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  try {
    return await fn();
  } finally {
    rmSync(path, { force: true });
  }
}

function acquire(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    const record: LockRecord = { pid: process.pid, acquiredAt: Date.now() };
    writeSync(fd, JSON.stringify(record));
  } finally {
    closeSync(fd);
  }
  return true;
}

function breakIfStale(path: string, staleMs: number): boolean {
  const before = readRaw(path);
  if (before === null) return false;

  const record = parseRecord(before);
  const stale =
    record === null ||
    !isProcessAlive(record.pid) ||
    Date.now() - record.acquiredAt > staleMs;
  if (!stale) return false;

  // Re-read before removing: if the holder released in the meantime and someone
  // else took the lock, the bytes differ and it is no longer ours to break.
  if (readRaw(path) !== before) return false;
  rmSync(path, { force: true });
  return true;
}

function readRaw(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parseRecord(raw: string): LockRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LockRecord>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.acquiredAt !== "number"
    ) {
      return null;
    }
    return { pid: parsed.pid, acquiredAt: parsed.acquiredAt };
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

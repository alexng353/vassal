import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DaemonState, SessionMeta } from "./types.ts";

const STATE_HOME =
  process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
export const VASSAL_STATE_DIR = join(STATE_HOME, "vassal");
const DAEMON_FILE = join(VASSAL_STATE_DIR, "daemon.json");
const SESSIONS_FILE = join(VASSAL_STATE_DIR, "sessions.json");

function ensureStateDir(): void {
  if (!existsSync(VASSAL_STATE_DIR)) {
    mkdirSync(VASSAL_STATE_DIR, { recursive: true });
  }
}

export async function readDaemonState(): Promise<DaemonState | null> {
  if (!existsSync(DAEMON_FILE)) return null;
  try {
    const text = await Bun.file(DAEMON_FILE).text();
    return JSON.parse(text) as DaemonState;
  } catch {
    return null;
  }
}

export async function writeDaemonState(state: DaemonState): Promise<void> {
  ensureStateDir();
  await Bun.write(DAEMON_FILE, JSON.stringify(state, null, 2));
}

export async function clearDaemonState(): Promise<void> {
  if (existsSync(DAEMON_FILE)) {
    await Bun.file(DAEMON_FILE).delete();
  }
}

export async function readSessions(): Promise<Record<string, SessionMeta>> {
  if (!existsSync(SESSIONS_FILE)) return {};
  try {
    const text = await Bun.file(SESSIONS_FILE).text();
    return JSON.parse(text) as Record<string, SessionMeta>;
  } catch {
    return {};
  }
}

export async function writeSession(meta: SessionMeta): Promise<void> {
  ensureStateDir();
  const all = await readSessions();
  all[meta.id] = meta;
  await Bun.write(SESSIONS_FILE, JSON.stringify(all, null, 2));
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  const all = await readSessions();
  return all[id] ?? null;
}

export async function deleteSession(id: string): Promise<void> {
  const all = await readSessions();
  if (!(id in all)) return;
  delete all[id];
  await Bun.write(SESSIONS_FILE, JSON.stringify(all, null, 2));
}

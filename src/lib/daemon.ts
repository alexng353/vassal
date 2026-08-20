import { spawn } from "node:child_process";
import { join } from "node:path";
import { isProcessAlive, withFileLock } from "./lock.ts";
import {
  clearDaemonState,
  ensureStateDir,
  readDaemonState,
  VASSAL_STATE_DIR,
  writeDaemonState,
} from "./state.ts";
import type { DaemonState } from "./types.ts";

const FIRST_PORT = 4096;
const LAST_PORT = 4145;
const HEALTHCHECK_TIMEOUT_MS = 10_000;
const HEALTHCHECK_INTERVAL_MS = 200;
const START_ATTEMPTS = 5;
const LOCK_NAME = "daemon";

export type EnsureDaemonResult = {
  state: DaemonState;
  reused: boolean;
};

/** An `opencode serve` answering in vassal's port range. */
export type RunningDaemon = {
  port: number;
  url: string;
  /** null when neither `lsof` nor `ss` could name the listener. */
  pid: number | null;
};

export async function ensureDaemon(): Promise<EnsureDaemonResult> {
  // Fast path: a healthy recorded daemon needs no lock.
  const existing = await readDaemonState();
  if (existing && (await isAlive(existing))) {
    return { state: existing, reused: true };
  }

  // Everything from here — the re-check, the port pick, the spawn, the state
  // write — has to be serialized. Without the lock, N vassals starting at once
  // all see no daemon, all spawn one, all race for the same port, and the last
  // writer's state file orphans every other daemon that came up.
  return withFileLock(LOCK_NAME, async () => {
    const current = await readDaemonState();
    if (current && (await isAlive(current))) {
      return { state: current, reused: true };
    }
    if (current) await clearDaemonState();

    const adopted = await findAdoptableDaemon();
    if (adopted) {
      await writeDaemonState(adopted);
      return { state: adopted, reused: true };
    }

    const state = await startDaemon();
    await writeDaemonState(state);
    return { state, reused: false };
  });
}

async function isAlive(state: DaemonState): Promise<boolean> {
  if (!isProcessAlive(state.pid)) return false;
  return isHealthy(state.url);
}

async function isHealthy(url: string, timeoutMs = 1_000): Promise<boolean> {
  try {
    const res = await fetch(`${url}/global/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function startDaemon(): Promise<DaemonState> {
  ensureStateDir();
  const taken = new Set<number>();
  const failures: string[] = [];

  for (let attempt = 0; attempt < START_ATTEMPTS; attempt += 1) {
    const port = await pickPort(taken);
    try {
      return await spawnDaemon(port);
    } catch (err) {
      taken.add(port);
      failures.push(`${port}: ${(err as Error).message}`);
    }
  }

  throw new Error(`could not start opencode serve — ${failures.join("; ")}`);
}

async function spawnDaemon(port: number): Promise<DaemonState> {
  const url = `http://127.0.0.1:${port}`;
  const logPath = join(VASSAL_STATE_DIR, "daemon.log");
  const logFd = Bun.file(logPath).writer();

  const child = spawn(
    "nice",
    [
      "-n",
      "19",
      "opencode",
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout?.on("data", (chunk) => logFd.write(chunk));
  child.stderr?.on("data", (chunk) => logFd.write(chunk));
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  child.unref();

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error("failed to spawn opencode serve");
  }

  try {
    await waitForHealthy(url, () => exited);
  } catch (err) {
    terminate(pid);
    throw err;
  }

  // Health only proves *something* answers on this port. If our child is gone
  // it lost the bind race and the responder belongs to someone else — recording
  // its port against our dead pid is exactly how orphans got created.
  if (exited || !isProcessAlive(pid)) {
    throw new Error(`port ${port} was bound by another process`);
  }

  return { pid, port, url, startedAt: Date.now() };
}

async function waitForHealthy(
  url: string,
  hasExited: () => boolean,
): Promise<void> {
  const deadline = Date.now() + HEALTHCHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy(url, 500)) return;
    if (hasExited()) {
      throw new Error(
        `opencode serve exited before binding ${url} (see daemon.log)`,
      );
    }
    await Bun.sleep(HEALTHCHECK_INTERVAL_MS);
  }
  throw new Error(`opencode serve at ${url} did not become healthy in time`);
}

async function pickPort(taken: Set<number>): Promise<number> {
  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
    if (taken.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in range ${FIRST_PORT}-${LAST_PORT}`);
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => new Response(),
    });
    server.stop();
    return true;
  } catch {
    return false;
  }
}

/**
 * Every `opencode serve` answering in vassal's port range, whether or not the
 * state file knows about it.
 */
export async function scanForDaemons(): Promise<Array<RunningDaemon>> {
  const ports = Array.from(
    { length: LAST_PORT - FIRST_PORT + 1 },
    (_, i) => FIRST_PORT + i,
  );
  const found = await Promise.all(
    ports.map(async (port) => {
      const url = `http://127.0.0.1:${port}`;
      if (!(await isHealthy(url, 750))) return null;
      return { port, url, pid: findListenerPid(port) };
    }),
  );
  return found.filter((d): d is RunningDaemon => d !== null);
}

/** Running daemons the state file does not point at. */
export async function findOrphanDaemons(): Promise<Array<RunningDaemon>> {
  const state = await readDaemonState();
  const live = state && (await isAlive(state)) ? state.port : null;
  const running = await scanForDaemons();
  return running.filter((d) => d.port !== live);
}

/** SIGTERM every orphan we can name. Returns the ones we killed. */
export async function reapOrphanDaemons(): Promise<Array<RunningDaemon>> {
  const reaped: Array<RunningDaemon> = [];
  for (const orphan of await findOrphanDaemons()) {
    if (orphan.pid === null) continue;
    if (terminate(orphan.pid)) reaped.push(orphan);
  }
  return reaped;
}

async function findAdoptableDaemon(): Promise<DaemonState | null> {
  for (const running of await scanForDaemons()) {
    if (running.pid === null) continue;
    // startedAt is adoption time — we cannot recover the real start time, and
    // nothing depends on it beyond `server status` reporting.
    return {
      pid: running.pid,
      port: running.port,
      url: running.url,
      startedAt: Date.now(),
    };
  }
  return null;
}

function findListenerPid(port: number): number | null {
  return pidFromLsof(port) ?? pidFromSs(port);
}

function pidFromLsof(port: number): number | null {
  const out = runQuiet([
    "lsof",
    "-t",
    `-iTCP@127.0.0.1:${port}`,
    "-sTCP:LISTEN",
  ]);
  if (out === null) return null;
  for (const line of out.split("\n")) {
    const pid = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

function pidFromSs(port: number): number | null {
  const out = runQuiet(["ss", "-HlptnO", `sport = :${port}`]);
  const match = out?.match(/pid=(\d+)/);
  if (!match?.[1]) return null;
  const pid = Number.parseInt(match[1], 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function runQuiet(cmd: Array<string>): string | null {
  try {
    const res = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" });
    if (res.exitCode !== 0) return null;
    return res.stdout.toString();
  } catch {
    return null;
  }
}

function terminate(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export async function stopDaemon(): Promise<boolean> {
  return withFileLock(LOCK_NAME, async () => {
    const state = await readDaemonState();
    if (!state) return false;
    terminate(state.pid);
    await clearDaemonState();
    return true;
  });
}

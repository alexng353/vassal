import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  clearDaemonState,
  ensureStateDir,
  readDaemonState,
  VASSAL_STATE_DIR,
  writeDaemonState,
} from "./state.ts";
import type { DaemonState } from "./types.ts";

const DEFAULT_PORT = 4096;
const HEALTHCHECK_TIMEOUT_MS = 10_000;
const HEALTHCHECK_INTERVAL_MS = 200;

export type EnsureDaemonResult = {
  state: DaemonState;
  reused: boolean;
};

export async function ensureDaemon(): Promise<EnsureDaemonResult> {
  const existing = await readDaemonState();
  if (existing && (await isAlive(existing))) {
    return { state: existing, reused: true };
  }
  if (existing) await clearDaemonState();
  return { state: await startDaemon(), reused: false };
}

async function isAlive(state: DaemonState): Promise<boolean> {
  try {
    process.kill(state.pid, 0);
  } catch {
    return false;
  }
  try {
    const res = await fetch(`${state.url}/global/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function startDaemon(): Promise<DaemonState> {
  ensureStateDir();
  const port = await pickPort();
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
  child.unref();

  if (child.pid === undefined) {
    throw new Error("failed to spawn opencode serve");
  }

  const state: DaemonState = {
    pid: child.pid,
    port,
    url,
    startedAt: Date.now(),
  };

  await waitForHealthy(url);
  await writeDaemonState(state);
  return state;
}

async function waitForHealthy(url: string): Promise<void> {
  const deadline = Date.now() + HEALTHCHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/global/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return;
    } catch {
      // not yet
    }
    await Bun.sleep(HEALTHCHECK_INTERVAL_MS);
  }
  throw new Error(`opencode serve at ${url} did not become healthy in time`);
}

async function pickPort(): Promise<number> {
  if (await isPortFree(DEFAULT_PORT)) return DEFAULT_PORT;
  for (let p = DEFAULT_PORT + 1; p < DEFAULT_PORT + 50; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error("no free port found in range 4096-4145");
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

export async function stopDaemon(): Promise<boolean> {
  const state = await readDaemonState();
  if (!state) return false;
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    // already gone
  }
  await clearDaemonState();
  return true;
}

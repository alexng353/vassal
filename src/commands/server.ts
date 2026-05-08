import { ensureDaemon, stopDaemon } from "../lib/daemon.ts";
import { readDaemonState } from "../lib/state.ts";

export async function runServerStart(): Promise<number> {
  const { state, reused } = await ensureDaemon();
  const verb = reused ? "already up" : "started";
  console.log(`daemon ${verb} at ${state.url} (pid ${state.pid})`);
  return 0;
}

export async function runServerStop(): Promise<number> {
  const stopped = await stopDaemon();
  console.log(stopped ? "daemon stopped" : "no daemon was running");
  return 0;
}

export async function runServerStatus(): Promise<number> {
  const state = await readDaemonState();
  if (!state) {
    console.log("no daemon");
    return 1;
  }
  console.log(`pid ${state.pid}`);
  console.log(`url ${state.url}`);
  console.log(`since ${new Date(state.startedAt).toISOString()}`);
  return 0;
}

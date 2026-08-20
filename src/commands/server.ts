import {
  ensureDaemon,
  findOrphanDaemons,
  reapOrphanDaemons,
  stopDaemon,
} from "../lib/daemon.ts";
import { readDaemonState } from "../lib/state.ts";

export async function runServerStart(): Promise<number> {
  const { state, reused } = await ensureDaemon();
  const verb = reused ? "already up" : "started";
  console.log(`daemon ${verb} at ${state.url} (pid ${state.pid})`);
  return 0;
}

export async function runServerStop(
  opts: { all?: boolean } = {},
): Promise<number> {
  const stopped = await stopDaemon();
  console.log(stopped ? "daemon stopped" : "no daemon was running");

  if (opts.all) {
    const reaped = await reapOrphanDaemons();
    console.log(
      reaped.length === 0
        ? "no orphans found"
        : `reaped ${reaped.length} orphan(s): ${reaped.map((d) => `${d.port} (pid ${d.pid})`).join(", ")}`,
    );
  }
  return 0;
}

export async function runServerReap(): Promise<number> {
  const reaped = await reapOrphanDaemons();
  if (reaped.length === 0) {
    console.log("no orphans found");
    return 0;
  }
  for (const d of reaped) console.log(`killed pid ${d.pid} on port ${d.port}`);
  return 0;
}

export async function runServerStatus(): Promise<number> {
  const state = await readDaemonState();
  if (state) {
    console.log(`pid ${state.pid}`);
    console.log(`url ${state.url}`);
    console.log(`since ${new Date(state.startedAt).toISOString()}`);
  } else {
    console.log("no daemon");
  }

  const orphans = await findOrphanDaemons();
  for (const orphan of orphans) {
    console.log(
      `orphan ${orphan.url} (pid ${orphan.pid ?? "unknown"}) — kill with \`vassal server reap\``,
    );
  }

  return state ? 0 : 1;
}

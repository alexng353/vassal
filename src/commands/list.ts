import { displayId } from "../lib/alias.ts";
import { ensureDaemon } from "../lib/daemon.ts";
import { makeClient, type OpencodeClient } from "../lib/opencode.ts";
import { readSessions } from "../lib/state.ts";
import {
  deriveStatus,
  listPendingQuestionsForStatus,
  type Status,
  worktreeMissing,
} from "../lib/status.ts";
import type { SessionMeta } from "../lib/types.ts";

export async function runList(options: { maxAgeMs: number }): Promise<number> {
  const sessions = await readSessions();
  const entries = Object.values(sessions).sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  );

  if (entries.length === 0) {
    console.log("(no sessions)");
    return 0;
  }

  const now = Date.now();
  const cutoff = now - options.maxAgeMs;
  // Deriving a status costs a daemon round trip, so only spend it on sessions
  // that could actually show up. A session past the age cutoff is printed only
  // if it turns out to be running, and one vassal recorded as finished isn't —
  // a resume goes through dispatch, which refreshes lastActivityAt. Without
  // this, `--max-age 1h` still probed every session on disk, which crawls
  // whenever the daemon is busy with a live turn.
  const candidates = entries.filter(
    (meta) => meta.lastActivityAt >= cutoff || !hasTerminalState(meta),
  );
  const daemonClient = await makeClientForLiveSessions(candidates);
  const pendingQuestions = daemonClient
    ? await listPendingQuestionsForStatus(daemonClient.daemonUrl)
    : [];
  const candidatesWithStatus = await Promise.all(
    candidates.map(async (meta) => ({
      meta,
      status: await deriveStatus(meta, daemonClient?.client, pendingQuestions),
      missing: worktreeMissing(meta),
    })),
  );
  const visible = candidatesWithStatus.filter(
    ({ meta, status }) => meta.lastActivityAt >= cutoff || status === "running",
  );
  const hiddenCount = entries.length - visible.length;

  if (visible.length === 0) {
    console.log("(no sessions)");
  } else {
    const sessionWidth = Math.max(
      "SESSION".length,
      ...visible.map(({ meta }) => displayId(meta).length),
    );
    console.log(
      `${"SESSION".padEnd(sessionWidth)}  ${"AGE".padEnd(7)}  ${"COST".padEnd(7)} ${"STATUS".padEnd(8)}  TITLE`,
    );
    for (const { meta, status, missing } of visible) {
      const age = humanAge(now - meta.lastActivityAt);
      const cost = `$${meta.cost.toFixed(2)}`;
      console.log(formatRow(meta, age, cost, status, missing, sessionWidth));
    }
  }

  if (hiddenCount > 0) {
    console.log(`(${hiddenCount} older sessions hidden; --all to show)`);
  }
  return 0;
}

async function makeClientForLiveSessions(
  entries: Array<SessionMeta>,
): Promise<{ client: OpencodeClient; daemonUrl: string } | undefined> {
  if (entries.every(hasTerminalState)) return undefined;

  const { state: daemon } = await ensureDaemon();
  return { client: makeClient(daemon), daemonUrl: daemon.url };
}

function hasTerminalState(meta: SessionMeta): boolean {
  return meta.abortedAt !== undefined || meta.exitCode !== undefined;
}

function formatRow(
  meta: SessionMeta,
  age: string,
  cost: string,
  status: Status,
  missing: boolean,
  sessionWidth: number,
): string {
  const displayStatus = missing ? `${status} [missing]` : status;
  return `${displayId(meta).padEnd(sessionWidth)}  ${age.padEnd(7)}  ${cost.padEnd(7)} ${displayStatus.padEnd(8)}  ${meta.title}`;
}

function humanAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

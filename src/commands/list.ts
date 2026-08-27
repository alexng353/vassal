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
import { type SessionMeta, sessionDirectory } from "../lib/types.ts";

export async function runList(options: {
  maxAgeMs: number;
  limit?: number | null;
}): Promise<number> {
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
  const limit = options.limit ?? null;
  const candidates = selectCandidates(entries, cutoff, limit);
  const daemonClient = await makeClientForLiveSessions(candidates);
  // Only a live session can be blocked on a question, and each lookup is scoped
  // to one directory — so ask about the directories that could actually answer.
  const pendingQuestions = daemonClient
    ? await listPendingQuestionsForStatus(
        daemonClient.daemonUrl,
        candidates
          .filter((meta) => !hasTerminalState(meta))
          .map(sessionDirectory),
      )
    : [];
  const candidatesWithStatus = await Promise.all(
    candidates.map(async (meta) => ({
      meta,
      status: await deriveStatus(meta, daemonClient?.client, pendingQuestions),
      missing: worktreeMissing(meta),
    })),
  );
  const matching = candidatesWithStatus.filter(
    ({ meta, status }) => meta.lastActivityAt >= cutoff || status === "running",
  );
  const visible = limit === null ? matching : matching.slice(0, limit);
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
    // With -n the hidden rows are not all older ones, and --all alone will not
    // reveal them, so point at the flag that actually did the cutting. An
    // in-window session always displays, so more of those than the limit means
    // the limit cut rows — `matching` alone cannot tell us, since
    // `selectCandidates` may already have truncated to the limit.
    const inWindowCount = entries.filter(
      (meta) => meta.lastActivityAt >= cutoff,
    ).length;
    const cutByLimit =
      limit !== null &&
      (inWindowCount > limit || matching.length > visible.length);
    console.log(
      cutByLimit
        ? `(${hiddenCount} more sessions hidden; raise -n or drop it to show more)`
        : `(${hiddenCount} older sessions hidden; --all to show)`,
    );
  }
  return 0;
}

/**
 * The sessions worth deriving a status for.
 *
 * Deriving a status costs a daemon round trip, so only spend it on sessions that
 * could actually be printed. A session past the age cutoff shows up only if it
 * turns out to be running, and one vassal recorded as finished isn't — a resume
 * goes through dispatch, which refreshes `lastActivityAt`. Without this,
 * `--max-age 1h` probed every session on disk, which crawls whenever the daemon
 * is busy with a live turn.
 *
 * `-n` narrows it further: entries are sorted newest-first, so every session
 * inside the window sorts above every session outside it. Once the window alone
 * can fill the limit, nothing older can reach the printed rows — however it
 * resolves — so the rest never needs to be asked about at all.
 */
export function selectCandidates(
  entries: Array<SessionMeta>,
  cutoff: number,
  limit: number | null,
): Array<SessionMeta> {
  const inWindow = entries.filter((meta) => meta.lastActivityAt >= cutoff);
  if (limit !== null && inWindow.length >= limit)
    return inWindow.slice(0, limit);

  const liveButStale = entries.filter(
    (meta) => meta.lastActivityAt < cutoff && !hasTerminalState(meta),
  );
  return [...inWindow, ...liveButStale];
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

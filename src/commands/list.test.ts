import { describe, expect, test } from "bun:test";
import type { SessionMeta } from "../lib/types.ts";
import { selectCandidates } from "./list.ts";

const NOW = 1_000_000;
const CUTOFF = NOW - 10_000;

function meta(
  id: string,
  ageMs: number,
  overrides: Partial<SessionMeta> = {},
): SessionMeta {
  return {
    id,
    title: id,
    cwd: "/repo",
    worktree: null,
    createdAt: NOW - ageMs,
    lastActivityAt: NOW - ageMs,
    cost: 0,
    ...overrides,
  };
}

/** Newest first, the order runList sorts into before selecting. */
function sorted(...entries: Array<SessionMeta>): Array<SessionMeta> {
  return [...entries].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

const ids = (entries: Array<SessionMeta>) => entries.map((m) => m.id);

describe("selectCandidates", () => {
  test("keeps in-window sessions and live ones that fell out of the window", () => {
    const entries = sorted(
      meta("fresh", 1_000, { exitCode: 0 }),
      meta("old-done", 50_000, { exitCode: 0 }),
      meta("old-live", 60_000),
    );
    expect(ids(selectCandidates(entries, CUTOFF, null))).toEqual([
      "fresh",
      "old-live",
    ]);
  });

  test("a limit the window can fill drops the stale live sessions entirely", () => {
    const entries = sorted(
      meta("a", 1_000, { exitCode: 0 }),
      meta("b", 2_000, { exitCode: 0 }),
      meta("c", 3_000, { exitCode: 0 }),
      meta("old-live", 90_000),
    );
    // Every in-window session is newer than any out-of-window one, so `old-live`
    // cannot reach the top 2 however its status resolves — never ask about it.
    expect(ids(selectCandidates(entries, CUTOFF, 2))).toEqual(["a", "b"]);
  });

  test("a limit the window cannot fill still considers stale live sessions", () => {
    const entries = sorted(
      meta("a", 1_000, { exitCode: 0 }),
      meta("old-live", 90_000),
      meta("old-done", 95_000, { abortedAt: NOW - 95_000 }),
    );
    expect(ids(selectCandidates(entries, CUTOFF, 5))).toEqual([
      "a",
      "old-live",
    ]);
  });

  test("candidates stay newest-first so the limit takes the newest rows", () => {
    const entries = sorted(
      meta("mid", 5_000, { exitCode: 0 }),
      meta("newest", 100, { exitCode: 0 }),
      meta("old-live", 80_000),
    );
    expect(ids(selectCandidates(entries, CUTOFF, null))).toEqual([
      "newest",
      "mid",
      "old-live",
    ]);
  });

  test("an aborted session outside the window is not a candidate", () => {
    const entries = sorted(meta("gone", 90_000, { abortedAt: NOW - 90_000 }));
    expect(selectCandidates(entries, CUTOFF, null)).toEqual([]);
  });
});

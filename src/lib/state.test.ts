import { describe, expect, test } from "bun:test";
import { clearRecordedOutcome } from "./state.ts";
import type { SessionMeta } from "./types.ts";

const base: SessionMeta = {
  id: "ses_test",
  title: "test",
  cwd: "/repo",
  worktree: "/repo/.worktree",
  createdAt: 1,
  lastActivityAt: 2,
  cost: 1.5,
  alias: "ses_a-b-c-d-e",
};

describe("clearRecordedOutcome", () => {
  test("omits the terminal markers rather than nulling them", () => {
    const cleared = clearRecordedOutcome({
      ...base,
      exitCode: 1,
      abortedAt: 3,
    });

    expect("exitCode" in cleared).toBe(false);
    expect("abortedAt" in cleared).toBe(false);
    expect(JSON.parse(JSON.stringify(cleared))).not.toHaveProperty("abortedAt");
  });

  test("keeps everything else and bumps activity", () => {
    const before = Date.now();
    const cleared = clearRecordedOutcome({ ...base, abortedAt: 3 });

    expect(cleared.id).toBe(base.id);
    expect(cleared.cost).toBe(base.cost);
    expect(cleared.alias).toBe(base.alias);
    expect(cleared.worktree).toBe(base.worktree);
    expect(cleared.lastActivityAt).toBeGreaterThanOrEqual(before);
  });
});

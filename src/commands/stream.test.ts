import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "../lib/opencode.ts";
import { SessionStats } from "./stream.ts";

function assistant(
  id: string,
  input: number,
  output: number,
  cost = 0,
): SessionMessage["info"] {
  return {
    id,
    role: "assistant",
    tokens: { input, output },
    cost,
    time: { created: 1000 },
  } as unknown as SessionMessage["info"];
}

function user(created: number): SessionMessage["info"] {
  return {
    id: `msg_u${created}`,
    role: "user",
    time: { created },
  } as unknown as SessionMessage["info"];
}

describe("SessionStats", () => {
  test("a new step does not reset the totals", () => {
    const stats = new SessionStats(0);
    stats.observe(assistant("m1", 500, 40));
    expect(stats.totals()).toMatchObject({ input: 500, output: 40 });

    // opencode opens each step with a freshly zeroed message.
    stats.observe(assistant("m2", 0, 0));
    expect(stats.totals()).toMatchObject({ input: 500, output: 40 });

    stats.observe(assistant("m2", 600, 30));
    expect(stats.totals()).toMatchObject({ input: 1100, output: 70 });
  });

  test("updates to one message replace rather than accumulate", () => {
    const stats = new SessionStats(0);
    stats.observe(assistant("m1", 100, 5));
    stats.observe(assistant("m1", 100, 12));
    stats.observe(assistant("m1", 100, 30));
    expect(stats.totals()).toMatchObject({ input: 100, output: 30 });
  });

  test("cost sums across messages", () => {
    const stats = new SessionStats(0);
    stats.observe(assistant("m1", 10, 1, 0.25));
    stats.observe(assistant("m2", 10, 1, 0.5));
    expect(stats.totals().cost).toBeCloseTo(0.75);
  });

  test("the clock follows user messages, not assistant steps", () => {
    const stats = new SessionStats(1);
    stats.observe(user(5_000));
    stats.observe(assistant("m1", 10, 1));
    expect(stats.startedAt).toBe(5_000);

    stats.observe(user(9_000));
    expect(stats.startedAt).toBe(9_000);
  });

  test("totals are zero before anything is observed", () => {
    expect(new SessionStats(0).totals()).toEqual({
      input: 0,
      output: 0,
      cost: 0,
    });
  });
});

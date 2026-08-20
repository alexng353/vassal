import { describe, expect, test } from "bun:test";
import { formatElapsed, startProgress } from "./progress.ts";

describe("startProgress", () => {
  test("heartbeats on the interval until stopped", async () => {
    const lines: Array<string> = [];
    const progress = startProgress({
      intervalMs: 20,
      write: (line) => lines.push(line),
    });

    await Bun.sleep(70);
    progress.stop();
    const afterStop = lines.length;
    await Bun.sleep(60);

    expect(afterStop).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBe(afterStop);
    expect(lines[0]).toMatch(/^\[vassal] still working — \d+s elapsed\n$/);
  });

  test("notes are prefixed and written immediately", () => {
    const lines: Array<string> = [];
    const progress = startProgress({ write: (line) => lines.push(line) });
    progress.note("session ses_a-b-c-d-e");
    progress.stop();

    expect(lines).toEqual(["[vassal] session ses_a-b-c-d-e\n"]);
  });

  test("quiet suppresses everything", () => {
    const lines: Array<string> = [];
    const progress = startProgress({
      quiet: true,
      intervalMs: 1,
      write: (line) => lines.push(line),
    });
    progress.note("nope");
    progress.stop();

    expect(lines).toEqual([]);
  });
});

describe("formatElapsed", () => {
  test("renders seconds under a minute", () => {
    expect(formatElapsed(30_000)).toBe("30s");
  });

  test("zero-pads the seconds past a minute", () => {
    expect(formatElapsed(65_000)).toBe("1m05s");
    expect(formatElapsed(600_000)).toBe("10m00s");
  });
});

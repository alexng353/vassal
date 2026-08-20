import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "./lock.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vassal-lock-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("withFileLock", () => {
  test("serializes concurrent holders", async () => {
    let inside = 0;
    let maxInside = 0;
    const order: Array<number> = [];

    const run = (n: number) =>
      withFileLock(
        "daemon",
        async () => {
          inside += 1;
          maxInside = Math.max(maxInside, inside);
          await Bun.sleep(20);
          order.push(n);
          inside -= 1;
        },
        { dir },
      );

    await Promise.all([run(1), run(2), run(3), run(4)]);

    expect(maxInside).toBe(1);
    expect(order.sort()).toEqual([1, 2, 3, 4]);
  });

  test("releases the lock when the body throws", async () => {
    const fail = withFileLock(
      "daemon",
      async () => {
        throw new Error("boom");
      },
      { dir },
    );
    await expect(fail).rejects.toThrow("boom");
    expect(existsSync(join(dir, "daemon.lock"))).toBe(false);

    await expect(
      withFileLock("daemon", async () => "ok", { dir }),
    ).resolves.toBe("ok");
  });

  test("breaks a lock whose holder is gone", async () => {
    // pid 2**22 + 1 is above every Linux pid_max, so it can never be alive.
    writeFileSync(
      join(dir, "daemon.lock"),
      JSON.stringify({ pid: 4_194_305, acquiredAt: Date.now() }),
    );

    await expect(
      withFileLock("daemon", async () => "took over", { dir, timeoutMs: 500 }),
    ).resolves.toBe("took over");
  });

  test("breaks a lock held past staleMs", async () => {
    writeFileSync(
      join(dir, "daemon.lock"),
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - 10_000 }),
    );

    await expect(
      withFileLock("daemon", async () => "took over", {
        dir,
        timeoutMs: 500,
        staleMs: 1_000,
      }),
    ).resolves.toBe("took over");
  });

  test("breaks an unparseable lock", async () => {
    writeFileSync(join(dir, "daemon.lock"), "not json");

    await expect(
      withFileLock("daemon", async () => "took over", { dir, timeoutMs: 500 }),
    ).resolves.toBe("took over");
  });

  test("times out rather than stealing a live lock", async () => {
    writeFileSync(
      join(dir, "daemon.lock"),
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
    );

    await expect(
      withFileLock("daemon", async () => "stolen", { dir, timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  });
});

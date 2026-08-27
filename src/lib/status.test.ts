import { describe, expect, test } from "bun:test";
import type {
  OpencodeClient,
  PendingQuestion,
  SessionMessage,
} from "./opencode.ts";
import { deriveStatus } from "./status.ts";
import type { SessionMeta } from "./types.ts";

const NOW = Date.now();

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "ses_test",
    title: "test",
    cwd: "/repo",
    worktree: null,
    createdAt: NOW - 600_000,
    lastActivityAt: NOW - 600_000,
    cost: 0,
    ...overrides,
  };
}

function assistantTurn(options: {
  created: number;
  completed?: number;
  text?: string;
}): SessionMessage {
  return {
    info: {
      role: "assistant",
      time: { created: options.created, completed: options.completed },
    },
    parts:
      options.text === undefined
        ? []
        : [{ type: "text", text: options.text, time: { start: NOW } }],
  } as unknown as SessionMessage;
}

function clientWith(messages: Array<SessionMessage>): OpencodeClient {
  return {
    session: { messages: async () => ({ data: messages }) },
  } as unknown as OpencodeClient;
}

/**
 * A client that answers the cheap `session.get` probe, and counts how often the
 * expensive message fetch was reached.
 */
function clientWithActivity(
  updatedAt: number,
  messages: Array<SessionMessage> = [],
): { client: OpencodeClient; messageFetches: () => number } {
  let fetches = 0;
  const client = {
    session: {
      get: async () => ({ data: { time: { created: 0, updated: updatedAt } } }),
      messages: async () => {
        fetches += 1;
        return { data: messages };
      },
    },
  } as unknown as OpencodeClient;
  return { client, messageFetches: () => fetches };
}

const brokenClient = {
  session: { messages: async () => ({ error: "daemon is down" }) },
} as unknown as OpencodeClient;

function question(sessionID: string): PendingQuestion {
  return { id: "q1", sessionID, questions: [] };
}

describe("deriveStatus recorded outcomes", () => {
  test("aborted sticks when the daemon has nothing newer", async () => {
    const abortedAt = NOW - 60_000;
    const status = await deriveStatus(
      meta({ abortedAt, lastActivityAt: abortedAt }),
      clientWith([assistantTurn({ created: abortedAt - 30_000 })]),
    );
    expect(status).toBe("aborted");
  });

  test("aborted then resumed reports running again", async () => {
    const abortedAt = NOW - 600_000;
    const status = await deriveStatus(
      meta({ abortedAt, lastActivityAt: abortedAt }),
      clientWith([
        assistantTurn({ created: abortedAt - 30_000, completed: abortedAt }),
        assistantTurn({ created: NOW - 5_000, text: "still going" }),
      ]),
    );
    expect(status).toBe("running");
  });

  test("a completed exit stays done", async () => {
    const finishedAt = NOW - 60_000;
    const status = await deriveStatus(
      meta({ exitCode: 0, lastActivityAt: finishedAt }),
      clientWith([
        assistantTurn({
          created: finishedAt - 30_000,
          completed: finishedAt - 1_000,
          text: "done",
        }),
      ]),
    );
    expect(status).toBe("done");
  });

  test("a resumed session does not report the previous run's exit", async () => {
    const finishedAt = NOW - 600_000;
    const status = await deriveStatus(
      meta({ exitCode: 1, lastActivityAt: finishedAt }),
      clientWith([
        assistantTurn({ created: finishedAt - 30_000, completed: finishedAt }),
        assistantTurn({ created: NOW - 5_000, text: "working" }),
      ]),
    );
    expect(status).toBe("running");
  });

  test("recorded outcome wins when there is no daemon to ask", async () => {
    expect(await deriveStatus(meta({ abortedAt: NOW - 60_000 }))).toBe(
      "aborted",
    );
    expect(await deriveStatus(meta({ exitCode: 2 }))).toBe("failed");
  });

  test("a finished session skips the message fetch entirely", async () => {
    const finishedAt = NOW - 60_000;
    const { client, messageFetches } = clientWithActivity(finishedAt - 100);
    const status = await deriveStatus(
      meta({ exitCode: 0, lastActivityAt: finishedAt }),
      client,
    );
    expect(status).toBe("done");
    expect(messageFetches()).toBe(0);
  });

  test("a finished session the daemon has touched since still fetches", async () => {
    const finishedAt = NOW - 600_000;
    const { client, messageFetches } = clientWithActivity(NOW - 5_000, [
      assistantTurn({ created: finishedAt - 30_000, completed: finishedAt }),
      assistantTurn({ created: NOW - 5_000, text: "working" }),
    ]);
    const status = await deriveStatus(
      meta({ exitCode: 0, lastActivityAt: finishedAt }),
      client,
    );
    expect(status).toBe("running");
    expect(messageFetches()).toBe(1);
  });

  test("recorded outcome wins when the daemon call fails", async () => {
    const status = await deriveStatus(
      meta({ abortedAt: NOW - 60_000 }),
      brokenClient,
    );
    expect(status).toBe("aborted");
  });
});

describe("deriveStatus live signals", () => {
  test("a pending question reports waiting", async () => {
    const status = await deriveStatus(
      meta({ lastActivityAt: NOW - 5_000 }),
      clientWith([assistantTurn({ created: NOW - 5_000, text: "asking" })]),
      [question("ses_test")],
    );
    expect(status).toBe("waiting");
  });

  test("a pending question does not resurrect an aborted session", async () => {
    const abortedAt = NOW - 60_000;
    const status = await deriveStatus(
      meta({ abortedAt, lastActivityAt: abortedAt }),
      clientWith([assistantTurn({ created: abortedAt - 30_000 })]),
      [question("ses_test")],
    );
    expect(status).toBe("aborted");
  });

  test("a completed final turn reports done", async () => {
    const status = await deriveStatus(
      meta({ lastActivityAt: NOW - 5_000 }),
      clientWith([
        assistantTurn({ created: NOW - 30_000, completed: NOW - 5_000 }),
      ]),
    );
    expect(status).toBe("done");
  });

  test("an empty turn with no recent activity reports stalled", async () => {
    const status = await deriveStatus(
      meta({ lastActivityAt: NOW - 10 * 60_000 }),
      clientWith([assistantTurn({ created: NOW - 10 * 60_000 })]),
    );
    expect(status).toBe("stalled");
  });

  test("an in-flight turn with recent activity reports running", async () => {
    const status = await deriveStatus(
      meta({ lastActivityAt: NOW - 5_000 }),
      clientWith([assistantTurn({ created: NOW - 5_000, text: "thinking" })]),
    );
    expect(status).toBe("running");
  });
});

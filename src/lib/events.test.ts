import { describe, expect, test } from "bun:test";
import { type DaemonEvent, eventSessionId, subscribeEvents } from "./events.ts";

/** Serve a fixed set of SSE chunks so frame splitting can be tested directly. */
function serve(chunks: Array<string>): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  return { url: server.url.origin, stop: () => server.stop(true) };
}

async function collect(url: string): Promise<Array<DaemonEvent>> {
  const events: Array<DaemonEvent> = [];
  for await (const event of subscribeEvents(url)) events.push(event);
  return events;
}

describe("subscribeEvents", () => {
  test("parses one frame per blank-line-separated block", async () => {
    const { url, stop } = serve([
      'data: {"type":"server.connected","properties":{}}\n\n',
      'data: {"type":"session.status","properties":{"sessionID":"ses_a"}}\n\n',
    ]);
    try {
      const events = await collect(url);
      expect(events.map((e) => e.type)).toEqual([
        "server.connected",
        "session.status",
      ]);
      expect(eventSessionId(events[1] as DaemonEvent)).toBe("ses_a");
    } finally {
      stop();
    }
  });

  test("reassembles a frame split across reads", async () => {
    const { url, stop } = serve([
      'data: {"type":"message.part.',
      'updated","properties":{"sessionID":"ses_b"}}\n',
      "\n",
    ]);
    try {
      const events = await collect(url);
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("message.part.updated");
      expect(eventSessionId(events[0] as DaemonEvent)).toBe("ses_b");
    } finally {
      stop();
    }
  });

  test("skips malformed frames instead of ending the stream", async () => {
    const { url, stop } = serve([
      "data: not json\n\n",
      ": a comment line\n\n",
      'data: {"type":"session.idle","properties":{}}\n\n',
    ]);
    try {
      const events = await collect(url);
      expect(events.map((e) => e.type)).toEqual(["session.idle"]);
    } finally {
      stop();
    }
  });

  test("eventSessionId is null when the event is not session-scoped", () => {
    expect(
      eventSessionId({ type: "server.heartbeat", properties: {} }),
    ).toBeNull();
  });
});

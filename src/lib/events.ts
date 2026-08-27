/**
 * The daemon's global SSE feed (`GET /event`). It carries every session's
 * activity, tagged with `sessionID` — there is no usable per-session stream
 * (`/api/session/:id/event` accepts the connection and never responds), so
 * subscribers filter client-side.
 */
export type DaemonEvent = {
  type: string;
  properties: Record<string, unknown>;
};

export function eventSessionId(event: DaemonEvent): string | null {
  const id = event.properties.sessionID;
  return typeof id === "string" ? id : null;
}

/**
 * Yield events as they arrive. The connection stays open until the caller stops
 * iterating (`break`/`return`) or `signal` aborts, at which point the response
 * body is released.
 */
export async function* subscribeEvents(
  daemonUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<DaemonEvent> {
  const res = await fetch(new URL("/event", daemonUrl), {
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`opencode /event failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; a frame may span reads.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function parseFrame(frame: string): DaemonEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as Partial<DaemonEvent>;
    if (typeof parsed.type !== "string") return null;
    return {
      type: parsed.type,
      properties:
        typeof parsed.properties === "object" && parsed.properties !== null
          ? (parsed.properties as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

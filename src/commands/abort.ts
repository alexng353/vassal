import { makeClient } from "../lib/opencode.ts";
import { getSession, readDaemonState, writeSession } from "../lib/state.ts";

export async function runAbort(sessionId: string): Promise<number> {
  const meta = await getSession(sessionId);
  if (!meta) {
    console.error(`unknown session: ${sessionId}`);
    return 1;
  }

  const daemon = await readDaemonState();
  if (!daemon) {
    console.error("no daemon running; nothing to abort");
    return 1;
  }

  const client = makeClient(daemon);
  const res = await client.session.abort({ path: { id: sessionId } });
  if (res.error !== undefined) {
    console.error(`abort failed: ${describeError(res.error)}`);
    return 1;
  }

  const now = Date.now();
  await writeSession({ ...meta, abortedAt: now, lastActivityAt: now });

  console.log(`aborted session ${sessionId}`);
  return 0;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

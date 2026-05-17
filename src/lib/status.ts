import { listSessionMessages, type OpencodeClient } from "./opencode.ts";
import type { SessionMeta } from "./types.ts";

export type Status = "running" | "stalled" | "done" | "failed" | "aborted";

const NO_PARTS_STALL_MS = 2 * 60_000;
const ZOMBIE_STALL_MS = 60 * 60_000;

export async function deriveStatus(
  meta: SessionMeta,
  client?: OpencodeClient,
): Promise<Status> {
  if (meta.abortedAt) return "aborted";
  if (meta.exitCode === 0) return "done";
  if (typeof meta.exitCode === "number") return "failed";
  if (!client) return "running";

  let messages: Array<AssistantTurn>;
  try {
    messages = await listSessionMessages(client, meta.id);
  } catch {
    return "running";
  }
  const last = lastAssistantTurn(messages);
  if (last && turnCompleted(last)) return "done";
  const sinceActivity = Date.now() - meta.lastActivityAt;
  if (!last || partsAreEmpty(last.parts)) {
    if (sinceActivity > NO_PARTS_STALL_MS) return "stalled";
  } else if (sinceActivity > ZOMBIE_STALL_MS) {
    return "stalled";
  }

  return "running";
}

function turnCompleted(turn: AssistantTurn): boolean {
  if (turn.info.role !== "assistant") return false;
  return typeof turn.info.time.completed === "number";
}

type AssistantTurn = Awaited<ReturnType<typeof listSessionMessages>>[number];

function lastAssistantTurn(
  messages: Array<AssistantTurn>,
): AssistantTurn | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.info.role === "assistant") return message;
  }
  return null;
}

function partsAreEmpty(parts: AssistantTurn["parts"]): boolean {
  return (
    parts.length === 0 ||
    parts.every((part) => part.type !== "text" || part.text.trim() === "")
  );
}

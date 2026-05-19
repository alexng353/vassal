import { existsSync } from "node:fs";
import {
  listPendingQuestions,
  listSessionMessages,
  type OpencodeClient,
  type PendingQuestion,
} from "./opencode.ts";
import type { SessionMeta } from "./types.ts";

export type Status =
  | "running"
  | "stalled"
  | "done"
  | "failed"
  | "aborted"
  | "waiting";

const NO_PARTS_STALL_MS = 2 * 60_000;
const ZOMBIE_STALL_MS = 60 * 60_000;

export async function deriveStatus(
  meta: SessionMeta,
  client?: OpencodeClient,
  pendingQuestions?: Array<PendingQuestion>,
): Promise<Status> {
  if (meta.abortedAt) return "aborted";
  if (meta.exitCode === 0) return "done";
  if (typeof meta.exitCode === "number") return "failed";
  if (pendingQuestions?.some((question) => question.sessionID === meta.id)) {
    return "waiting";
  }
  if (!client) return "running";

  let messages: Array<AssistantTurn>;
  try {
    messages = await listSessionMessages(client, meta.id);
  } catch {
    return "running";
  }
  const last = lastAssistantTurn(messages);
  if (last && turnCompleted(last)) return "done";
  const sinceActivity = Date.now() - latestActivityAt(meta, messages);
  if (!last || partsAreEmpty(last.parts)) {
    if (sinceActivity > NO_PARTS_STALL_MS) return "stalled";
  } else if (sinceActivity > ZOMBIE_STALL_MS) {
    return "stalled";
  }

  return "running";
}

export async function listPendingQuestionsForStatus(
  daemonUrl: string,
): Promise<Array<PendingQuestion>> {
  try {
    return await listPendingQuestions(daemonUrl);
  } catch {
    return [];
  }
}

export function worktreeMissing(meta: SessionMeta): boolean {
  return meta.worktree !== null && !existsSync(meta.worktree);
}

function turnCompleted(turn: AssistantTurn): boolean {
  if (turn.info.role !== "assistant") return false;
  return typeof turn.info.time.completed === "number";
}

type AssistantTurn = Awaited<ReturnType<typeof listSessionMessages>>[number];

type PartWithTime = AssistantTurn["parts"][number] & {
  time?: { start?: number; end?: number; created?: number };
  state?: { time?: { start?: number; end?: number; created?: number } };
};

function latestActivityAt(
  meta: SessionMeta,
  messages: Array<AssistantTurn>,
): number {
  let latest = meta.lastActivityAt;
  for (const message of messages) {
    latest = Math.max(latest, message.info.time.created);
    if ("completed" in message.info.time) {
      latest = Math.max(latest, message.info.time.completed ?? 0);
    }
    for (const part of message.parts) {
      latest = Math.max(latest, latestPartTime(part));
    }
  }
  return latest;
}

function latestPartTime(part: AssistantTurn["parts"][number]): number {
  const timed = part as PartWithTime;
  return Math.max(
    timed.time?.start ?? 0,
    timed.time?.end ?? 0,
    timed.time?.created ?? 0,
    timed.state?.time?.start ?? 0,
    timed.state?.time?.end ?? 0,
    timed.state?.time?.created ?? 0,
  );
}

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

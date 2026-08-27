import type { Part } from "@opencode-ai/sdk";
import { resolveIdOrAlias } from "../lib/alias.ts";
import { ensureDaemon } from "../lib/daemon.ts";
import { resolveSessionModel } from "../lib/model.ts";
import {
  listPendingQuestions,
  listSessionMessages,
  makeClient,
  modelFromMessages,
  type SessionMessage,
} from "../lib/opencode.ts";
import { formatDispatchResult } from "../lib/output.ts";
import { getSession } from "../lib/state.ts";
import { deriveStatus, type Status } from "../lib/status.ts";
import { type SessionMeta, sessionDirectory } from "../lib/types.ts";

const POLL_INTERVAL_MS = 2_000;
const TERMINAL: ReadonlySet<Status> = new Set(["done", "failed", "aborted"]);

export async function runAttach(input: string): Promise<number> {
  const initial = await resolveIdOrAlias(input);
  if (!initial) {
    console.error(`unknown session: ${input}`);
    return 1;
  }

  const { state: daemon } = await ensureDaemon();
  const client = makeClient(daemon);

  let meta: SessionMeta = initial;
  let lastReported: Status | null = null;
  let status: Status;

  while (true) {
    const refreshed = await getSession(meta.id);
    if (refreshed) meta = refreshed;

    const questions = await listPendingQuestions(
      daemon.url,
      sessionDirectory(meta),
    ).catch(() => []);
    status = await deriveStatus(meta, client, questions);

    if (status !== lastReported) {
      if (status === "waiting") {
        console.error(
          `vassal: session ${input} is waiting on a question — run \`vassal answer ${input} ...\``,
        );
      } else if (status === "stalled") {
        console.error(
          `vassal: session ${input} is stalled (no activity) — still polling`,
        );
      }
      lastReported = status;
    }

    if (TERMINAL.has(status)) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const messages = await listSessionMessages(client, meta.id);
  const lastAssistant = lastAssistantTurn(messages);
  const finalText = lastAssistant ? extractFinalText(lastAssistant.parts) : "";
  const cost = assistantCost(lastAssistant) ?? meta.cost ?? null;
  const exitCode = exitFromStatus(status, meta);
  const { model, effort } = resolveSessionModel(
    meta,
    modelFromMessages(messages),
  );

  console.log(
    formatDispatchResult({
      sessionId: meta.id,
      alias: meta.alias ?? null,
      worktree: meta.worktree,
      finalText,
      cost,
      exitCode,
      model,
      effort,
    }),
  );
  return exitCode;
}

function exitFromStatus(status: Status, meta: SessionMeta): number {
  if (status === "done") return 0;
  if (status === "failed") return meta.exitCode ?? 1;
  return 1;
}

function lastAssistantTurn(
  messages: Array<SessionMessage>,
): SessionMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.info.role === "assistant") return m;
  }
  return null;
}

function assistantCost(turn: SessionMessage | null): number | null {
  if (!turn || turn.info.role !== "assistant") return null;
  const cost = (turn.info as { cost?: number | null }).cost;
  return typeof cost === "number" ? cost : null;
}

function extractFinalText(parts: Array<Part>): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { Part } from "@opencode-ai/sdk";
import { displayId, resolveIdOrAlias } from "../lib/alias.ts";
import { ensureDaemon } from "../lib/daemon.ts";
import {
  type DaemonEvent,
  eventSessionId,
  subscribeEvents,
} from "../lib/events.ts";
import {
  listPendingQuestions,
  listSessionMessages,
  makeClient,
  type OpencodeClient,
  type PendingQuestion,
  type SessionMessage,
} from "../lib/opencode.ts";
import { formatDispatchResult } from "../lib/output.ts";
import { PartRenderer, type RenderedLine } from "../lib/render.ts";
import { BoxSink, PlainSink, type StreamSink } from "../lib/sink.ts";
import { getSession } from "../lib/state.ts";
import { deriveStatus, type Status } from "../lib/status.ts";
import { type SessionMeta, sessionDirectory } from "../lib/types.ts";

const BACKFILL_LINES = 100;
const TERMINAL: ReadonlySet<Status> = new Set(["done", "failed", "aborted"]);
/**
 * The event feed goes quiet between turns as well as at the end of one, so a
 * quiet session gets its status re-derived on this interval rather than only on
 * an event. Without it a session that finished while we were mid-render would
 * hold the stream open indefinitely.
 */
const IDLE_RECHECK_MS = 5_000;

export type StreamOptions = { human?: boolean };

export async function runStream(
  input: string,
  options: StreamOptions = {},
): Promise<number> {
  const initial = await resolveIdOrAlias(input);
  if (!initial) {
    console.error(`unknown session: ${input}`);
    return 1;
  }

  const { state: daemon } = await ensureDaemon();
  const client = makeClient(daemon);
  const renderer = new PartRenderer();
  const sink: StreamSink = options.human
    ? new BoxSink(displayId(initial))
    : new PlainSink();
  let meta = initial;

  // Subscribe before backfilling. The feed only carries what happens after the
  // connection opens, so opening it second would drop everything that landed
  // while we were fetching history.
  const abort = new AbortController();
  const events = subscribeEvents(daemon.url, abort.signal);

  const messages = await listSessionMessages(client, meta.id);
  sink.lines(backfill(messages, renderer));

  let status = await currentStatus(meta, client, daemon.url);
  sink.state({ status, label: displayId(meta), cost: meta.cost });

  let reportedQuestion: string | null = null;
  // Announce a question the moment we know about one — including a session that
  // was already blocked before we attached, which otherwise looks like a stall
  // until the next idle tick.
  const reportQuestion = async (): Promise<void> => {
    if (status !== "waiting") return;
    const question = await pendingQuestion(meta, daemon.url);
    if (!question || question.id === reportedQuestion) return;
    reportedQuestion = question.id;
    sink.lines(questionLines(question, displayId(meta)));
  };
  await reportQuestion();

  try {
    if (!TERMINAL.has(status)) {
      for await (const event of withIdleTicks(events, IDLE_RECHECK_MS)) {
        if (event && eventSessionId(event) !== meta.id) continue;

        if (event) {
          sink.lines(renderEvent(event, renderer));
          sink.typing(renderer.pending());
          if (!isTerminalSignal(event)) continue;
        }

        const refreshed = await getSession(meta.id);
        if (refreshed) meta = refreshed;
        status = await currentStatus(meta, client, daemon.url);
        sink.state({ status, label: displayId(meta), cost: meta.cost });

        await reportQuestion();
        if (TERMINAL.has(status)) break;
      }
    }

    abort.abort();
    sink.lines(renderer.flush());
  } finally {
    sink.close();
  }

  const final = await listSessionMessages(client, meta.id).catch(
    () => messages,
  );
  const lastAssistant = lastAssistantTurn(final);
  const exitCode = exitFromStatus(status, meta);
  console.log(
    formatDispatchResult({
      sessionId: meta.id,
      alias: meta.alias ?? null,
      worktree: meta.worktree,
      finalText: lastAssistant ? finalText(lastAssistant.parts) : "",
      cost: assistantCost(lastAssistant) ?? meta.cost ?? null,
      exitCode,
    }),
  );
  return exitCode;
}

/**
 * The tail of the session so far, capped to roughly a screenful. Attaching
 * mid-turn should show what led here without replaying an hour of history.
 */
function backfill(
  messages: Array<SessionMessage>,
  renderer: PartRenderer,
): Array<RenderedLine> {
  const lines: Array<RenderedLine> = [];
  for (const message of messages) {
    if (message.info.role !== "assistant") continue;
    for (const part of message.parts) lines.push(...renderer.render(part));
  }
  lines.push(...renderer.flush());

  if (lines.length <= BACKFILL_LINES) return lines;
  return [
    {
      kind: "meta",
      text: `… ${lines.length - BACKFILL_LINES} earlier lines`,
    },
    ...lines.slice(-BACKFILL_LINES),
  ];
}

function renderEvent(
  event: DaemonEvent,
  renderer: PartRenderer,
): Array<RenderedLine> {
  if (event.type !== "message.part.updated") return [];
  const part = event.properties.part as Part | undefined;
  return part ? renderer.render(part) : [];
}

/**
 * Events that mean the session may have reached a terminal state. Everything
 * else is pure output and must not trigger a status round trip.
 */
function isTerminalSignal(event: DaemonEvent): boolean {
  if (event.type === "session.status") {
    const status = event.properties.status as { type?: string } | undefined;
    return status?.type !== "busy";
  }
  return event.type === "session.idle" || event.type === "message.updated";
}

async function currentStatus(
  meta: SessionMeta,
  client: OpencodeClient,
  daemonUrl: string,
): Promise<Status> {
  const questions = await listPendingQuestions(
    daemonUrl,
    sessionDirectory(meta),
  ).catch(() => []);
  return deriveStatus(meta, client, questions);
}

async function pendingQuestion(
  meta: SessionMeta,
  daemonUrl: string,
): Promise<PendingQuestion | null> {
  const questions = await listPendingQuestions(
    daemonUrl,
    sessionDirectory(meta),
  ).catch(() => []);
  return questions.find((q) => q.sessionID === meta.id) ?? null;
}

function questionLines(
  request: PendingQuestion,
  sessionLabel: string,
): Array<RenderedLine> {
  const lines: Array<RenderedLine> = [
    { kind: "ask", text: `pending question ${request.id}` },
  ];
  for (const question of request.questions) {
    lines.push({
      kind: "ask",
      text: `${question.header}: ${question.question}`,
    });
    for (const option of question.options) {
      lines.push({ kind: "ask", text: `  - ${option.label}` });
    }
  }
  lines.push({
    kind: "ask",
    text: `answer: vassal answer ${sessionLabel} <label>`,
  });
  return lines;
}

/**
 * The event feed with a periodic `null` mixed in, so a caller that only wakes on
 * events still gets a chance to re-check a session that went quiet.
 */
async function* withIdleTicks(
  events: AsyncGenerator<DaemonEvent>,
  intervalMs: number,
): AsyncGenerator<DaemonEvent | null> {
  let next = events.next();
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<"tick">((resolve) => {
      timer = setTimeout(() => resolve("tick"), intervalMs);
    });
    const winner = await Promise.race([next, tick]);
    clearTimeout(timer);

    if (winner === "tick") {
      yield null;
      continue;
    }
    if (winner.done) return;
    yield winner.value;
    next = events.next();
  }
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

function finalText(parts: Array<Part>): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

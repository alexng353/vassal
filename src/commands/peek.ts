import type { Part } from "@opencode-ai/sdk";
import { displayId, resolveIdOrAlias } from "../lib/alias.ts";
import { ensureDaemon } from "../lib/daemon.ts";
import { formatModelLabel, resolveSessionModel } from "../lib/model.ts";
import {
  listPendingQuestions,
  listSessionMessages,
  makeClient,
  modelFromMessages,
  type PendingQuestion,
  type SessionMessage,
} from "../lib/opencode.ts";
import { deriveStatus, latestActivityAt } from "../lib/status.ts";
import { sessionDirectory } from "../lib/types.ts";

const MAX_TEXT_CHARS = 400;
const MAX_INPUT_CHARS = 200;

export async function runPeek(input: string): Promise<number> {
  const meta = await resolveIdOrAlias(input);
  if (!meta) {
    console.error(`unknown session: ${input}`);
    return 1;
  }

  const { state: daemon } = await ensureDaemon();
  const client = makeClient(daemon);

  const messages = await listSessionMessages(client, meta.id);
  const questions = await listPendingQuestions(
    daemon.url,
    sessionDirectory(meta),
  );
  const pendingQuestion = questions.find(
    (question) => question.sessionID === meta.id,
  );
  const last = selectAssistantTurn(messages);
  const status = await deriveStatus(meta, client, questions);

  console.log(`SESSION ${displayId(meta)}`);
  if (meta.alias) console.log(`ID ${meta.id}`);
  console.log(`TITLE ${meta.title}`);
  const observed = resolveSessionModel(meta, modelFromMessages(messages));
  console.log(`MODEL ${formatModelLabel(observed.model, observed.effort)}`);
  console.log(`STATUS ${status}`);
  console.log(
    `LAST ${new Date(latestActivityAt(meta, messages)).toISOString()}`,
  );
  console.log(`COST $${meta.cost.toFixed(4)}`);
  console.log("---");

  if (pendingQuestion) {
    printPendingQuestion(pendingQuestion);
    console.log("");
  }

  const lastUser = lastUserMessage(messages);
  if (lastUser) {
    console.log("LAST USER:");
    for (const line of formatPrompt(lastUser.parts)) console.log(`  ${line}`);
    console.log("");
  }

  if (!last) {
    console.log("LAST ASSISTANT: (none)");
    return 0;
  }

  console.log("LAST ASSISTANT:");
  if (last.staleTurn) {
    console.log(
      "  (newest turn has no parts yet — showing the turn before it)",
    );
  }
  const lines = formatAssistantParts(last.turn.parts);
  if (lines.length === 0) {
    console.log("  (no parts yet)");
  } else {
    for (const line of lines) console.log(`  ${line}`);
  }

  return 0;
}

function printPendingQuestion(request: PendingQuestion): void {
  console.log(`PENDING QUESTION ${request.id}`);
  for (const question of request.questions) {
    console.log(`  header:   ${question.header}`);
    console.log(`  question: ${question.question}`);
    console.log("  options:");
    for (const option of question.options) {
      const suffix = option.description ? `  (${option.description})` : "";
      console.log(`    - ${option.label}${suffix}`);
    }
  }
}

export type SelectedTurn = {
  turn: SessionMessage;
  /** True when the newest assistant turn was empty and we fell back to an older one. */
  staleTurn: boolean;
};

/**
 * Pick the assistant turn worth showing.
 *
 * opencode inserts an assistant row at `step-start`, before any part lands, so
 * peeking inside that window would otherwise render an empty turn and read as
 * "wedged" to the orchestrator. Fall back to the newest turn that actually has
 * something to show, and say so.
 */
export function selectAssistantTurn(
  messages: Array<SessionMessage>,
): SelectedTurn | null {
  let newest: SessionMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.info.role !== "assistant") continue;
    if (newest === null) newest = m;
    if (formatAssistantParts(m.parts).length > 0) {
      return { turn: m, staleTurn: m !== newest };
    }
  }
  return newest === null ? null : { turn: newest, staleTurn: false };
}

function lastUserMessage(
  messages: Array<SessionMessage>,
): SessionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.info.role === "user") return m;
  }
  return null;
}

function formatPrompt(parts: Array<Part>): Array<string> {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
  if (!text) return ["(no text)"];
  return truncate(text, MAX_TEXT_CHARS).split("\n");
}

function formatAssistantParts(parts: Array<Part>): Array<string> {
  const lines: Array<string> = [];
  for (const part of parts) {
    if (part.type === "text") {
      const text = part.text.trim();
      if (text) lines.push(`text:      ${truncate(text, MAX_TEXT_CHARS)}`);
    } else if (part.type === "reasoning") {
      const text = part.text.trim();
      if (text) lines.push(`reasoning: ${truncate(text, MAX_TEXT_CHARS)}`);
    } else if (part.type === "tool") {
      lines.push(formatToolPart(part));
    }
  }
  return lines;
}

function formatToolPart(part: Extract<Part, { type: "tool" }>): string {
  const status = part.state.status;
  const title =
    "title" in part.state && part.state.title
      ? part.state.title
      : summarizeInput(
          "input" in part.state
            ? (part.state.input as Record<string, unknown>)
            : {},
        );
  const suffix = title ? ` — ${truncate(title, MAX_INPUT_CHARS)}` : "";
  return `tool:      ${part.tool} (${status})${suffix}`;
}

function summarizeInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  const preferred = ["file_path", "path", "command", "pattern", "query"];
  for (const key of preferred) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

import type { Part } from "@opencode-ai/sdk";
import { ensureDaemon } from "../lib/daemon.ts";
import {
  listSessionMessages,
  makeClient,
  type SessionMessage,
} from "../lib/opencode.ts";
import { getSession } from "../lib/state.ts";
import { deriveStatus } from "../lib/status.ts";

const MAX_TEXT_CHARS = 400;
const MAX_INPUT_CHARS = 200;

export async function runPeek(sessionId: string): Promise<number> {
  const meta = await getSession(sessionId);
  if (!meta) {
    console.error(`unknown session: ${sessionId}`);
    return 1;
  }

  const { state: daemon } = await ensureDaemon();
  const client = makeClient(daemon);

  const messages = await listSessionMessages(client, sessionId);
  const last = lastAssistantTurn(messages);
  const status = await deriveStatus(meta, client);

  console.log(`SESSION ${meta.id}`);
  console.log(`TITLE ${meta.title}`);
  console.log(`STATUS ${status}`);
  console.log(`LAST ${new Date(meta.lastActivityAt).toISOString()}`);
  console.log(`COST $${meta.cost.toFixed(4)}`);
  console.log("---");

  const lastUser = lastUserMessage(messages);
  if (lastUser) {
    console.log("LAST USER:");
    for (const line of formatPrompt(lastUser.parts)) console.log(`  ${line}`);
    console.log("");
  }

  if (last) {
    console.log("LAST ASSISTANT:");
    const lines = formatAssistantParts(last.parts);
    if (lines.length === 0) {
      console.log("  (no parts yet)");
    } else {
      for (const line of lines) console.log(`  ${line}`);
    }
  } else {
    console.log("LAST ASSISTANT: (none)");
  }

  return 0;
}

function lastAssistantTurn(
  messages: Array<SessionMessage>,
): SessionMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.info.role === "assistant") return m;
  }
  return null;
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

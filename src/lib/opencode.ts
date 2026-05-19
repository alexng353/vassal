import type { Message, Part } from "@opencode-ai/sdk";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { DaemonState } from "./types.ts";

export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

export type PendingQuestion = {
  id: string;
  sessionID: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
  tool?: { messageID: string; callID: string };
};

export function makeClient(daemon: DaemonState): OpencodeClient {
  return createOpencodeClient({ baseUrl: daemon.url });
}

export async function createSession(
  client: OpencodeClient,
  title: string,
  cwd: string,
): Promise<string> {
  const res = await client.session.create({
    body: { title },
    query: { directory: cwd },
  });
  if (!res.data) {
    throw new Error(
      `opencode session.create failed: ${describeError(res.error)}`,
    );
  }
  return res.data.id;
}

export type PromptOptions = {
  sessionId: string;
  prompt: string;
  cwd: string;
  model?: string;
};

export type PromptOutcome = {
  finalText: string;
  cost: number | null;
};

export async function sendPrompt(
  client: OpencodeClient,
  opts: PromptOptions,
): Promise<PromptOutcome> {
  const [providerID, modelID] = (opts.model ?? "openai/gpt-5.5").split("/");
  if (!providerID || !modelID) {
    throw new Error(
      `invalid model "${opts.model}" — expected "<provider>/<model>"`,
    );
  }

  const res = await client.session.prompt({
    path: { id: opts.sessionId },
    query: { directory: opts.cwd },
    body: {
      model: { providerID, modelID },
      parts: [{ type: "text", text: opts.prompt }],
    },
  });

  if (!res.data) {
    throw new Error(
      `opencode session.prompt failed: ${describeError(res.error)}`,
    );
  }

  return {
    finalText: extractFinalText(res.data.parts),
    cost: res.data.info.cost ?? null,
  };
}

function extractFinalText(parts: Array<Part>): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export type SessionMessage = {
  info: Message;
  parts: Array<Part>;
};

export async function listSessionMessages(
  client: OpencodeClient,
  sessionId: string,
): Promise<Array<SessionMessage>> {
  const res = await client.session.messages({ path: { id: sessionId } });
  if (!res.data) {
    throw new Error(
      `opencode session.messages failed: ${describeError(res.error)}`,
    );
  }
  return res.data;
}

export async function listOpencodeSessions(
  client: OpencodeClient,
): Promise<Array<{ id: string; title: string }>> {
  const res = await client.session.list();
  if (!res.data) return [];
  return res.data.map((s) => ({ id: s.id, title: s.title }));
}

export async function listPendingQuestions(
  daemonUrl: string,
): Promise<Array<PendingQuestion>> {
  return fetchJson<Array<PendingQuestion>>(daemonUrl, "/question", {
    method: "GET",
  });
}

export async function replyQuestion(
  daemonUrl: string,
  requestId: string,
  answers: Array<Array<string>>,
): Promise<void> {
  await fetchJson(daemonUrl, `/question/${requestId}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers }),
  });
}

export async function rejectQuestion(
  daemonUrl: string,
  requestId: string,
): Promise<void> {
  await fetchJson(daemonUrl, `/question/${requestId}/reject`, {
    method: "POST",
  });
}

async function fetchJson<T = unknown>(
  daemonUrl: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(new URL(path, daemonUrl), {
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`opencode ${path} failed: ${err.message}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function describeError(err: unknown): string {
  if (err === undefined) return "unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

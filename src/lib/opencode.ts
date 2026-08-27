import type { Message, Part } from "@opencode-ai/sdk";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { resolveModelSpec, splitModel } from "./model.ts";
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
  effort?: string;
};

export type PromptOutcome = {
  finalText: string;
  cost: number | null;
};

export async function sendPrompt(
  client: OpencodeClient,
  opts: PromptOptions,
): Promise<PromptOutcome> {
  const { model, effort } = resolveModelSpec(opts.model, opts.effort);
  const { providerID, modelID } = splitModel(model);

  await validateEffort(client, providerID, modelID, effort, opts.cwd);

  const body = {
    model: { providerID, modelID },
    variant: effort,
    parts: [{ type: "text" as const, text: opts.prompt }],
  };

  const res = await client.session.prompt({
    path: { id: opts.sessionId },
    query: { directory: opts.cwd },
    body,
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

type ProviderCatalog = {
  all: Array<{
    id: string;
    models: Record<string, { variants?: Record<string, unknown> }>;
  }>;
};

async function validateEffort(
  client: OpencodeClient,
  providerID: string,
  modelID: string,
  effort: string,
  cwd: string,
): Promise<void> {
  const res = await client.provider.list({ query: { directory: cwd } });
  if (!res.data) {
    throw new Error(
      `opencode provider.list failed: ${describeError(res.error)}`,
    );
  }

  const catalog = res.data as unknown as ProviderCatalog;
  const provider = catalog.all.find((item) => item.id === providerID);
  const model = provider?.models[modelID];
  if (!model) {
    throw new Error(`model "${providerID}/${modelID}" is not available`);
  }

  const available = Object.keys(model.variants ?? {});
  if (!available.includes(effort)) {
    throw new Error(
      `effort "${effort}" is not supported by ${providerID}/${modelID}; available: ${available.join(", ") || "none"}`,
    );
  }
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

/**
 * The `provider/model` of the newest assistant turn — what the daemon actually
 * ran, as opposed to what vassal recorded. Sessions from before vassal tracked
 * the model have nothing on disk, and this is the only place to learn it.
 */
export function modelFromMessages(
  messages: Array<SessionMessage>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info;
    if (!info || info.role !== "assistant") continue;
    if (!info.providerID || !info.modelID) continue;
    return `${info.providerID}/${info.modelID}`;
  }
  return null;
}

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

/**
 * The daemon's own `time.updated` for a session — a ~600 byte response, versus
 * the megabyte of message history `listSessionMessages` pulls down. Used to
 * decide whether the expensive fetch can tell us anything new at all.
 * Returns null when the daemon can't answer, so callers fall back to messages.
 */
export async function getSessionActivityAt(
  client: OpencodeClient,
  sessionId: string,
): Promise<number | null> {
  try {
    const res = await client.session.get({ path: { id: sessionId } });
    return res.data?.time.updated ?? null;
  } catch {
    return null;
  }
}

export async function listOpencodeSessions(
  client: OpencodeClient,
): Promise<Array<{ id: string; title: string }>> {
  const res = await client.session.list();
  if (!res.data) return [];
  return res.data.map((s) => ({ id: s.id, title: s.title }));
}

/**
 * The daemon keeps pending questions per *project*, resolved from a `directory`
 * query param, and falls back to whatever directory it was started in when the
 * param is missing. Since every worktree dispatch runs somewhere other than the
 * daemon's own cwd, omitting it hides the question entirely: `/question` comes
 * back empty, `answer` reports "no pending question", and the session sits
 * wedged on an `ask()` that nothing can reach. Always pass the session's
 * working directory.
 */
export async function listPendingQuestions(
  daemonUrl: string,
  directory: string,
): Promise<Array<PendingQuestion>> {
  return fetchJson<Array<PendingQuestion>>(
    daemonUrl,
    withDirectory("/question", directory),
    { method: "GET" },
  );
}

export async function replyQuestion(
  daemonUrl: string,
  requestId: string,
  answers: Array<Array<string>>,
  directory: string,
): Promise<void> {
  await fetchJson(
    daemonUrl,
    withDirectory(`/question/${requestId}/reply`, directory),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    },
  );
}

export async function rejectQuestion(
  daemonUrl: string,
  requestId: string,
  directory: string,
): Promise<void> {
  await fetchJson(
    daemonUrl,
    withDirectory(`/question/${requestId}/reject`, directory),
    { method: "POST" },
  );
}

export function withDirectory(path: string, directory: string): string {
  return `${path}?directory=${encodeURIComponent(directory)}`;
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

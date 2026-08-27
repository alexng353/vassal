import { describe, expect, test } from "bun:test";
import type { SessionMessage } from "../lib/opencode.ts";
import { selectAssistantTurn } from "./peek.ts";

const NOW = Date.now();

function assistant(parts: SessionMessage["parts"]): SessionMessage {
  return {
    info: { role: "assistant", time: { created: NOW } },
    parts,
  } as unknown as SessionMessage;
}

function user(text: string): SessionMessage {
  return {
    info: { role: "user", time: { created: NOW } },
    parts: [{ type: "text", text }],
  } as unknown as SessionMessage;
}

const textPart = (text: string) =>
  ({ type: "text", text }) as unknown as SessionMessage["parts"][number];

const stepStart = () =>
  ({ type: "step-start" }) as unknown as SessionMessage["parts"][number];

const toolPart = () =>
  ({
    type: "tool",
    tool: "bash",
    state: { status: "running", input: { command: "ls" } },
  }) as unknown as SessionMessage["parts"][number];

describe("selectAssistantTurn", () => {
  test("returns null when there is no assistant turn", () => {
    expect(selectAssistantTurn([user("hi")])).toBeNull();
  });

  test("returns the newest turn when it has parts", () => {
    const newest = assistant([textPart("done")]);
    const selected = selectAssistantTurn([
      assistant([textPart("older")]),
      newest,
    ]);
    expect(selected?.turn).toBe(newest);
    expect(selected?.staleTurn).toBe(false);
  });

  test("falls back to the previous turn while the newest is still empty", () => {
    const older = assistant([textPart("older")]);
    const selected = selectAssistantTurn([older, assistant([])]);
    expect(selected?.turn).toBe(older);
    expect(selected?.staleTurn).toBe(true);
  });

  test("treats a turn holding only step-start as empty", () => {
    const older = assistant([textPart("older")]);
    const selected = selectAssistantTurn([older, assistant([stepStart()])]);
    expect(selected?.turn).toBe(older);
    expect(selected?.staleTurn).toBe(true);
  });

  test("does not fall back once a tool call lands in the newest turn", () => {
    const newest = assistant([stepStart(), toolPart()]);
    const selected = selectAssistantTurn([
      assistant([textPart("older")]),
      newest,
    ]);
    expect(selected?.turn).toBe(newest);
    expect(selected?.staleTurn).toBe(false);
  });

  test("skips over user messages when looking back", () => {
    const older = assistant([textPart("older")]);
    const selected = selectAssistantTurn([
      older,
      user("follow-up"),
      assistant([]),
    ]);
    expect(selected?.turn).toBe(older);
    expect(selected?.staleTurn).toBe(true);
  });

  test("reports the newest empty turn when nothing has content", () => {
    const only = assistant([]);
    const selected = selectAssistantTurn([user("go"), only]);
    expect(selected?.turn).toBe(only);
    expect(selected?.staleTurn).toBe(false);
  });
});

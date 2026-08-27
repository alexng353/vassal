import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk";
import { PartRenderer } from "./render.ts";

function textPart(id: string, text: string): Part {
  return { id, sessionID: "ses_x", messageID: "msg_x", type: "text", text };
}

function toolPart(id: string, tool: string, status: string): Part {
  return {
    id,
    sessionID: "ses_x",
    messageID: "msg_x",
    type: "tool",
    callID: `call_${id}`,
    tool,
    state: { status, input: { file_path: "src/cli.ts" } },
  } as unknown as Part;
}

describe("PartRenderer", () => {
  test("emits only the text added since the last render", () => {
    const renderer = new PartRenderer();
    expect(
      renderer.render(textPart("p1", "first\n")).map((l) => l.text),
    ).toEqual(["first"]);
    expect(
      renderer.render(textPart("p1", "first\nsecond\n")).map((l) => l.text),
    ).toEqual(["second"]);
  });

  test("holds a partial line until its newline arrives", () => {
    const renderer = new PartRenderer();
    expect(renderer.render(textPart("p1", "half"))).toEqual([]);
    expect(renderer.pending()?.text).toBe("half");
    expect(
      renderer.render(textPart("p1", "half a line\n")).map((l) => l.text),
    ).toEqual(["half a line"]);
    expect(renderer.pending()).toBeNull();
  });

  test("flush releases a trailing line that never got a newline", () => {
    const renderer = new PartRenderer();
    renderer.render(textPart("p1", "no trailing newline"));
    expect(renderer.flush().map((l) => l.text)).toEqual([
      "no trailing newline",
    ]);
    expect(renderer.flush()).toEqual([]);
  });

  test("a flushed line is not re-emitted when the part updates again", () => {
    const renderer = new PartRenderer();
    renderer.render(textPart("p1", "done thinking"));
    expect(renderer.flush().map((l) => l.text)).toEqual(["done thinking"]);
    expect(renderer.render(textPart("p1", "done thinking"))).toEqual([]);
  });

  test("multi-line text marks continuations", () => {
    const renderer = new PartRenderer();
    const lines = renderer.render(textPart("p1", "one\ntwo\n"));
    expect(lines.map((l) => [l.text, l.continuation ?? false])).toEqual([
      ["one", false],
      ["two", true],
    ]);
  });

  test("reasoning renders as think", () => {
    const renderer = new PartRenderer();
    const part = {
      id: "p1",
      sessionID: "ses_x",
      messageID: "msg_x",
      type: "reasoning",
      text: "weighing options\n",
      time: { start: 0 },
    } as unknown as Part;
    expect(renderer.render(part)[0]?.kind).toBe("think");
  });

  test("a tool prints once per status, not once per update", () => {
    const renderer = new PartRenderer();
    const running = renderer.render(toolPart("t1", "read", "running"));
    expect(running).toHaveLength(1);
    expect(running[0]?.text).toBe("read (running) — src/cli.ts");

    expect(renderer.render(toolPart("t1", "read", "running"))).toEqual([]);
    expect(renderer.render(toolPart("t1", "read", "completed"))).toHaveLength(
      1,
    );
  });
});

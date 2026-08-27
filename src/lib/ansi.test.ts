import { describe, expect, test } from "bun:test";
import { ansi, stripAnsi, wrapLine } from "./ansi.ts";

const visible = (lines: Array<string>) => lines.map(stripAnsi);

describe("wrapLine", () => {
  test("breaks at spaces rather than mid-word", () => {
    const lines = visible(wrapLine("the quick brown fox jumps", 12));
    expect(lines).toEqual(["the quick", "brown fox", "jumps"]);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(12);
  });

  test("never leaves a leading space on a wrapped line", () => {
    for (const line of visible(wrapLine("alpha beta gamma delta", 11))) {
      expect(line.startsWith(" ")).toBe(false);
    }
  });

  test("splits a word that is longer than the whole width", () => {
    expect(visible(wrapLine("supercalifragilistic", 8))).toEqual([
      "supercal",
      "ifragili",
      "stic",
    ]);
  });

  test("a long word after a break moves to its own line first", () => {
    expect(visible(wrapLine("hi supercalifragilistic", 8))).toEqual([
      "hi",
      "supercal",
      "ifragili",
      "stic",
    ]);
  });

  test("text that fits is returned untouched", () => {
    expect(wrapLine("short", 20)).toEqual(["short"]);
  });

  test("ANSI codes do not count toward the width", () => {
    const lines = wrapLine(`${ansi.bold("the quick")} brown fox`, 12);
    expect(visible(lines)).toEqual(["the quick", "brown fox"]);
  });

  test("styling carries onto the continuation line", () => {
    const [, second] = wrapLine(ansi.bold("the quick brown fox"), 12);
    expect(second).toContain("\x1b[1m");
    expect(stripAnsi(second ?? "")).toBe("brown fox");
  });

  test("a zero or negative width is a no-op instead of looping", () => {
    expect(wrapLine("anything", 0)).toEqual(["anything"]);
  });
});

import { describe, expect, test } from "bun:test";
import { stripAnsi } from "./ansi.ts";
import { BoxModel } from "./box.ts";

const COLS = 60;

/** Capture what a box writes to the terminal. */
function capture(fn: (box: BoxModel) => void): string {
  const box = new BoxModel(4);
  const original = process.stdout.write;
  let out = "";
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a stream method
  process.stdout.write = ((chunk: any) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn(box);
  } finally {
    process.stdout.write = original;
  }
  return out;
}

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";

function contentRows(box: BoxModel): Array<string> {
  return stripAnsi(box.render(COLS))
    .split("\n")
    .filter((line) => line.startsWith("│"))
    .map((line) => line.slice(1, -1).trim())
    .filter((line) => line.length > 0);
}

describe("BoxModel", () => {
  test("the preview row is never committed by a following line", () => {
    const box = new BoxModel(10);
    box.updateCurrent("half a thought");
    box.clearCurrent();
    box.addLine("tool ran");
    box.updateCurrent("half a thought");
    box.clearCurrent();
    box.addLine("tool ran again");

    // The preview appeared twice but must not be stamped into the box at all —
    // this is the repeat-every-tool-call bug the sink used to produce.
    expect(contentRows(box)).toEqual(["tool ran", "tool ran again"]);
  });

  test("the preview row renders below committed lines", () => {
    const box = new BoxModel(10);
    box.addLine("committed");
    box.updateCurrent("in progress");
    expect(contentRows(box)).toEqual(["committed", "in progress"]);
  });

  test("a replaced preview does not stack", () => {
    const box = new BoxModel(10);
    box.updateCurrent("first draft");
    box.updateCurrent("second draft");
    expect(contentRows(box)).toEqual(["second draft"]);
  });

  test("content is clipped to the configured height", () => {
    const box = new BoxModel(3);
    for (let i = 1; i <= 6; i++) box.addLine(`line ${i}`);
    expect(contentRows(box)).toEqual(["line 4", "line 5", "line 6"]);
  });

  test("an explicit height caps the box even in a tall terminal", () => {
    expect(new BoxModel(5).totalHeight).toBe(8);
  });

  test("a frame is exactly totalHeight rows, chin or no chin", () => {
    const box = new BoxModel(6);
    const rows = (s: string) => s.split("\n").length - 1;

    // The first frame is drawn before any chin tag is set. If it were shorter
    // than totalHeight, the next draw would rewind too far and overwrite the
    // line above the box — the command that launched the stream.
    expect(rows(box.render(COLS))).toBe(box.totalHeight);

    box.setChin([{ label: "ses_x" }, { label: "running" }]);
    expect(rows(box.render(COLS))).toBe(box.totalHeight);
  });

  test("frame height is stable as content grows", () => {
    const box = new BoxModel(4);
    const rows = (s: string) => s.split("\n").length - 1;
    const empty = rows(box.render(COLS));
    for (let i = 0; i < 20; i++) box.addLine(`line ${i}`);
    box.updateCurrent("in progress");
    expect(rows(box.render(COLS))).toBe(empty);
  });

  test("no row is ever wider than the terminal", () => {
    // An over-wide row wraps onto a second physical row, so the frame occupies
    // more rows than it emitted and every later rewind lands one row short —
    // which is how a stray `┌` survives the erase.
    const longTitle = "ses_energy-senator-dinnerware-brushes-civilian";
    for (const cols of [200, 120, 80, 60, 50, 40, 30, 20, 12]) {
      const box = new BoxModel(4);
      box.title = longTitle;
      box.setChin([
        { label: longTitle },
        { label: "running" },
        { label: "42m31s" },
        { label: "$0.0000" },
        { label: "520k↑ 21k↓" },
      ]);
      box.addLine("x".repeat(300));

      const rows = box
        .render(cols)
        .split("\n")
        .slice(0, -1)
        .map((r) => stripAnsi(r).length);
      expect({ cols, over: rows.filter((w) => w > cols) }).toEqual({
        cols,
        over: [],
      });
    }
  });

  test("a title too wide for the border is clipped, not overflowed", () => {
    const box = new BoxModel(2);
    box.title = "an-extremely-long-session-alias-that-will-not-fit";
    const border = stripAnsi(box.render(30).split("\n")[0] ?? "");
    expect(border.length).toBe(30);
    expect(border).toContain("…");
  });

  test("never moves the cursor relative to the previous frame", () => {
    // Every rewind-by-recorded-height scheme breaks on resize: the terminal
    // reflows what is already on screen, so the recorded height stops matching
    // and frames stack instead of replacing. Frames are absolute or nothing.
    const out = capture((box) => {
      box.draw(COLS);
      box.addLine("more");
      box.draw(40);
      box.draw(120);
    });
    expect(out).not.toMatch(/\x1b\[\d*A/);
    expect(out.split("\x1b[H").length - 1).toBe(3);
  });

  test("enters the alternate screen once and leaves it on close", () => {
    const out = capture((box) => {
      box.draw(COLS);
      box.draw(COLS);
      box.draw(COLS);
      box.flush();
    });
    expect(out.split(ENTER_ALT).length - 1).toBe(1);
    expect(out.split(LEAVE_ALT).length - 1).toBe(1);
    expect(out.indexOf(ENTER_ALT)).toBeLessThan(out.indexOf(LEAVE_ALT));
  });

  test("close restores the cursor and wrapping even if nothing was drawn", () => {
    const out = capture((box) => box.flush());
    expect(out).not.toContain(LEAVE_ALT);
    expect(out).toContain("\x1b[?25h");
    expect(out).toContain("\x1b[?7h");
  });

  test("close is safe to call twice", () => {
    const out = capture((box) => {
      box.draw(COLS);
      box.flush();
      box.flush();
    });
    expect(out.split(LEAVE_ALT).length - 1).toBe(1);
  });

  test("the chin renders below the frame", () => {
    const box = new BoxModel(2);
    box.setChin([{ label: "ses_x" }, { label: "running" }]);
    const rendered = stripAnsi(box.render(COLS));
    expect(rendered).toContain("ses_x  ·  running");
  });
});

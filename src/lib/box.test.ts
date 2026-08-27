import { describe, expect, test } from "bun:test";
import { stripAnsi } from "./ansi.ts";
import { BoxModel } from "./box.ts";

const COLS = 60;

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

  test("the chin renders below the frame", () => {
    const box = new BoxModel(2);
    box.setChin([{ label: "ses_x" }, { label: "running" }]);
    const rendered = stripAnsi(box.render(COLS));
    expect(rendered).toContain("ses_x  ·  running");
  });
});

import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  test("passes the text through the renderer", async () => {
    expect(await renderMarkdown("# hi\n", ["cat"])).toBe("# hi");
  });

  test("falls back to the raw text when the renderer is missing", async () => {
    // No mdr on PATH must never cost the human their summary.
    expect(await renderMarkdown("summary", ["vassal-no-such-renderer"])).toBe(
      "summary",
    );
  });

  test("falls back when the renderer exits non-zero", async () => {
    expect(await renderMarkdown("summary", ["false"])).toBe("summary");
  });

  test("falls back when the renderer writes nothing", async () => {
    expect(await renderMarkdown("summary", ["true"])).toBe("summary");
  });

  test("empty text is not piped anywhere", async () => {
    expect(await renderMarkdown("", ["vassal-no-such-renderer"])).toBe("");
    expect(await renderMarkdown("   \n", ["vassal-no-such-renderer"])).toBe(
      "   \n",
    );
  });
});

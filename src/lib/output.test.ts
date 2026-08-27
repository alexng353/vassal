import { expect, test } from "bun:test";
import { formatCost, formatDispatchResult } from "./output.ts";

test("formatCost prints a metered figure and hides a zero one", () => {
  expect(formatCost(0.0421)).toBe("$0.0421");
  expect(formatCost(0.0421, 2)).toBe("$0.04");
  // Zero means the turn was billed to a subscription; null means unknown.
  expect(formatCost(0)).toBe("-");
  expect(formatCost(null)).toBe("-");
});

test("the dispatch contract carries model and effort", () => {
  expect(
    formatDispatchResult({
      sessionId: "ses_raw",
      alias: "ses_a-b-c-d-e",
      worktree: null,
      finalText: "done",
      cost: 0,
      exitCode: 0,
      model: "openai/gpt-5.6-sol",
      effort: "xhigh",
    }),
  ).toBe(
    [
      "SESSION ses_a-b-c-d-e",
      "WORKTREE -",
      "MODEL Sol XH",
      "COST -",
      "EXIT 0",
      "---",
      "done",
    ].join("\n"),
  );
});

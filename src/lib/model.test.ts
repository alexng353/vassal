import { describe, expect, test } from "bun:test";
import {
  formatModelLabel,
  resolveModelSpec,
  resolveSessionModel,
  shortModelName,
  splitModel,
} from "./model.ts";

describe("shortModelName", () => {
  test("names an OpenAI variant by the variant alone", () => {
    expect(shortModelName("openai/gpt-5.6-sol")).toBe("Sol");
    expect(shortModelName("openai/gpt-5.6-codex")).toBe("Codex");
  });

  test("keeps the family when there is no variant", () => {
    expect(shortModelName("openai/gpt-5.6")).toBe("GPT-5.6");
    expect(shortModelName("openai/gpt-6")).toBe("GPT-6");
  });

  test("leaves an unfamiliar model as its id", () => {
    expect(shortModelName("anthropic/claude-opus-5")).toBe("claude-opus-5");
    expect(shortModelName("openai/o3-pro")).toBe("o3-pro");
  });
});

describe("formatModelLabel", () => {
  test("pairs the short name with an abbreviated effort", () => {
    expect(formatModelLabel("openai/gpt-5.6-sol", "xhigh")).toBe("Sol XH");
    expect(formatModelLabel("openai/gpt-5.6-sol", "medium")).toBe("Sol M");
  });

  test("uppercases an effort it has no abbreviation for", () => {
    expect(formatModelLabel("openai/gpt-5.6-sol", "ultra")).toBe("Sol ULTRA");
  });

  test("drops the effort when there is none, and reads - with no model", () => {
    expect(formatModelLabel("openai/gpt-5.6-sol")).toBe("Sol");
    expect(formatModelLabel(null, "xhigh")).toBe("-");
  });
});

describe("resolveSessionModel", () => {
  const meta = { model: "openai/gpt-5.6-sol", effort: "high" };

  test("keeps the recorded effort when the observed model agrees", () => {
    expect(resolveSessionModel(meta, "openai/gpt-5.6-sol")).toEqual({
      model: "openai/gpt-5.6-sol",
      effort: "high",
    });
  });

  test("drops the effort when the daemon ran a different model", () => {
    expect(resolveSessionModel(meta, "openai/gpt-5.6")).toEqual({
      model: "openai/gpt-5.6",
      effort: null,
    });
  });

  test("falls back to the recorded pair with nothing observed", () => {
    expect(resolveSessionModel(meta, null)).toEqual({
      model: "openai/gpt-5.6-sol",
      effort: "high",
    });
  });

  test("reports an unrecorded session's observed model without effort", () => {
    expect(resolveSessionModel({}, "openai/gpt-5.6-sol")).toEqual({
      model: "openai/gpt-5.6-sol",
      effort: null,
    });
    expect(resolveSessionModel({})).toEqual({ model: null, effort: null });
  });
});

describe("splitModel", () => {
  test("splits provider from model", () => {
    expect(splitModel("openai/gpt-5.6-sol")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
    });
  });

  test("rejects a spec with no provider", () => {
    expect(() => splitModel("gpt-5.6-sol")).toThrow('expected "<provider>/');
  });
});

test("resolveModelSpec applies the dispatch defaults", () => {
  expect(resolveModelSpec()).toEqual({
    model: "openai/gpt-5.6-sol",
    effort: "xhigh",
  });
  expect(resolveModelSpec("openai/gpt-5.6", "low")).toEqual({
    model: "openai/gpt-5.6",
    effort: "low",
  });
});

import { describe, expect, test } from "bun:test";
import { type OpencodeClient, sendPrompt } from "./opencode.ts";

const PROVIDERS = {
  all: [
    {
      id: "openai",
      models: {
        "gpt-5.5": {
          variants: {
            none: { reasoningEffort: "none" },
            low: { reasoningEffort: "low" },
            medium: { reasoningEffort: "medium" },
            high: { reasoningEffort: "high" },
            xhigh: { reasoningEffort: "xhigh" },
          },
        },
        "gpt-6-astra": {
          variants: {
            none: { reasoningEffort: "none" },
            low: { reasoningEffort: "low" },
            medium: { reasoningEffort: "medium" },
            high: { reasoningEffort: "high" },
            xhigh: { reasoningEffort: "xhigh" },
          },
        },
      },
    },
  ],
};

function clientWithProviders() {
  const prompts: Array<Record<string, unknown>> = [];
  let providerRequests = 0;
  const client = {
    provider: {
      list: async () => {
        providerRequests += 1;
        return { data: PROVIDERS };
      },
    },
    session: {
      prompt: async (input: Record<string, unknown>) => {
        prompts.push(input);
        return {
          data: {
            info: { cost: 0 },
            parts: [{ type: "text", text: "ok" }],
          },
        };
      },
    },
  } as unknown as OpencodeClient;
  return { client, prompts, providerRequests: () => providerRequests };
}

describe("sendPrompt effort", () => {
  test("forwards a provider-supported effort as the model variant", async () => {
    const { client, prompts } = clientWithProviders();

    await sendPrompt(client, {
      sessionId: "session",
      prompt: "task",
      cwd: "/repo",
      model: "openai/gpt-5.5",
      effort: "xhigh",
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      body: {
        model: { providerID: "openai", modelID: "gpt-5.5" },
        variant: "xhigh",
      },
    });
  });

  test("rejects an unsupported effort before sending the prompt", async () => {
    const { client, prompts } = clientWithProviders();

    const result = sendPrompt(client, {
      sessionId: "session",
      prompt: "task",
      cwd: "/repo",
      model: "openai/gpt-5.5",
      effort: "maximum",
    });

    await expect(result).rejects.toThrow(
      'effort "maximum" is not supported by openai/gpt-5.5; available: none, low, medium, high, xhigh',
    );
    expect(prompts).toHaveLength(0);
  });

  test("defaults to GPT-6 Astra with xhigh effort", async () => {
    const { client, prompts, providerRequests } = clientWithProviders();

    await sendPrompt(client, {
      sessionId: "session",
      prompt: "task",
      cwd: "/repo",
    });

    expect(providerRequests()).toBe(1);
    expect(prompts[0]).toMatchObject({
      body: {
        model: { providerID: "openai", modelID: "gpt-6-astra" },
        variant: "xhigh",
      },
    });
  });
});

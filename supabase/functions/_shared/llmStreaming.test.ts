import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ streamText: vi.fn(), generateText: vi.fn(), createOpenAI: vi.fn() }));
vi.mock("https://esm.sh/ai@4.3.19?deps=zod@3.23.8,zod-to-json-schema@3.23.5", () => ({
  ...sdk, tool: (value: unknown) => value, embedMany: vi.fn(),
}));
vi.mock("https://esm.sh/@ai-sdk/openai@1.3.24?deps=zod@3.23.8,zod-to-json-schema@3.23.5", () => ({
  createOpenAI: (options: unknown) => {
    sdk.createOpenAI(options);
    return Object.assign(() => "model", { responses: () => "model" });
  },
}));
vi.mock("https://esm.sh/zod@3.23.8", async () => {
  const { z } = await import("zod");
  return { z };
});

import { generateAgentTextStream, generateChatText, generateChatTextStream } from "./llm";

function stream(text: string, steps: Array<{ promptTokens: number; completionTokens: number }>) {
  return (options: { onStepFinish: (step: { usage: typeof steps[number] }) => void }) => {
    async function* parts() {
      for (const usage of steps) options.onStepFinish({ usage });
      if (text) yield { type: "text-delta", textDelta: text };
    }
    return {
      fullStream: parts(),
      textStream: (async function* () { for await (const part of parts()) yield part.textDelta; })(),
      finishReason: Promise.resolve("stop"), response: Promise.resolve({ messages: [] }),
    };
  };
}

describe("streaming wrapper usage", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sums every agent step and the answer-only fallback without counting totals twice", async () => {
    sdk.streamText.mockImplementationOnce(stream("", [
      { promptTokens: 10, completionTokens: 2 }, { promptTokens: 20, completionTokens: 3 },
    ])).mockImplementationOnce(stream("answer", [{ promptTokens: 30, completionTokens: 4 }]));
    const onUsage = vi.fn();
    const result = await generateAgentTextStream({
      apiKey: "test", model: "test", messages: [], maxSteps: 2,
      tool: { name: "search", description: "test", queryDescription: "test", execute: async () => "" },
      onTextDelta: vi.fn(), onReset: vi.fn(), onToolCall: vi.fn(), onUsage,
    });
    expect(result).toEqual({ text: "answer", usage: { promptTokens: 60, completionTokens: 9 } });
    expect(onUsage).toHaveBeenCalledTimes(3);
  });

  it("includes an empty stream's usage and its non-streaming retry", async () => {
    sdk.streamText.mockImplementationOnce(stream("", [{ promptTokens: 10, completionTokens: 1 }]));
    sdk.generateText.mockResolvedValueOnce({ text: "retry", finishReason: "stop", usage: { promptTokens: 20, completionTokens: 2 } });
    expect(await generateChatTextStream({ apiKey: "test", model: "test", messages: [] }))
      .toEqual({ text: "retry", usage: { promptTokens: 30, completionTokens: 3 } });
  });

  it("marks usage unknown if the provider fails, even after completed steps", async () => {
    sdk.streamText.mockImplementationOnce((options) => ({
      fullStream: (async function* () {
        options.onStepFinish({ usage: { promptTokens: 10, completionTokens: 2 } });
        yield { type: "error", error: new Error("provider failed") };
      })(),
    }));
    const onUsage = vi.fn();
    await expect(generateAgentTextStream({
      apiKey: "test", model: "test", messages: [], maxSteps: 2,
      tool: { name: "search", description: "test", queryDescription: "test", execute: async () => "" },
      onTextDelta: vi.fn(), onReset: vi.fn(), onToolCall: vi.fn(), onUsage,
    })).rejects.toThrow("provider failed");
    expect(onUsage).toHaveBeenLastCalledWith({ promptTokens: null, completionTokens: null });
  });

  it("reports usage for auxiliary non-streaming model calls", async () => {
    sdk.generateText.mockResolvedValueOnce({ text: "repair", finishReason: "stop", usage: { promptTokens: 12, completionTokens: 3 } });
    const onUsage = vi.fn();
    expect(await generateChatText({ apiKey: "test", model: "test", messages: [], onUsage })).toBe("repair");
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 12, completionTokens: 3 });
    expect(sdk.createOpenAI).toHaveBeenCalledWith({ apiKey: "test", compatibility: "strict", fetch: expect.any(Function) });
  });
});

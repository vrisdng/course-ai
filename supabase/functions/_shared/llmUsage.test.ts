import { describe, expect, it } from "vitest";
import { mergeTokenUsage, normalizeTokenUsage, type TokenUsage } from "./llmUsage";

describe("model token usage", () => {
  it("adds each agent step and fallback once", () => {
    const steps = [{ promptTokens: 10, completionTokens: 2 }, { promptTokens: 30, completionTokens: 5 }];
    const agent = steps.reduce<TokenUsage>(mergeTokenUsage, { promptTokens: 0, completionTokens: 0 });
    expect(mergeTokenUsage(agent, { promptTokens: 50, completionTokens: 8 }))
      .toEqual({ promptTokens: 90, completionTokens: 15 });
  });

  it("keeps missing or invalid usage unknown rather than reporting a partial total", () => {
    expect(normalizeTokenUsage({ promptTokens: NaN, completionTokens: undefined }))
      .toEqual({ promptTokens: null, completionTokens: null });
    expect(mergeTokenUsage({ promptTokens: 10, completionTokens: 2 }, normalizeTokenUsage(undefined)))
      .toEqual({ promptTokens: null, completionTokens: null });
    expect(normalizeTokenUsage({ promptTokens: -1, completionTokens: 0 }))
      .toEqual({ promptTokens: null, completionTokens: 0 });
  });
});

import { describe, expect, it } from "vitest";

import {
  buildOpenAIProviderOptions,
  requireGeneratedText,
} from "./llmConfig.ts";

describe("buildOpenAIProviderOptions", () => {
  it("omits reasoning options unless the caller explicitly requests them", () => {
    expect(buildOpenAIProviderOptions()).toBeUndefined();
  });

  it("passes through an explicit reasoning effort", () => {
    expect(buildOpenAIProviderOptions("medium")).toEqual({
      openai: { reasoningEffort: "medium" },
    });
  });
});

describe("requireGeneratedText", () => {
  it("returns trimmed generated text", () => {
    expect(requireGeneratedText("  grounded answer  ", "gpt-4o", "stop")).toBe("grounded answer");
  });

  it("throws a diagnostic error for an empty provider response", () => {
    expect(() => requireGeneratedText("   ", "gpt-4o", "length")).toThrowError(
      /gpt-4o.*empty text.*length/i,
    );
  });
});

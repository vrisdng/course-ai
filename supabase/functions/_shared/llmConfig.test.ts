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
    expect(requireGeneratedText("  grounded answer  ", "gpt-5.6-terra", "stop")).toBe("grounded answer");
  });

  it("throws a diagnostic error for an empty provider response", () => {
    expect(() => requireGeneratedText("   ", "gpt-5.6-terra", "length")).toThrowError(
      /gpt-5\.6-terra.*empty text.*length/i,
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  buildDocumentExtractionMessages,
  buildOpenAIProviderOptions,
  buildPageImageMessages,
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

describe("buildDocumentExtractionMessages", () => {
  it("sends PDFs as a file part after the prompt", () => {
    expect(buildDocumentExtractionMessages("extract", { base64Data: "QUJD", mimeType: "application/pdf", filename: "deck.pdf" })).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "extract" },
          { type: "file", data: "QUJD", mimeType: "application/pdf", filename: "deck.pdf" },
        ],
      },
    ]);
  });

  it("sends raster images as an image part", () => {
    const [message] = buildDocumentExtractionMessages("extract", { base64Data: "QUJD", mimeType: "image/PNG", filename: "a.png" });
    expect(message.content[1]).toEqual({ type: "image", image: "QUJD", mimeType: "image/png" });
  });

  it("rejects document types OpenAI cannot take as input", () => {
    expect(() => buildDocumentExtractionMessages("x", { base64Data: "QUJD", mimeType: "application/msword", filename: "a.doc" }))
      .toThrowError(/Unsupported document type/);
  });
});

describe("buildPageImageMessages", () => {
  it("labels each page image with its page number, after the prompt", () => {
    const messages = buildPageImageMessages("Extract blocks.", [
      { pageNumber: 3, base64Data: "AAA", mimeType: "image/webp" },
      { pageNumber: 4, base64Data: "BBB", mimeType: "image/webp" },
    ]);

    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Extract blocks." },
          { type: "text", text: "[Page 3]" },
          { type: "image", image: "AAA", mimeType: "image/webp" },
          { type: "text", text: "[Page 4]" },
          { type: "image", image: "BBB", mimeType: "image/webp" },
        ],
      },
    ]);
  });

  it("rejects an empty page list", () => {
    expect(() => buildPageImageMessages("x", [])).toThrow("No page images");
  });
});

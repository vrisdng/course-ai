import { describe, expect, it, vi } from "vitest";

import {
  adaptReasoningRequestBody,
  buildAgentProviderOptions,
  buildDocumentExtractionMessages,
  buildOpenAIProviderOptions,
  buildPageImageMessages,
  createReasoningRequestFetch,
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

describe("buildAgentProviderOptions", () => {
  it("never stores agent turns on OpenAI's side", () => {
    expect(buildAgentProviderOptions()).toEqual({ openai: { store: false } });
  });

  it("adds reasoning effort only when requested", () => {
    expect(buildAgentProviderOptions("low")).toEqual({ openai: { store: false, reasoningEffort: "low" } });
  });
});

describe("requireGeneratedText", () => {
  it("returns trimmed generated text", () => {
    expect(requireGeneratedText("  grounded answer  ", "gpt-6.1-sol", "stop")).toBe("grounded answer");
  });

  it("throws a diagnostic error for an empty provider response", () => {
    expect(() => requireGeneratedText("   ", "gpt-6.1-sol", "length")).toThrowError(
      /gpt-6\.1-sol.*empty text.*length/i,
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

describe("adaptReasoningRequestBody", () => {
  const CHAT_URL = "https://api.openai.com/v1/chat/completions";
  const RESPONSES_URL = "https://api.openai.com/v1/responses";

  it("gives a Chat Completions request the reasoning-model shape", () => {
    const adapted = adaptReasoningRequestBody(CHAT_URL, {
      model: "gpt-6-luna",
      temperature: 0,
      top_p: 1,
      max_tokens: 32_000,
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    });

    expect(adapted).toEqual({
      model: "gpt-6-luna",
      max_completion_tokens: 32_000,
      messages: [{ role: "developer", content: "s" }, { role: "user", content: "u" }],
    });
  });

  it("keeps an explicit max_completion_tokens over max_tokens", () => {
    const adapted = adaptReasoningRequestBody(CHAT_URL, { model: "gpt-6-luna", max_tokens: 10, max_completion_tokens: 20, messages: [] });

    expect(adapted).toEqual({ model: "gpt-6-luna", max_completion_tokens: 20, messages: [] });
  });

  it("gives a Responses request the reasoning-model shape and effort", () => {
    const adapted = adaptReasoningRequestBody(
      RESPONSES_URL,
      { model: "gpt-6.1-sol", temperature: 0.4, store: false, input: [{ role: "system", content: "s" }, { type: "function_call_output", call_id: "c", output: "o" }] },
      { reasoningEffort: "minimal" },
    );

    expect(adapted).toEqual({
      model: "gpt-6.1-sol",
      store: false,
      reasoning: { effort: "low" },
      input: [{ role: "developer", content: "s" }, { type: "function_call_output", call_id: "c", output: "o" }],
    });
  });

  it("keeps other reasoning options on a Responses request", () => {
    const adapted = adaptReasoningRequestBody(
      RESPONSES_URL,
      { model: "gpt-6-astra", reasoning: { summary: "auto" }, input: [] },
      { reasoningEffort: "xhigh" },
    );

    expect(adapted.reasoning).toEqual({ summary: "auto", effort: "xhigh" });
  });

  it("is a no-op on an already adapted request", () => {
    const once = adaptReasoningRequestBody(CHAT_URL, { model: "gpt-6-luna", temperature: 0, messages: [{ role: "system", content: "s" }] });

    expect(adaptReasoningRequestBody(CHAT_URL, once)).toEqual(once);
  });

  it("keeps temperature only when reasoning is turned off", () => {
    const adapted = adaptReasoningRequestBody(CHAT_URL, { model: "gpt-6-luna", temperature: 0.2, messages: [] }, { reasoningEffort: "none" });

    expect(adapted).toEqual({ model: "gpt-6-luna", temperature: 0.2, reasoning_effort: "none", messages: [] });
  });

  it("leaves models outside the registry and other endpoints untouched", () => {
    const unknown = { model: "gpt-unlisted", temperature: 0.3, messages: [{ role: "system", content: "s" }] };
    expect(adaptReasoningRequestBody(CHAT_URL, unknown)).toEqual(unknown);

    const embedding = { model: "gpt-6-luna", input: ["x"] };
    expect(adaptReasoningRequestBody("https://api.openai.com/v1/embeddings", embedding)).toEqual(embedding);
  });

  it("rejects an effort the model does not support", () => {
    expect(() => adaptReasoningRequestBody(CHAT_URL, { model: "gpt-6-astra", messages: [] }, { reasoningEffort: "none" }))
      .toThrowError(/gpt-6-astra.*none/);
  });
});

describe("createReasoningRequestFetch", () => {
  it("rewrites JSON bodies before handing the request to the real fetch", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const adaptedFetch = createReasoningRequestFetch({}, baseFetch);

    await adaptedFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-6-luna", temperature: 0, messages: [] }),
    });

    const [, init] = baseFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ model: "gpt-6-luna", messages: [] });
  });

  it("passes non-JSON bodies through unchanged", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const adaptedFetch = createReasoningRequestFetch({}, baseFetch);
    const init = { method: "POST", body: "not json" };

    await adaptedFetch("https://api.openai.com/v1/chat/completions", init);

    expect(baseFetch).toHaveBeenCalledWith("https://api.openai.com/v1/chat/completions", init);
  });
});

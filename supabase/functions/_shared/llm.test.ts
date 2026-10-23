// Runs the real pinned AI SDK (aliased from esm.sh in vitest.config.ts)
// against a stubbed fetch, and checks the request bodies that would reach
// OpenAI. No network calls are made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createOpenAIEmbeddingService,
  generateAgentTextStream,
  generateChatText,
  generateChatTextStream,
  generateDocumentText,
  generatePageImagesText,
} from "./llm.ts";
import { CHAT_TIER_MODELS, TASK_MODELS } from "./models.ts";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let requests: CapturedRequest[];
let respond: (request: CapturedRequest) => Response;

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

const sse = (events: unknown[]): Response =>
  new Response(
    events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const chatCompletion = (text: string) =>
  json({
    id: "chatcmpl-1",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });

const chatCompletionStream = (text: string) =>
  sse([
    { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    "[DONE]",
  ]);

const responsesStream = (text: string) =>
  sse([
    { type: "response.created", response: { id: "resp_1", created_at: 1, model: "m" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message" } },
    { type: "response.output_text.delta", delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message" } },
    { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } },
  ]);

const messages = [
  { role: "system" as const, content: "You are a tutor." },
  { role: "user" as const, content: "What is a beam?" },
];

const PARAMETERS_REJECTED_BY_REASONING_MODELS = ["temperature", "top_p", "max_tokens", "logprobs", "top_logprobs"];

function expectReasoningSafe(body: Record<string, unknown>) {
  for (const key of PARAMETERS_REJECTED_BY_REASONING_MODELS) {
    expect(body).not.toHaveProperty(key);
  }
}

function rolesOf(body: Record<string, unknown>): string[] {
  const items = (body.messages ?? body.input) as Array<{ role?: string }>;
  return items.filter((item) => item.role).map((item) => item.role as string);
}

beforeEach(() => {
  requests = [];
  respond = () => chatCompletion("ok");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = { url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      requests.push(request);
      return respond(request);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateChatText", () => {
  it.each(Object.entries(CHAT_TIER_MODELS))(
    "sends the %s tier's model a request it accepts",
    async (_tier, spec) => {
      const text = await generateChatText({ apiKey: "test", model: spec.id, messages, temperature: 0.4, maxOutputTokens: 2000 });

      expect(text).toBe("ok");
      expect(requests).toHaveLength(1);
      const [{ url, body }] = requests;
      expect(url).toMatch(/\/chat\/completions$/);
      expect(body.model).toBe(spec.id);
      expectReasoningSafe(body);
      expect(rolesOf(body)).toEqual(["developer", "user"]);
      // Reasoning effort is the model's own default unless a caller asks.
      expect(body).not.toHaveProperty("reasoning_effort");
    },
  );

  it("sends an explicitly requested reasoning effort", async () => {
    await generateChatText({ apiKey: "test", model: CHAT_TIER_MODELS.smart.id, messages, reasoningEffort: "high" });

    expect(requests[0].body.reasoning_effort).toBe("high");
  });

  it("sends low for minimal on a model without minimal", async () => {
    await generateChatText({ apiKey: "test", model: CHAT_TIER_MODELS.smart.id, messages, reasoningEffort: "minimal" });

    expect(requests[0].body.reasoning_effort).toBe("low");
  });

  it("refuses an unsupported reasoning effort before calling OpenAI", async () => {
    await expect(
      generateChatText({ apiKey: "test", model: CHAT_TIER_MODELS.pro.id, messages, reasoningEffort: "none" }),
    ).rejects.toThrowError(/gpt-6-astra.*none/);
    expect(requests).toHaveLength(0);
  });

  it("keeps temperature when the model runs with reasoning off", async () => {
    await generateChatText({ apiKey: "test", model: CHAT_TIER_MODELS.fast.id, messages, temperature: 0.2, reasoningEffort: "none" });

    expect(requests[0].body).toMatchObject({ reasoning_effort: "none", temperature: 0.2 });
  });

  it("leaves requests for models outside the registry as the SDK built them", async () => {
    await generateChatText({ apiKey: "test", model: "gpt-unlisted", messages, temperature: 0.3 });

    expect(requests[0].body.temperature).toBe(0.3);
    expect(rolesOf(requests[0].body)).toEqual(["system", "user"]);
  });
});

describe("generateChatTextStream", () => {
  it("streams from the current analytics model with a reasoning-safe request", async () => {
    respond = () => chatCompletionStream("streamed");
    const deltas: string[] = [];

    const { text } = await generateChatTextStream({
      apiKey: "test",
      model: TASK_MODELS.analyticsChat.id,
      messages,
      temperature: 0.3,
      maxOutputTokens: 2000,
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(text).toBe("streamed");
    expect(deltas).toEqual(["streamed"]);
    const { body } = requests[0];
    // Strict compatibility asks for usage on the stream; the adapter keeps it.
    expect(body).toMatchObject({ model: "gpt-6-luna", stream: true, stream_options: { include_usage: true } });
    expectReasoningSafe(body);
    expect(rolesOf(body)).toEqual(["developer", "user"]);
  });
});

describe("generateAgentTextStream", () => {
  const tool = {
    name: "search_course_materials",
    description: "Search the course.",
    queryDescription: "Search query.",
    execute: vi.fn(async () => "no results"),
  };

  it("runs the answer tier on the Responses API with an accepted request", async () => {
    respond = () => responsesStream("An answer.");

    const { text } = await generateAgentTextStream({
      apiKey: "test",
      model: CHAT_TIER_MODELS.smart.id,
      messages,
      tool,
      maxSteps: 5,
      temperature: 0.4,
      onTextDelta: () => {},
      onReset: () => {},
      onToolCall: () => {},
    });

    expect(text).toBe("An answer.");
    const [{ url, body }] = requests;
    expect(url).toMatch(/\/responses$/);
    expect(body).toMatchObject({ model: "gpt-6.1-sol", store: false, stream: true });
    expectReasoningSafe(body);
    expect(rolesOf(body)).toEqual(["developer", "user"]);
    expect(body).not.toHaveProperty("reasoning");
    expect((body.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["search_course_materials"]);
  });

  it("sends a requested reasoning effort on the Responses API too", async () => {
    respond = () => responsesStream("An answer.");

    await generateAgentTextStream({
      apiKey: "test",
      model: CHAT_TIER_MODELS.pro.id,
      messages,
      tool,
      maxSteps: 5,
      reasoningEffort: "high",
      onTextDelta: () => {},
      onReset: () => {},
      onToolCall: () => {},
    });

    expect(requests[0].body.reasoning).toEqual({ effort: "high" });
  });
});

describe("document text extraction", () => {
  it("sends a PDF to the OCR model with its output cap as max_completion_tokens", async () => {
    respond = () => chatCompletion("[Page 1]\nText");

    await generateDocumentText({
      apiKey: "test",
      model: TASK_MODELS.documentOcr.id,
      prompt: "Extract the text.",
      file: { base64Data: "JVBERi0=", mimeType: "application/pdf", filename: "notes.pdf" },
      maxOutputTokens: 32_000,
    });

    const { body } = requests[0];
    expect(body.model).toBe("gpt-6-luna");
    expect(body.max_completion_tokens).toBe(32_000);
    expectReasoningSafe(body);
    const content = (body.messages as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(content.map((part) => part.type)).toEqual(["text", "file"]);
  });

  it("sends page images to the OCR model the same way", async () => {
    respond = () => chatCompletion("blocks");

    await generatePageImagesText({
      apiKey: "test",
      model: TASK_MODELS.documentOcr.id,
      prompt: "Read the blocks.",
      pages: [{ pageNumber: 1, base64Data: "UklGRg==", mimeType: "image/webp" }],
      maxOutputTokens: 32_000,
    });

    const { body } = requests[0];
    expect(body.model).toBe("gpt-6-luna");
    expect(body.max_completion_tokens).toBe(32_000);
    expectReasoningSafe(body);
  });
});

describe("createOpenAIEmbeddingService", () => {
  it("still embeds with text-embedding-3-large at 3072 dimensions", async () => {
    respond = () => json({ data: [{ embedding: Array(3072).fill(0.1) }], usage: { prompt_tokens: 1 } });

    const vector = await createOpenAIEmbeddingService("test").embedQuery("beam");

    expect(vector).toHaveLength(3072);
    expect(requests[0].url).toMatch(/\/embeddings$/);
    expect(requests[0].body).toMatchObject({ model: "text-embedding-3-large", dimensions: 3072 });
  });
});

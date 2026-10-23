import { findModelSpec, resolveReasoningEffort, type ReasoningEffort } from "./models.ts";

export type { ReasoningEffort };

export function buildOpenAIProviderOptions(reasoningEffort?: ReasoningEffort):
  | { openai: { reasoningEffort: ReasoningEffort } }
  | undefined {
  if (!reasoningEffort) {
    return undefined;
  }

  return { openai: { reasoningEffort } };
}

// Provider options for a tool-using (agent) turn on the Responses API. Turns
// are never stored on OpenAI's side.
export function buildAgentProviderOptions(reasoningEffort?: ReasoningEffort): {
  openai: { store: false; reasoningEffort?: ReasoningEffort };
} {
  return { openai: { store: false, ...(reasoningEffort ? { reasoningEffort } : {}) } };
}

type RequestBody = Record<string, unknown>;

export interface ReasoningRequestOptions {
  reasoningEffort?: ReasoningEffort;
}

// Rejected by reasoning models unless reasoning effort is "none".
const SAMPLING_PARAMETERS = ["temperature", "top_p", "logprobs", "top_logprobs"] as const;

function endpointOf(url: string): "chat" | "responses" | null {
  const path = new URL(url).pathname;
  if (path.endsWith("/chat/completions")) return "chat";
  if (path.endsWith("/responses")) return "responses";
  return null;
}

function asDeveloperMessages(items: unknown): unknown {
  if (!Array.isArray(items)) return items;
  return items.map((item) =>
    item && typeof item === "object" && (item as { role?: unknown }).role === "system"
      ? { ...item, role: "developer" }
      : item,
  );
}

// Gives a request for a registry model (models.ts) the shape OpenAI documents
// for reasoning models, which the pinned AI SDK only does for o*/gpt-5* IDs:
// developer messages, no sampling parameters unless effort is "none", the
// output cap as max_completion_tokens, and the reasoning effort on both APIs.
// Bodies for other models and endpoints come back unchanged.
export function adaptReasoningRequestBody(
  url: string,
  body: RequestBody,
  options: ReasoningRequestOptions = {},
): RequestBody {
  const endpoint = endpointOf(url);
  const spec = typeof body.model === "string" ? findModelSpec(body.model) : undefined;
  if (!endpoint || !spec) return body;

  const adapted: RequestBody = { ...body };
  const reasoning = (adapted.reasoning ?? {}) as { effort?: ReasoningEffort };
  const sentEffort = endpoint === "chat" ? (adapted.reasoning_effort as ReasoningEffort | undefined) : reasoning.effort;
  const effort = resolveReasoningEffort(spec, options.reasoningEffort ?? sentEffort);

  if (effort !== "none") {
    for (const key of SAMPLING_PARAMETERS) delete adapted[key];
  }

  if (endpoint === "chat") {
    adapted.messages = asDeveloperMessages(adapted.messages);
    if (adapted.max_tokens !== undefined) {
      adapted.max_completion_tokens ??= adapted.max_tokens;
      delete adapted.max_tokens;
    }
    if (effort) adapted.reasoning_effort = effort;
  } else {
    adapted.input = asDeveloperMessages(adapted.input);
    if (effort) adapted.reasoning = { ...reasoning, effort };
  }
  return adapted;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

// A fetch for createOpenAI that runs adaptReasoningRequestBody on each JSON
// request body before sending it.
export function createReasoningRequestFetch(
  options: ReasoningRequestOptions = {},
  baseFetch: typeof fetch = (input, init) => globalThis.fetch(input, init),
): typeof fetch {
  return (input, init) => {
    if (typeof init?.body !== "string") return baseFetch(input, init);
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return baseFetch(input, init);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return baseFetch(input, init);
    const adapted = adaptReasoningRequestBody(requestUrl(input), body as RequestBody, options);
    return baseFetch(input, { ...init, body: JSON.stringify(adapted) });
  };
}

export function requireGeneratedText(
  text: string,
  model: string,
  finishReason: unknown,
): string {
  const cleaned = text.trim();
  if (cleaned) {
    return cleaned;
  }

  const reason = typeof finishReason === "string" ? finishReason : "unknown";
  throw new Error(`OpenAI model ${model} returned empty text (finish reason: ${reason})`);
}

export interface DocumentInput {
  // Base64-encoded file bytes (no data: prefix).
  base64Data: string;
  mimeType: string;
  filename: string;
}

export type DocumentContentPart =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mimeType: string; filename: string }
  | { type: "image"; image: string; mimeType: string };

export interface DocumentUserMessage {
  role: "user";
  content: DocumentContentPart[];
}

// Builds the single user message for document text extraction. PDFs go as a
// file part (the OpenAI provider sends them as file_data); raster images go
// as an image part. Anything else is rejected up front rather than at the API.
export function buildDocumentExtractionMessages(prompt: string, file: DocumentInput): DocumentUserMessage[] {
  const mimeType = file.mimeType.toLowerCase();
  let part: DocumentContentPart;
  if (mimeType === "application/pdf") {
    part = { type: "file", data: file.base64Data, mimeType, filename: file.filename };
  } else if (mimeType.startsWith("image/")) {
    part = { type: "image", image: file.base64Data, mimeType };
  } else {
    throw new Error(`Unsupported document type for OpenAI extraction: ${file.mimeType}`);
  }
  return [{ role: "user", content: [{ type: "text", text: prompt }, part] }];
}

export interface PageImageInput {
  pageNumber: number;
  // Base64-encoded image bytes (no data: prefix).
  base64Data: string;
  mimeType: string;
}

// One user message with the prompt followed by each page image, each preceded
// by a "[Page N]" label so the model can number its output by real pages.
export function buildPageImageMessages(prompt: string, pages: PageImageInput[]): DocumentUserMessage[] {
  if (pages.length === 0) {
    throw new Error("No page images to send");
  }
  const content: DocumentContentPart[] = [{ type: "text", text: prompt }];
  for (const page of pages) {
    content.push({ type: "text", text: `[Page ${page.pageNumber}]` });
    content.push({ type: "image", image: page.base64Data, mimeType: page.mimeType });
  }
  return [{ role: "user", content }];
}

// Shared OpenAI chat wrapper using the Vercel AI SDK.
// All edge functions call OpenAI through this module instead of raw fetch,
// so provider/model changes happen in one place.
import { createOpenAI } from "https://esm.sh/@ai-sdk/openai@1.3.24?deps=zod@3.23.8,zod-to-json-schema@3.23.5";
import { embedMany, generateText, streamText, tool } from "https://esm.sh/ai@4.3.19?deps=zod@3.23.8,zod-to-json-schema@3.23.5";
import { z } from "https://esm.sh/zod@3.23.8";
import {
  consumeAgentStream,
  limitToolCalls,
  needsAnswerOnlyTurn,
  type AgentStreamPart,
} from "./agentStream.ts";
import {
  DEFAULT_EMBEDDING_CONFIG,
  createEmbeddingService,
  type EmbedBatch,
  type EmbeddingConfig,
  type EmbeddingService,
} from "./embeddings.ts";
import {
  buildAgentProviderOptions,
  buildDocumentExtractionMessages,
  buildOpenAIProviderOptions,
  buildPageImageMessages,
  requireGeneratedText,
  type DocumentInput,
  type PageImageInput,
  type ReasoningEffort,
} from "./llmConfig.ts";

import { mergeTokenUsage, normalizeTokenUsage, type TokenUsage } from "./llmUsage.ts";
import { createDecisionsClient, type DecideFn } from "./decisions.ts";

export interface ChatTextResult {
  text: string;
  usage: TokenUsage;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatTextOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  // Only reasoning-model callers should set this. It is omitted otherwise.
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}

export interface ChatStreamOptions extends ChatTextOptions {
  onTextDelta?: (delta: string) => Promise<void> | void;
}

function toOpenAiModel(apiKey: string, model: string) {
  return createOpenAI({ apiKey, compatibility: "strict" })(model);
}

function buildGenerationOptions(options: ChatTextOptions) {
  const providerOptions = buildOpenAIProviderOptions(options.reasoningEffort);
  return {
    model: toOpenAiModel(options.apiKey, options.model),
    messages: options.messages,
    temperature: options.temperature ?? 0.4,
    maxOutputTokens: options.maxOutputTokens ?? 2000,
    ...(providerOptions ? { providerOptions } : {}),
    abortSignal: options.signal,
  };
}

function wrapProviderError(error: unknown, label = "Chat API error"): never {
  if (error instanceof HttpError) throw error;
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 429) {
    throw new HttpError(429, "Rate limit exceeded. Please try again later.");
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${label}: ${message}`);
}

export async function generateChatText(options: ChatTextOptions): Promise<string> {
  try {
    const result = await generateText(buildGenerationOptions(options));
    options.onUsage?.(normalizeTokenUsage(result.usage));
    return requireGeneratedText(result.text, options.model, result.finishReason);
  } catch (error) {
    options.onUsage?.(normalizeTokenUsage());
    wrapProviderError(error);
  }
}

export async function generateChatTextStream(options: ChatStreamOptions): Promise<ChatTextResult> {
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
  const recordUsage = (stepUsage: { promptTokens: number; completionTokens: number }) => {
    const normalized = normalizeTokenUsage(stepUsage);
    usage = mergeTokenUsage(usage, normalized);
    options.onUsage?.(normalized);
  };
  try {
    const result = streamText({ ...buildGenerationOptions(options), onStepFinish: (step) => recordUsage(step.usage) });

    let fullText = "";
    for await (const delta of result.textStream) {
      fullText += delta;
      if (options.onTextDelta) {
        await options.onTextDelta(delta);
      }
    }
    const finishReason = await result.finishReason;
    if (fullText.trim()) {
      return { text: fullText.trim(), usage };
    }

    console.warn(
      `OpenAI stream for ${options.model} returned no text (finish reason: ${finishReason}); retrying once without streaming`,
    );
    const fallbackResult = await generateText(buildGenerationOptions(options));
    recordUsage(fallbackResult.usage);
    const fallbackText = requireGeneratedText(
      fallbackResult.text,
      options.model,
      fallbackResult.finishReason,
    );
    if (options.onTextDelta) {
      await options.onTextDelta(fallbackText);
    }
    return { text: fallbackText, usage };
  } catch (error) {
    options.onUsage?.(normalizeTokenUsage());
    wrapProviderError(error);
  }
}

// A tool the agent calls with a single text query (e.g. course search).
export interface AgentQueryTool {
  name: string;
  description: string;
  queryDescription: string;
  execute(query: string): Promise<string>;
}

export interface AgentStreamOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tool: AgentQueryTool;
  // Model turns allowed for searching and answering. If the last one is spent
  // on a tool call, one more answer-only turn (tools off) follows.
  maxSteps: number;
  // Times the tool really runs per answer (default maxSteps - 1). Calls past
  // this get a "limit reached" reply instead.
  maxToolCalls?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  onTextDelta(delta: string): Promise<void> | void;
  // Text already streamed belonged to a step that ended in a tool call.
  onReset(): Promise<void> | void;
  onToolCall(query: string): Promise<void> | void;
  onUsage?: (usage: TokenUsage) => void;
}

// Answers with tool use (agentic RAG). Runs on the Responses API, because Chat
// Completions rejects function tools on these reasoning models.
export async function generateAgentTextStream(options: AgentStreamOptions): Promise<ChatTextResult> {
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
  const recordUsage = (stepUsage: { promptTokens: number; completionTokens: number }) => {
    const normalized = normalizeTokenUsage(stepUsage);
    usage = mergeTokenUsage(usage, normalized);
    options.onUsage?.(normalized);
  };
  try {
    const openai = createOpenAI({ apiKey: options.apiKey });
    const model = openai.responses(options.model);
    const runTool = limitToolCalls(
      (query) => options.tool.execute(query),
      options.maxToolCalls ?? Math.max(0, options.maxSteps - 1),
    );
    const tools = {
      [options.tool.name]: tool({
        description: options.tool.description,
        parameters: z.object({ query: z.string().describe(options.tool.queryDescription) }),
        execute: ({ query }) => runTool(query),
      }),
    };
    const shared = {
      model,
      temperature: options.temperature,
      tools,
      providerOptions: buildAgentProviderOptions(options.reasoningEffort),
      abortSignal: options.signal,
      onStepFinish: (step: { usage: { promptTokens: number; completionTokens: number } }) => recordUsage(step.usage),
    };

    const result = streamText({ ...shared, messages: options.messages, maxSteps: options.maxSteps });
    const text = await consumeAgentStream(result.fullStream as AsyncIterable<AgentStreamPart>, {
      onTextDelta: options.onTextDelta,
      onReset: options.onReset,
      onToolCall: (_toolName, args) => options.onToolCall(String((args as { query?: unknown })?.query ?? "")),
    });
    if (!needsAnswerOnlyTurn(text)) return { text, usage };

    // The steps ran out on a search. Answer from what was found, tools off.
    const { messages: stepMessages } = await result.response;
    console.warn(`Agent for ${options.model} used its ${options.maxSteps} steps without answering; running an answer-only turn`);
    const answerTurn = streamText({
      ...shared,
      messages: [...options.messages, ...stepMessages],
      toolChoice: "none",
      maxSteps: 1,
    });
    let answer = "";
    for await (const delta of answerTurn.textStream) {
      answer += delta;
      await options.onTextDelta(delta);
    }
    return { text: requireGeneratedText(answer.trim(), options.model, await answerTurn.finishReason), usage };
  } catch (error) {
    options.onUsage?.(normalizeTokenUsage());
    wrapProviderError(error);
  }
}

export interface DocumentTextOptions {
  apiKey: string;
  model: string;
  prompt: string;
  file: DocumentInput;
  maxOutputTokens?: number;
  // Retries on 429/5xx with the SDK's exponential backoff.
  maxRetries?: number;
  signal?: AbortSignal;
}

// Text extraction from a PDF or image: the file travels inline as a message
// part, so no upload step is needed. Same provider/model plumbing as chat.
export async function generateDocumentText(options: DocumentTextOptions): Promise<string> {
  try {
    const result = await generateText({
      model: toOpenAiModel(options.apiKey, options.model),
      messages: buildDocumentExtractionMessages(options.prompt, options.file),
      temperature: 0,
      // AI SDK v4 option name (v5 renamed it to maxOutputTokens).
      maxTokens: options.maxOutputTokens ?? 32_000,
      maxRetries: options.maxRetries ?? 3,
      abortSignal: options.signal,
    });
    return requireGeneratedText(result.text, options.model, result.finishReason);
  } catch (error) {
    wrapProviderError(error);
  }
}

export interface PageImagesTextOptions {
  apiKey: string;
  model: string;
  prompt: string;
  pages: PageImageInput[];
  maxOutputTokens?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

// Text generation over rendered page images (block extraction): same plumbing
// as generateDocumentText, but several labelled images instead of one file.
export async function generatePageImagesText(options: PageImagesTextOptions): Promise<string> {
  try {
    const result = await generateText({
      model: toOpenAiModel(options.apiKey, options.model),
      messages: buildPageImageMessages(options.prompt, options.pages),
      temperature: 0,
      maxTokens: options.maxOutputTokens ?? 32_000,
      maxRetries: options.maxRetries ?? 3,
      abortSignal: options.signal,
    });
    return requireGeneratedText(result.text, options.model, result.finishReason);
  } catch (error) {
    wrapProviderError(error);
  }
}

// The OpenAI-backed embedding service (see embeddings.ts). 429s and 5xx are
// retried with the SDK's exponential backoff before surfacing.
export function createOpenAIEmbeddingService(
  apiKey: string,
  config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG,
): EmbeddingService {
  const model = createOpenAI({ apiKey }).textEmbeddingModel(config.model, { dimensions: config.dimensions });
  const embedBatch: EmbedBatch = async (texts, signal) => {
    try {
      const result = await embedMany({ model, values: texts, maxRetries: 3, abortSignal: signal });
      return result.embeddings;
    } catch (error) {
      wrapProviderError(error, "Embedding API error");
    }
  };
  return createEmbeddingService(embedBatch, config);
}

// The OpenAI Decisions API (structured predicate/choice/score answers; see
// decisions.ts). Retries 429s and 5xx before surfacing a DecisionsApiError.
export function createOpenAIDecisionsClient(apiKey: string): DecideFn {
  return createDecisionsClient(apiKey);
}

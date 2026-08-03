// Shared OpenAI chat wrapper using the Vercel AI SDK.
// All edge functions call OpenAI through this module instead of raw fetch,
// so provider/model changes happen in one place.
import { createOpenAI } from "https://esm.sh/@ai-sdk/openai@1.3.24?deps=zod@3.23.8,zod-to-json-schema@3.23.5";
import { generateText, streamText } from "https://esm.sh/ai@4.3.19?deps=zod@3.23.8,zod-to-json-schema@3.23.5";
import {
  buildOpenAIProviderOptions,
  requireGeneratedText,
  type ReasoningEffort,
} from "./llmConfig.ts";

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
}

export interface ChatStreamOptions extends ChatTextOptions {
  onTextDelta?: (delta: string) => Promise<void> | void;
}

function toOpenAiModel(apiKey: string, model: string) {
  return createOpenAI({ apiKey })(model);
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

function wrapProviderError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const status = (error as { statusCode?: number })?.statusCode;
  if (status === 429) {
    throw new HttpError(429, "Rate limit exceeded. Please try again later.");
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Chat API error: ${message}`);
}

export async function generateChatText(options: ChatTextOptions): Promise<string> {
  try {
    const result = await generateText(buildGenerationOptions(options));
    return requireGeneratedText(result.text, options.model, result.finishReason);
  } catch (error) {
    wrapProviderError(error);
  }
}

export async function generateChatTextStream(options: ChatStreamOptions): Promise<string> {
  try {
    const result = streamText(buildGenerationOptions(options));

    let fullText = "";
    for await (const delta of result.textStream) {
      fullText += delta;
      if (options.onTextDelta) {
        await options.onTextDelta(delta);
      }
    }
    const finishReason = await result.finishReason;
    if (fullText.trim()) {
      return fullText.trim();
    }

    console.warn(
      `OpenAI stream for ${options.model} returned no text (finish reason: ${finishReason}); retrying once without streaming`,
    );
    const fallbackResult = await generateText(buildGenerationOptions(options));
    const fallbackText = requireGeneratedText(
      fallbackResult.text,
      options.model,
      fallbackResult.finishReason,
    );
    if (options.onTextDelta) {
      await options.onTextDelta(fallbackText);
    }
    return fallbackText;
  } catch (error) {
    wrapProviderError(error);
  }
}

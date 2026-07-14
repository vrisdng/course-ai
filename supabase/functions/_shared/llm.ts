// Shared OpenAI chat wrapper using the Vercel AI SDK.
// All edge functions call OpenAI through this module instead of raw fetch,
// so provider/model changes happen in one place.
import { createOpenAI } from "https://esm.sh/@ai-sdk/openai@1.3.24?deps=zod@3.24.1";
import { generateText, streamText } from "https://esm.sh/ai@4.3.19?deps=zod@3.24.1";

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
  signal?: AbortSignal;
}

export interface ChatStreamOptions extends ChatTextOptions {
  onTextDelta?: (delta: string) => Promise<void> | void;
}

function toOpenAiModel(apiKey: string, model: string) {
  return createOpenAI({ apiKey })(model);
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
    const result = await generateText({
      model: toOpenAiModel(options.apiKey, options.model),
      messages: options.messages,
      temperature: options.temperature ?? 0.4,
      maxOutputTokens: options.maxOutputTokens ?? 2000,
      abortSignal: options.signal,
    });
    return result.text.trim() || "I couldn't generate a response.";
  } catch (error) {
    wrapProviderError(error);
  }
}

export async function generateChatTextStream(options: ChatStreamOptions): Promise<string> {
  try {
    const result = streamText({
      model: toOpenAiModel(options.apiKey, options.model),
      messages: options.messages,
      temperature: options.temperature ?? 0.4,
      maxOutputTokens: options.maxOutputTokens ?? 2000,
      abortSignal: options.signal,
    });

    let fullText = "";
    for await (const delta of result.textStream) {
      fullText += delta;
      if (options.onTextDelta) {
        await options.onTextDelta(delta);
      }
    }
    return fullText.trim() || "I couldn't generate a response.";
  } catch (error) {
    wrapProviderError(error);
  }
}

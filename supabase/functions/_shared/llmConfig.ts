export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export function buildOpenAIProviderOptions(reasoningEffort?: ReasoningEffort):
  | { openai: { reasoningEffort: ReasoningEffort } }
  | undefined {
  if (!reasoningEffort) {
    return undefined;
  }

  return { openai: { reasoningEffort } };
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

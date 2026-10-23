export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export function normalizeTokenUsage(usage?: { promptTokens?: number; completionTokens?: number }): TokenUsage {
  const count = (value: number | undefined): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { promptTokens: count(usage?.promptTokens), completionTokens: count(usage?.completionTokens) };
}

export function mergeTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens === null || right.promptTokens === null ? null : left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens === null || right.completionTokens === null ? null : left.completionTokens + right.completionTokens,
  };
}

// Conversation history windowing/budgeting for rag-chat prompts.
import { clipText, stripTrailingSourcesSection } from "./citations.ts";
import { DEFAULT_CHAT_SETTINGS } from "./chatSettings.ts";

export interface ConversationHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface HistoryLimits {
  // Most recent messages kept.
  turnLimit: number;
  // Total characters kept across those messages.
  charBudget: number;
  // Characters kept per message.
  messageClip: number;
}

const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  turnLimit: DEFAULT_CHAT_SETTINGS.historyTurnLimit,
  charBudget: DEFAULT_CHAT_SETTINGS.historyCharBudget,
  messageClip: DEFAULT_CHAT_SETTINGS.historyMessageClip,
};
const MEMORY_CITATION_TOKEN_PATTERN = /<<\s*cite\s*:\s*[1-9]\d*\s*>>/gi;

export function sanitizeMessageForMemory(content: string): string {
  const withoutCitationTokens = content.replace(MEMORY_CITATION_TOKEN_PATTERN, "");
  const withoutTrailingSources = stripTrailingSourcesSection(withoutCitationTokens);

  return withoutTrailingSources
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildConversationHistoryTurns(
  rawMessages: Array<{ role: string; content: string }>,
  limits: HistoryLimits = DEFAULT_HISTORY_LIMITS,
): ConversationHistoryTurn[] {
  if (limits.turnLimit <= 0) {
    return [];
  }

  const normalized = rawMessages
    .map((message): ConversationHistoryTurn | null => {
      const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : null;
      if (!role || typeof message.content !== "string") {
        return null;
      }

      const cleaned = role === "assistant"
        ? sanitizeMessageForMemory(message.content)
        : message.content
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

      if (!cleaned) {
        return null;
      }

      return {
        role,
        content: clipText(cleaned, limits.messageClip),
      };
    })
    .filter((message): message is ConversationHistoryTurn => Boolean(message));

  const tailLimited = normalized.slice(-limits.turnLimit);

  let totalChars = 0;
  const budgeted: ConversationHistoryTurn[] = [];
  for (let index = tailLimited.length - 1; index >= 0; index -= 1) {
    const message = tailLimited[index];
    const projectedSize = message.content.length + 24;

    if (budgeted.length > 0 && totalChars + projectedSize > limits.charBudget) {
      break;
    }

    budgeted.push(message);
    totalChars += projectedSize;
  }

  return budgeted.reverse();
}

export function buildHistoryContext(historyTurns: ConversationHistoryTurn[]): string {
  return historyTurns
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "Student"}: ${turn.content}`)
    .join("\n");
}

export function buildOpenAIConversationMessages(
  systemPrompt: string,
  userPrompt: string,
  historyTurns: ConversationHistoryTurn[] = []
): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...historyTurns.map((turn) => ({
      role: turn.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: turn.content,
    })),
    { role: "user" as const, content: userPrompt },
  ];

  return messages;
}

// Conversation history windowing/budgeting for rag-chat prompts.
import { clipText, stripTrailingSourcesSection } from "./citations.ts";
import { DEFAULT_CHAT_SETTINGS } from "./chatSettings.ts";

// An image the student attached, as the model receives it.
export interface PromptImage {
  // Base64-encoded bytes (no data: prefix).
  base64Data: string;
  mimeType: string;
}

export interface ConversationHistoryTurn {
  role: "user" | "assistant";
  content: string;
  // Student turns only.
  images?: PromptImage[];
}

export type UserContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mimeType: string };

export type OpenAIChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | UserContentPart[] };

// Stands in for the question text when the student sent only an image.
export const IMAGE_ONLY_PROMPT = "(The student sent only the attached image.)";

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
  rawMessages: Array<{ role: string; content: string; images?: PromptImage[] }>,
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

      const images = role === "user" && message.images?.length ? message.images : undefined;
      if (!cleaned && !images) {
        return null;
      }

      return {
        role,
        content: clipText(cleaned, limits.messageClip),
        ...(images ? { images } : {}),
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
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "Student"}: ${turn.content}${turn.images?.length ? " [image attached]" : ""}`)
    .join("\n");
}

// Plain text, or the text followed by the images as content parts.
function userContent(text: string, images: PromptImage[] = []): string | UserContentPart[] {
  if (images.length === 0) return text;
  return [
    { type: "text", text: text || IMAGE_ONLY_PROMPT },
    ...images.map((image): UserContentPart => ({ type: "image", image: image.base64Data, mimeType: image.mimeType })),
  ];
}

export function buildOpenAIConversationMessages(
  systemPrompt: string,
  userPrompt: string,
  historyTurns: ConversationHistoryTurn[] = [],
  userImages: PromptImage[] = [],
): OpenAIChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...historyTurns.map((turn): OpenAIChatMessage => turn.role === "assistant"
      ? { role: "assistant", content: turn.content }
      : { role: "user", content: userContent(turn.content, turn.images) }),
    { role: "user", content: userContent(userPrompt, userImages) },
  ];
}

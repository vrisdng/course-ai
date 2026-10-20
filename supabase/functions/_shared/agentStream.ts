// Reads an AI SDK fullStream from a tool-using (agent) turn. Text the model
// writes before deciding to call a tool ("Let me look that up...") is not part
// of the answer: it is discarded, and the caller is told so it can clear what
// it already streamed to the client. Kept free of SDK imports for testing.

export type AgentStreamPart =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "error"; error: unknown }
  | { type: string; [key: string]: unknown };

export interface AgentStreamHandlers {
  onTextDelta(delta: string): Promise<void> | void;
  // Text already streamed belongs to a step that ended in a tool call.
  onReset(): Promise<void> | void;
  onToolCall(toolName: string, args: unknown): Promise<void> | void;
}

// Returns the final answer: the text written after the last tool call.
export async function consumeAgentStream(
  parts: AsyncIterable<AgentStreamPart>,
  handlers: AgentStreamHandlers,
): Promise<string> {
  let text = "";
  for await (const part of parts) {
    if (part.type === "text-delta") {
      const delta = (part as { textDelta: string }).textDelta;
      text += delta;
      await handlers.onTextDelta(delta);
    } else if (part.type === "tool-call") {
      if (text) {
        text = "";
        await handlers.onReset();
      }
      const call = part as { toolName: string; args: unknown };
      await handlers.onToolCall(call.toolName, call.args);
    } else if (part.type === "error") {
      const error = (part as { error: unknown }).error;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  return text.trim();
}

// What the tool tells the model once it has used its searches for this answer.
export const SEARCH_LIMIT_REACHED_MESSAGE =
  "Search limit reached for this answer. Answer now from the sources you already have, or tell the student the materials don't cover it.";

// Caps how many times a tool really runs in one answer. Step limits alone
// don't cap it: one step can hold several parallel calls.
export function limitToolCalls(
  execute: (query: string) => Promise<string>,
  maxCalls: number,
  limitMessage = SEARCH_LIMIT_REACHED_MESSAGE,
): (query: string) => Promise<string> {
  let calls = 0;
  return (query) => {
    if (calls >= maxCalls) return Promise.resolve(limitMessage);
    calls += 1;
    return execute(query);
  };
}

// The agent can spend its last allowed step on a tool call and stop with no
// answer. The caller then runs one more turn with tools turned off.
export function needsAnswerOnlyTurn(answer: string): boolean {
  return answer.trim().length === 0;
}

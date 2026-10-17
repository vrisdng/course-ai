import { describe, expect, it, vi } from "vitest";

import { consumeAgentStream, type AgentStreamPart } from "./agentStream.ts";

async function* parts(...items: AgentStreamPart[]): AsyncIterable<AgentStreamPart> {
  for (const item of items) yield item;
}

function handlers() {
  return { onTextDelta: vi.fn(), onReset: vi.fn(), onToolCall: vi.fn() };
}

describe("consumeAgentStream", () => {
  it("streams text and returns the whole answer when no tool is called", async () => {
    const h = handlers();
    const text = await consumeAgentStream(parts({ type: "text-delta", textDelta: "Hello " }, { type: "text-delta", textDelta: "there" }), h);
    expect(text).toBe("Hello there");
    expect(h.onTextDelta.mock.calls.map(([d]) => d)).toEqual(["Hello ", "there"]);
    expect(h.onReset).not.toHaveBeenCalled();
  });

  it("discards text written before a tool call, so only the final answer remains", async () => {
    const h = handlers();
    const text = await consumeAgentStream(
      parts(
        { type: "text-delta", textDelta: "Let me check. " },
        { type: "tool-call", toolName: "search_course_materials", args: { query: "tombstones" } },
        { type: "tool-result", toolName: "search_course_materials" },
        { type: "text-delta", textDelta: "Tombstones mark deleted slots." },
      ),
      h,
    );
    expect(text).toBe("Tombstones mark deleted slots.");
    expect(h.onReset).toHaveBeenCalledTimes(1);
    expect(h.onToolCall).toHaveBeenCalledWith("search_course_materials", { query: "tombstones" });
  });

  it("does not signal a reset when nothing was shown before the tool call", async () => {
    const h = handlers();
    await consumeAgentStream(
      parts({ type: "tool-call", toolName: "search_course_materials", args: { query: "a" } }, { type: "text-delta", textDelta: "Answer" }),
      h,
    );
    expect(h.onReset).not.toHaveBeenCalled();
  });

  it("reports every tool call across several searches", async () => {
    const h = handlers();
    await consumeAgentStream(
      parts(
        { type: "tool-call", toolName: "search_course_materials", args: { query: "first" } },
        { type: "tool-call", toolName: "search_course_materials", args: { query: "second" } },
        { type: "text-delta", textDelta: "Done" },
      ),
      h,
    );
    expect(h.onToolCall.mock.calls.map(([, args]) => (args as { query: string }).query)).toEqual(["first", "second"]);
  });

  it("throws a stream error", async () => {
    await expect(consumeAgentStream(parts({ type: "error", error: new Error("boom") }), handlers())).rejects.toThrow("boom");
  });
});

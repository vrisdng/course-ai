import { describe, expect, it } from "vitest";

import {
  buildConversationHistoryTurns,
  buildHistoryContext,
  buildOpenAIConversationMessages,
  sanitizeMessageForMemory,
} from "./history.ts";

describe("sanitizeMessageForMemory", () => {
  it("strips citation tokens from assistant messages", () => {
    expect(sanitizeMessageForMemory("Virtual memory <<cite:1>> is useful.")).toBe(
      "Virtual memory  is useful."
    );
  });

  it("strips a trailing Sources section", () => {
    expect(sanitizeMessageForMemory("Answer.\n\nSources:\n[1] Doc")).toBe("Answer.");
  });

  it("collapses excess blank lines", () => {
    expect(sanitizeMessageForMemory("Line one\n\n\n\nLine two")).toBe("Line one\n\nLine two");
  });
});

describe("buildConversationHistoryTurns", () => {
  it("drops messages with unrecognized roles or non-string content", () => {
    const turns = buildConversationHistoryTurns([
      { role: "system", content: "ignored" },
      { role: "user", content: "hello" },
    ] as Array<{ role: string; content: string }>);
    expect(turns).toEqual([{ role: "user", content: "hello" }]);
  });

  it("sanitizes assistant messages but leaves user messages mostly intact", () => {
    const turns = buildConversationHistoryTurns([
      { role: "assistant", content: "Answer <<cite:1>>." },
      { role: "user", content: "Thanks!" },
    ]);
    expect(turns[0].content).toBe("Answer .");
    expect(turns[1].content).toBe("Thanks!");
  });

  it("filters out messages that become empty after sanitization", () => {
    const turns = buildConversationHistoryTurns([
      { role: "assistant", content: "<<cite:1>>" },
      { role: "user", content: "real question" },
    ]);
    expect(turns).toEqual([{ role: "user", content: "real question" }]);
  });

  it("keeps only the most recent messages within the prompt limit", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));
    const turns = buildConversationHistoryTurns(messages);
    expect(turns.length).toBeLessThanOrEqual(14);
    expect(turns[turns.length - 1].content).toBe("message 19");
  });

  it("applies custom turn, budget, and clip limits", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i} ${"x".repeat(50)}`,
    }));
    const turns = buildConversationHistoryTurns(messages, { turnLimit: 4, charBudget: 10_000, messageClip: 20 });
    expect(turns).toHaveLength(4);
    expect(turns[3].content.startsWith("message 9")).toBe(true);
    expect(turns.every((t) => t.content.length <= 20 + "...".length)).toBe(true);

    const budgeted = buildConversationHistoryTurns(messages, { turnLimit: 10, charBudget: 100, messageClip: 1000 });
    expect(budgeted).toHaveLength(1);
  });

  it("returns no history when the turn limit is 0", () => {
    expect(buildConversationHistoryTurns([{ role: "user", content: "hi" }], { turnLimit: 0, charBudget: 9000, messageClip: 850 })).toEqual([]);
  });

  it("preserves chronological order after budgeting", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ];
    const turns = buildConversationHistoryTurns(messages);
    expect(turns.map((t) => t.content)).toEqual(["first", "second", "third"]);
  });
});

describe("buildHistoryContext", () => {
  it("formats turns with Student/Assistant labels", () => {
    const context = buildHistoryContext([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(context).toBe("Student: hi\nAssistant: hello");
  });

  it("returns an empty string for no turns", () => {
    expect(buildHistoryContext([])).toBe("");
  });
});

describe("buildOpenAIConversationMessages", () => {
  it("orders system, history, then the current user prompt", () => {
    const messages = buildOpenAIConversationMessages("sys", "current question", [
      { role: "user", content: "past question" },
      { role: "assistant", content: "past answer" },
    ]);
    expect(messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "past question" },
      { role: "assistant", content: "past answer" },
      { role: "user", content: "current question" },
    ]);
  });

  it("works with no history", () => {
    const messages = buildOpenAIConversationMessages("sys", "question");
    expect(messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "question" },
    ]);
  });
});

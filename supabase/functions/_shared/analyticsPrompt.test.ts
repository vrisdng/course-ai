import { describe, expect, it } from "vitest";
import { buildAnalyticsSystemPrompt } from "./analyticsPrompt.ts";

describe("buildAnalyticsSystemPrompt", () => {
  it("prioritizes subject concepts over request phrasing", () => {
    const prompt = buildAnalyticsSystemPrompt("analytics context");

    expect(prompt).toContain("operational carbon");
    expect(prompt).toContain("embodied carbon");
    expect(prompt).toContain('Omit entries such as "Summarize"');
    expect(prompt).toContain("multi-word domain concepts");
    expect(prompt).toContain("analytics context");
    expect(prompt).not.toContain("Treat the entire question text as a concept");
  });

  it("requires frequencies to stay grounded in supplied data", () => {
    const prompt = buildAnalyticsSystemPrompt("analytics context");

    expect(prompt).toContain("Do not estimate, invent, or redistribute frequencies");
    expect(prompt).toContain("same underlying subject concept");
    expect(prompt).toContain("state that an exact combined frequency is unavailable");
  });
});

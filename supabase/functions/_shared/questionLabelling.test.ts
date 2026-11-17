import { describe, expect, it, vi } from "vitest";
import { DECISIONS_MODEL, type DecisionResult } from "./decisions.ts";
import { createQuestionLabelStore, labelQuestion } from "./questionLabelling.ts";

const decision: DecisionResult = {
  answers: [
    { type: "choice", name: "category", choice: "calculation", confidence: 0.8, probabilities: [] },
    { type: "predicate", name: "is_study_question", probability: 0.9 },
    { type: "predicate", name: "answered_from_materials", probability: 0.2 },
  ],
  inputTokens: 300,
};

const question = { id: "event-1", queryText: "What is 2+2?", answer: "4 <<cite:1>>", citationCount: 1 };

describe("labelQuestion", () => {
  it("asks the Decisions API about the turn and saves the parsed labels", async () => {
    const decide = vi.fn().mockResolvedValue(decision);
    const save = vi.fn().mockResolvedValue(undefined);

    await labelQuestion(question, decide, save);

    const request = decide.mock.calls[0][0];
    const turn = request.input[1].content[0].text as string;
    expect(turn).toContain("What is 2+2?");
    expect(turn).toContain("4 <<cite:1>>");
    expect(turn).toContain("Citations to course materials: 1");
    expect(save).toHaveBeenCalledWith("event-1", {
      category: "calculation", categoryConfidence: 0.8, isStudyQuestion: true, answeredFromMaterials: false,
    }, DECISIONS_MODEL);
  });

  it("saves nothing when the Decisions API fails, so the question can be retried", async () => {
    const save = vi.fn();
    await expect(labelQuestion(question, vi.fn().mockRejectedValue(new Error("timed out")), save)).rejects.toThrow("timed out");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("createQuestionLabelStore", () => {
  function client(error: { message: string } | null = null) {
    const calls: Record<string, unknown[]> = {};
    const builder = {
      update: (payload: unknown) => { calls.update = [payload]; return builder; },
      eq: (...args: unknown[]) => { calls.eq = args; return builder; },
      is: (...args: unknown[]) => { calls.is = args; return Promise.resolve({ error }); },
    };
    const from = vi.fn(() => builder);
    return { client: { from } as never, from, calls };
  }

  it("writes the labels onto the unlabelled query event only", async () => {
    const { client: admin, from, calls } = client();
    await createQuestionLabelStore(admin)("event-1", {
      category: null, categoryConfidence: null, isStudyQuestion: false, answeredFromMaterials: null,
    }, "model-x");

    expect(from).toHaveBeenCalledWith("query_events");
    expect(calls.update[0]).toMatchObject({
      ai_category: null, ai_category_confidence: null, ai_is_study_question: false,
      ai_answered_from_materials: null, ai_label_model: "model-x", ai_labeled_at: expect.any(String),
    });
    expect(calls.eq).toEqual(["id", "event-1"]);
    expect(calls.is).toEqual(["ai_labeled_at", null]);
  });

  it("throws when the update fails", async () => {
    const { client: admin } = client({ message: "denied" });
    await expect(createQuestionLabelStore(admin)("event-1", {
      category: null, categoryConfidence: null, isStudyQuestion: null, answeredFromMaterials: null,
    }, "m")).rejects.toThrow("Could not save labels: denied");
  });
});

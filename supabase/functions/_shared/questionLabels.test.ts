import { describe, expect, it } from "vitest";
import { DECISIONS_MODEL, type DecisionAnswer } from "./decisions.ts";
import {
  QUESTION_CATEGORIES,
  buildQuestionLabelRequest,
  parseQuestionLabels,
} from "./questionLabels.ts";

describe("buildQuestionLabelRequest", () => {
  it("asks one category choice and two yes/no questions about the turn", () => {
    const request = buildQuestionLabelRequest({
      question: "how do I compute big-O of fib?",
      answer: "Use the recurrence T(n) = T(n-1) + T(n-2).",
      citationCount: 2,
    });

    expect(request.model).toBe(DECISIONS_MODEL);
    expect(request.questions.map((question) => [question.type, question.name])).toEqual([
      ["choice", "category"],
      ["predicate", "is_study_question"],
      ["predicate", "answered_from_materials"],
    ]);
    const category = request.questions[0];
    expect(category.type === "choice" && category.choices.map((choice) => choice.value)).toEqual(
      QUESTION_CATEGORIES.map((choice) => choice.value),
    );

    const [developer, user] = request.input as Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    expect(developer.role).toBe("developer");
    expect(developer.content[0].text).toMatch(/untrusted/i);
    expect(user.role).toBe("user");
    expect(user.content[0].text).toContain("how do I compute big-O of fib?");
    expect(user.content[0].text).toContain("T(n) = T(n-1) + T(n-2)");
    expect(user.content[0].text).toContain("Citations to course materials: 2");
  });

  it("clips long text and says when there is no saved answer", () => {
    const request = buildQuestionLabelRequest({ question: "q".repeat(5000), answer: null, citationCount: 0 });
    const text = (request.input as Array<{ content: Array<{ text: string }> }>)[1].content[0].text;
    expect(text).toContain("q".repeat(2000) + "…");
    expect(text).not.toContain("q".repeat(2001));
    expect(text).toContain("(no saved answer)");
  });
});

describe("parseQuestionLabels", () => {
  const answers = (overrides: Partial<Record<string, DecisionAnswer>> = {}): DecisionAnswer[] => [
    overrides.category ?? { type: "choice", name: "category", choice: "calculation", confidence: 0.71, probabilities: [] },
    overrides.is_study_question ?? { type: "predicate", name: "is_study_question", probability: 0.98 },
    overrides.answered_from_materials ?? { type: "predicate", name: "answered_from_materials", probability: 0.3 },
  ];

  it("reads each answer by name", () => {
    expect(parseQuestionLabels(answers())).toEqual({
      category: "calculation",
      categoryConfidence: 0.71,
      isStudyQuestion: true,
      answeredFromMaterials: false,
    });
  });

  it("does not depend on answer order", () => {
    expect(parseQuestionLabels(answers().reverse())).toMatchObject({ category: "calculation", isStudyQuestion: true });
  });

  it("leaves refused or unknown answers empty", () => {
    expect(parseQuestionLabels([
      { type: "refusal", name: "category" },
      { type: "refusal", name: "is_study_question" },
    ])).toEqual({ category: null, categoryConfidence: null, isStudyQuestion: null, answeredFromMaterials: null });

    expect(parseQuestionLabels(answers({
      category: { type: "choice", name: "category", choice: "astrology", confidence: 0.9, probabilities: [] },
    })).category).toBeNull();
  });

  it("treats exactly 0.5 as yes", () => {
    expect(parseQuestionLabels(answers({
      answered_from_materials: { type: "predicate", name: "answered_from_materials", probability: 0.5 },
    })).answeredFromMaterials).toBe(true);
  });
});

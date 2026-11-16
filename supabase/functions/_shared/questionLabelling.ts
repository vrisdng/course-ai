// Labels one saved question (a query_events row) with the Decisions API and
// stores the result. rag-chat labels each question right after its turn is
// saved; course-analytics labels any that are still unlabelled.
import { DECISIONS_MODEL, type DecideFn } from "./decisions.ts";
import { buildQuestionLabelRequest, parseQuestionLabels, type QuestionLabels } from "./questionLabels.ts";

export interface QuestionToLabel {
  // query_events.id
  id: string;
  queryText: string;
  // The saved answer, or null if it wasn't saved.
  answer: string | null;
  citationCount: number;
}

export type SaveQuestionLabels = (questionId: string, labels: QuestionLabels, model: string) => Promise<void>;

// Throws when the Decisions API or the save fails. Nothing is saved then, so
// the question stays unlabelled and can be retried.
export async function labelQuestion(question: QuestionToLabel, decide: DecideFn, save: SaveQuestionLabels): Promise<void> {
  const result = await decide(buildQuestionLabelRequest({
    question: question.queryText,
    answer: question.answer,
    citationCount: question.citationCount,
  }));
  await save(question.id, parseQuestionLabels(result.answers), DECISIONS_MODEL);
}

// The slice of the Supabase client the label store uses. Typed structurally so
// this module has no URL import and stays checkable from the Vite tsconfig.
export interface LabelStoreClient {
  from(table: "query_events"): {
    update(values: Record<string, unknown>): {
      eq(column: "id", value: string): {
        is(column: "ai_labeled_at", value: null): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
}

// Writes labels with the service-role client. Only an unlabelled row is
// updated, so a question is never relabelled by a second, overlapping run.
export function createQuestionLabelStore(admin: LabelStoreClient): SaveQuestionLabels {
  return async (questionId, labels, model) => {
    const { error } = await admin
      .from("query_events")
      .update({
        ai_category: labels.category,
        ai_category_confidence: labels.categoryConfidence,
        ai_is_study_question: labels.isStudyQuestion,
        ai_answered_from_materials: labels.answeredFromMaterials,
        ai_labeled_at: new Date().toISOString(),
        ai_label_model: model,
      })
      .eq("id", questionId)
      .is("ai_labeled_at", null);
    if (error) throw new Error(`Could not save labels: ${error.message}`);
  };
}

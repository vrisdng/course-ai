// The OpenAI GPT models this app calls, and which reasoning efforts each one
// accepts. Change a model here, not at the call site.
//
// From OpenAI's docs (checked 2026-10-23): developers.openai.com/api/docs/models,
// /api/docs/models/<id>, /api/docs/guides/latest-model, /api/docs/guides/reasoning.
// All three are reasoning models. With any effort other than "none" they reject
// temperature/top_p/logprobs, take developer (not system) messages, and cap
// output with max_completion_tokens (Chat Completions) or max_output_tokens
// (Responses). Without an effort they default to "medium". The pinned AI SDK
// (@ai-sdk/openai 1.3.24) only recognises o*/gpt-5* IDs as reasoning models,
// so llmConfig.ts#adaptReasoningRequestBody applies those rules to these IDs.
//
// Embeddings are separate (embeddings.ts); changing them means re-embedding.
import type { ChatModelTier } from "./query.ts";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAIModelSpec {
  id: string;
  name: string;
  reasoningEfforts: readonly ReasoningEffort[];
}

export const OPENAI_MODELS = {
  // "Our most capable model for the most demanding work."
  astra: { id: "gpt-6-astra", name: "GPT-6 Astra", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  // "Near-Astra performance for complex work at a lower cost."
  sol: { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  // "Our most efficient model for focused, high-volume tasks."
  luna: { id: "gpt-6-luna", name: "GPT-6 Luna", reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"] },
} as const satisfies Record<string, OpenAIModelSpec>;

// The answer model behind each tier a student can pick.
export const CHAT_TIER_MODELS: Record<ChatModelTier, OpenAIModelSpec> = {
  fast: OPENAI_MODELS.luna,
  smart: OPENAI_MODELS.sol,
  pro: OPENAI_MODELS.astra,
};

// Models for calls the student doesn't choose. All are high-volume or
// latency-bound, so they run on the efficient model.
export const TASK_MODELS = {
  // PDF/image OCR and page-block reading in process-material-job.
  documentOcr: OPENAI_MODELS.luna,
  flashcards: OPENAI_MODELS.luna,
  analyticsChat: OPENAI_MODELS.luna,
  // Picks transcript segments for video citations in rag-chat.
  videoEvidence: OPENAI_MODELS.luna,
} as const satisfies Record<string, OpenAIModelSpec>;

const MODELS_BY_ID = new Map<string, OpenAIModelSpec>(
  Object.values(OPENAI_MODELS).map((spec) => [spec.id, spec]),
);

export function findModelSpec(modelId: string): OpenAIModelSpec | undefined {
  return MODELS_BY_ID.get(modelId);
}

// The effort to send, or undefined to use the model's default. "minimal" maps
// to "low" where unsupported, per OpenAI's migration guide. Anything else the
// model doesn't support throws here rather than as an HTTP 400.
export function resolveReasoningEffort(
  spec: OpenAIModelSpec,
  requested: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!requested || spec.reasoningEfforts.includes(requested)) return requested;
  if (requested === "minimal" && spec.reasoningEfforts.includes("low")) return "low";
  throw new Error(`OpenAI model ${spec.id} does not support reasoning effort "${requested}"`);
}

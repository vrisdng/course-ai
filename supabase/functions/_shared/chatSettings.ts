// Per-course chat and retrieval settings that admins tune from the dashboard.
// Rows live in public.course_chat_settings; anything missing or out of range
// falls back to, or is clamped against, the defaults and ranges below.
import type { ChatModelTier } from "./query.ts";

export interface ChatSettings {
  matchThreshold: number;
  summaryMatchThreshold: number;
  matchCount: number;
  summaryMatchCount: number;
  // Candidates fetched when the student filtered to specific documents.
  filteredMatchCount: number;
  relevanceFloor: number;
  summaryRelevanceFloor: number;
  // Sources sent to the answer model after reranking.
  finalCount: number;
  // Weight of cosine similarity in reranking; keyword overlap gets the rest.
  semanticWeight: number;
  sourceContextChars: number;
  answerTemperature: number;
  maxAnswerTokens: number;
  defaultModelTier: ChatModelTier;
  allowedModelTiers: ChatModelTier[];
  historyTurnLimit: number;
  historyCharBudget: number;
  historyMessageClip: number;
  queryRewriteEnabled: boolean;
  // Video chunks in a summary closer together than this are treated as overlapping.
  videoSpreadWindowMs: number;
  courseInstructions: string;
}

// A course_chat_settings row as read from the database.
export interface CourseChatSettingsRow {
  match_threshold?: number | null;
  summary_match_threshold?: number | null;
  match_count?: number | null;
  summary_match_count?: number | null;
  filtered_match_count?: number | null;
  relevance_floor?: number | null;
  summary_relevance_floor?: number | null;
  final_count?: number | null;
  semantic_weight?: number | null;
  source_context_chars?: number | null;
  answer_temperature?: number | null;
  max_answer_tokens?: number | null;
  default_model_tier?: string | null;
  allowed_model_tiers?: string[] | null;
  history_turn_limit?: number | null;
  history_char_budget?: number | null;
  history_message_clip?: number | null;
  query_rewrite_enabled?: boolean | null;
  video_spread_window_ms?: number | null;
  course_instructions?: string | null;
}

export const ALL_MODEL_TIERS: readonly ChatModelTier[] = ["fast", "smart", "pro"];

// Calibrated for text-embedding-3-large on this corpus (2026-10-01). Short,
// casual questions ("when is the exam") score their answering chunk as low
// as 0.30–0.33, while short off-topic questions reach 0.29, so no cutoff
// separates them cleanly. The floor favours keeping answerable questions
// and leaves off-topic rejection to the model. Re-calibrate when the
// embedding model changes.
export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  matchThreshold: 0.2,
  summaryMatchThreshold: 0.15,
  matchCount: 18,
  summaryMatchCount: 30,
  filteredMatchCount: 24,
  relevanceFloor: 0.2,
  summaryRelevanceFloor: 0.15,
  finalCount: 10,
  semanticWeight: 0.72,
  sourceContextChars: 1300,
  answerTemperature: 0.4,
  maxAnswerTokens: 2000,
  defaultModelTier: "fast",
  allowedModelTiers: [...ALL_MODEL_TIERS],
  historyTurnLimit: 14,
  historyCharBudget: 9000,
  historyMessageClip: 850,
  queryRewriteEnabled: true,
  videoSpreadWindowMs: 60_000,
  courseInstructions: "",
};

interface NumberRange {
  min: number;
  max: number;
  integer: boolean;
}

type NumericSettingKey = {
  [K in keyof ChatSettings]: ChatSettings[K] extends number ? K : never;
}[keyof ChatSettings];

// Kept in step with the CHECK constraints on public.course_chat_settings.
export const CHAT_SETTING_RANGES: Record<NumericSettingKey, NumberRange> & { courseInstructionsMaxChars: number } = {
  matchThreshold: { min: 0, max: 1, integer: false },
  summaryMatchThreshold: { min: 0, max: 1, integer: false },
  matchCount: { min: 1, max: 100, integer: true },
  summaryMatchCount: { min: 1, max: 100, integer: true },
  filteredMatchCount: { min: 1, max: 100, integer: true },
  relevanceFloor: { min: 0, max: 1, integer: false },
  summaryRelevanceFloor: { min: 0, max: 1, integer: false },
  finalCount: { min: 1, max: 30, integer: true },
  semanticWeight: { min: 0, max: 1, integer: false },
  sourceContextChars: { min: 200, max: 5000, integer: true },
  answerTemperature: { min: 0, max: 2, integer: false },
  maxAnswerTokens: { min: 256, max: 16000, integer: true },
  historyTurnLimit: { min: 0, max: 40, integer: true },
  historyCharBudget: { min: 0, max: 40000, integer: true },
  historyMessageClip: { min: 100, max: 5000, integer: true },
  videoSpreadWindowMs: { min: 0, max: 600_000, integer: true },
  courseInstructionsMaxChars: 4000,
};

function resolveNumber(raw: unknown, key: NumericSettingKey): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_CHAT_SETTINGS[key];
  }
  const range = CHAT_SETTING_RANGES[key];
  const clamped = Math.min(range.max, Math.max(range.min, raw));
  return range.integer ? Math.round(clamped) : clamped;
}

function isModelTier(value: unknown): value is ChatModelTier {
  return typeof value === "string" && (ALL_MODEL_TIERS as readonly string[]).includes(value);
}

function resolveAllowedTiers(raw: unknown): ChatModelTier[] {
  const tiers = Array.isArray(raw) ? ALL_MODEL_TIERS.filter((tier) => raw.includes(tier)) : [];
  return tiers.length > 0 ? tiers : [...DEFAULT_CHAT_SETTINGS.allowedModelTiers];
}

export function resolveChatSettings(row: CourseChatSettingsRow | null): ChatSettings {
  if (!row) {
    return { ...DEFAULT_CHAT_SETTINGS, allowedModelTiers: [...DEFAULT_CHAT_SETTINGS.allowedModelTiers] };
  }

  const allowedModelTiers = resolveAllowedTiers(row.allowed_model_tiers);
  const requestedDefault = isModelTier(row.default_model_tier) ? row.default_model_tier : DEFAULT_CHAT_SETTINGS.defaultModelTier;
  const instructions = typeof row.course_instructions === "string" ? row.course_instructions.trim() : "";

  return {
    matchThreshold: resolveNumber(row.match_threshold, "matchThreshold"),
    summaryMatchThreshold: resolveNumber(row.summary_match_threshold, "summaryMatchThreshold"),
    matchCount: resolveNumber(row.match_count, "matchCount"),
    summaryMatchCount: resolveNumber(row.summary_match_count, "summaryMatchCount"),
    filteredMatchCount: resolveNumber(row.filtered_match_count, "filteredMatchCount"),
    relevanceFloor: resolveNumber(row.relevance_floor, "relevanceFloor"),
    summaryRelevanceFloor: resolveNumber(row.summary_relevance_floor, "summaryRelevanceFloor"),
    finalCount: resolveNumber(row.final_count, "finalCount"),
    semanticWeight: resolveNumber(row.semantic_weight, "semanticWeight"),
    sourceContextChars: resolveNumber(row.source_context_chars, "sourceContextChars"),
    answerTemperature: resolveNumber(row.answer_temperature, "answerTemperature"),
    maxAnswerTokens: resolveNumber(row.max_answer_tokens, "maxAnswerTokens"),
    defaultModelTier: allowedModelTiers.includes(requestedDefault) ? requestedDefault : allowedModelTiers[0],
    allowedModelTiers,
    historyTurnLimit: resolveNumber(row.history_turn_limit, "historyTurnLimit"),
    historyCharBudget: resolveNumber(row.history_char_budget, "historyCharBudget"),
    historyMessageClip: resolveNumber(row.history_message_clip, "historyMessageClip"),
    queryRewriteEnabled: typeof row.query_rewrite_enabled === "boolean"
      ? row.query_rewrite_enabled
      : DEFAULT_CHAT_SETTINGS.queryRewriteEnabled,
    videoSpreadWindowMs: resolveNumber(row.video_spread_window_ms, "videoSpreadWindowMs"),
    courseInstructions: instructions.slice(0, CHAT_SETTING_RANGES.courseInstructionsMaxChars),
  };
}

// The tier a request runs on: the requested one if the course allows it,
// otherwise the course default.
export function resolveRequestedModelTier(raw: unknown, settings: ChatSettings): ChatModelTier {
  return isModelTier(raw) && settings.allowedModelTiers.includes(raw) ? raw : settings.defaultModelTier;
}

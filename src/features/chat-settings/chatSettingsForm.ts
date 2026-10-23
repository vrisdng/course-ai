// Field metadata, validation, and row mapping for the admin chat settings form.
// Defaults, ranges, and row parsing come straight from the edge-function module
// that rag-chat uses, so the form and the server cannot drift apart.
import {
  ALL_MODEL_TIERS,
  CHAT_SETTING_RANGES,
  DEFAULT_CHAT_SETTINGS,
  resolveChatSettings,
  type ChatSettings,
} from '../../../supabase/functions/_shared/chatSettings.ts';
import type { TablesUpdate } from '@/integrations/supabase/types';

export { ALL_MODEL_TIERS, CHAT_SETTING_RANGES, DEFAULT_CHAT_SETTINGS, resolveChatSettings };
export type { ChatSettings };
export type ChatModelTier = ChatSettings['defaultModelTier'];

export type NumericSettingKey = {
  [K in keyof ChatSettings]: ChatSettings[K] extends number ? K : never;
}[keyof ChatSettings];

export interface NumericFieldSpec {
  key: NumericSettingKey;
  label: string;
  description: string;
  step: number;
  // Stored value divided by this is what the admin sees (ms shown as seconds).
  displayScale?: number;
  unit?: string;
}

export interface FieldGroup {
  title: string;
  fields: NumericFieldSpec[];
}

export const CHAT_SETTING_FIELD_GROUPS: FieldGroup[] = [
  {
    title: 'Retrieval',
    fields: [
      { key: 'matchThreshold', label: 'Similarity threshold', description: 'How closely a passage must match the question to be retrieved.', step: 0.01 },
      { key: 'summaryMatchThreshold', label: 'Similarity threshold (summaries)', description: 'The same, for "summarise" or "overview" questions.', step: 0.01 },
      { key: 'matchCount', label: 'Candidates fetched', description: 'Passages pulled from the search before reranking.', step: 1 },
      { key: 'summaryMatchCount', label: 'Candidates fetched (summaries)', description: 'The same, for summary questions.', step: 1 },
      { key: 'filteredMatchCount', label: 'Candidates fetched (selected documents)', description: 'The same, when the student picked specific documents.', step: 1 },
      { key: 'relevanceFloor', label: 'Relevance floor', description: 'Reranked passages scoring below this are dropped.', step: 0.01 },
      { key: 'summaryRelevanceFloor', label: 'Relevance floor (summaries)', description: 'The same, for summary questions.', step: 0.01 },
      { key: 'finalCount', label: 'Sources sent to the model', description: 'More sources give broader answers but add noise and cost.', step: 1 },
      { key: 'semanticWeight', label: 'Meaning vs. keyword weight', description: '1 ranks purely by meaning, 0 purely by shared keywords.', step: 0.01 },
      { key: 'sourceContextChars', label: 'Characters per source', description: 'How much of each source the model reads.', step: 50, unit: 'chars' },
      { key: 'videoSpreadWindowMs', label: 'Video summary spread window', description: 'In summaries, video passages closer together than this count as overlapping.', step: 5, displayScale: 1000, unit: 's' },
    ],
  },
  {
    title: 'Answer',
    fields: [
      { key: 'answerTemperature', label: 'Temperature', description: 'Higher is more varied, lower is more consistent.', step: 0.05 },
      { key: 'maxAnswerTokens', label: 'Max answer tokens', description: 'Upper limit on answer length.', step: 100, unit: 'tokens' },
    ],
  },
  {
    title: 'Conversation memory',
    fields: [
      { key: 'historyTurnLimit', label: 'Messages remembered', description: 'Most recent messages the model sees. 0 turns memory off.', step: 1 },
      { key: 'historyCharBudget', label: 'Memory size', description: 'Total characters across remembered messages.', step: 500, unit: 'chars' },
      { key: 'historyMessageClip', label: 'Characters per remembered message', description: 'Longer messages are cut to this length.', step: 50, unit: 'chars' },
    ],
  },
];

const NUMERIC_FIELDS = CHAT_SETTING_FIELD_GROUPS.flatMap((group) => group.fields);

export const MODEL_TIER_LABELS: Record<ChatModelTier, string> = {
  fast: 'Fast',
  smart: 'Smart',
  pro: 'Pro',
};

export function toDisplayValue(field: NumericFieldSpec, value: number): number {
  return value / (field.displayScale ?? 1);
}

export function fromDisplayValue(field: NumericFieldSpec, value: number): number {
  return value * (field.displayScale ?? 1);
}

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

// A field's range and step in the units the admin sees.
export function sliderRange(field: NumericFieldSpec): SliderRange {
  const range = CHAT_SETTING_RANGES[field.key];
  return { min: toDisplayValue(field, range.min), max: toDisplayValue(field, range.max), step: field.step };
}

function decimalsOf(step: number): number {
  return (String(step).split('.')[1] ?? '').length;
}

// A slider's display value rounded to the field's step (counted from the
// minimum), within range, and free of floating-point noise such as
// 0.21000000000000002.
export function snapToStep(field: NumericFieldSpec, displayValue: number): number {
  const { min, max, step } = sliderRange(field);
  const stepped = min + Math.round((displayValue - min) / step) * step;
  const clamped = Math.min(max, Math.max(min, stepped));
  return Number(clamped.toFixed(decimalsOf(step)));
}

export type ChatSettingsErrors = Partial<Record<keyof ChatSettings, string>>;

export function validateChatSettings(settings: ChatSettings): ChatSettingsErrors {
  const errors: ChatSettingsErrors = {};

  for (const field of NUMERIC_FIELDS) {
    const value = settings[field.key];
    const range = CHAT_SETTING_RANGES[field.key];
    if (!Number.isFinite(value)) {
      errors[field.key] = 'Enter a number.';
    } else if (value < range.min || value > range.max) {
      errors[field.key] = `Must be between ${toDisplayValue(field, range.min)} and ${toDisplayValue(field, range.max)}.`;
    } else if (range.integer && !Number.isInteger(value)) {
      errors[field.key] = 'Must be a whole number.';
    }
  }

  const videoShare = settings.videoSharePercent;
  if (videoShare !== null) {
    const range = CHAT_SETTING_RANGES.videoSharePercent;
    if (!Number.isFinite(videoShare)) {
      errors.videoSharePercent = 'Enter a number.';
    } else if (videoShare < range.min || videoShare > range.max) {
      errors.videoSharePercent = `Must be between ${range.min} and ${range.max}.`;
    } else if (!Number.isInteger(videoShare)) {
      errors.videoSharePercent = 'Must be a whole number.';
    }
  }

  if (settings.allowedModelTiers.length === 0) {
    errors.allowedModelTiers = 'Allow at least one model.';
  } else if (!settings.allowedModelTiers.includes(settings.defaultModelTier)) {
    errors.defaultModelTier = 'The default must be one of the allowed models.';
  }

  if (settings.courseInstructions.trim().length > CHAT_SETTING_RANGES.courseInstructionsMaxChars) {
    errors.courseInstructions = `Keep it under ${CHAT_SETTING_RANGES.courseInstructionsMaxChars} characters.`;
  }

  return errors;
}

// video_share_percent comes from migration 20261023090000, which has not been
// applied to the project the generated types were last produced from. Drop
// this addition once types.ts is regenerated after that migration.
export type CourseChatSettingsUpdate = Omit<
  TablesUpdate<'course_chat_settings'>,
  'course_id' | 'created_at' | 'updated_at' | 'updated_by'
> & { video_share_percent?: number | null };

export function toSettingsRow(settings: ChatSettings): CourseChatSettingsUpdate {
  return {
    match_threshold: settings.matchThreshold,
    summary_match_threshold: settings.summaryMatchThreshold,
    match_count: settings.matchCount,
    summary_match_count: settings.summaryMatchCount,
    filtered_match_count: settings.filteredMatchCount,
    relevance_floor: settings.relevanceFloor,
    summary_relevance_floor: settings.summaryRelevanceFloor,
    final_count: settings.finalCount,
    semantic_weight: settings.semanticWeight,
    source_context_chars: settings.sourceContextChars,
    answer_temperature: settings.answerTemperature,
    max_answer_tokens: settings.maxAnswerTokens,
    default_model_tier: settings.defaultModelTier,
    allowed_model_tiers: [...settings.allowedModelTiers],
    history_turn_limit: settings.historyTurnLimit,
    history_char_budget: settings.historyCharBudget,
    history_message_clip: settings.historyMessageClip,
    query_rewrite_enabled: settings.queryRewriteEnabled,
    video_spread_window_ms: settings.videoSpreadWindowMs,
    video_share_percent: settings.videoSharePercent,
    course_instructions: settings.courseInstructions.trim(),
  };
}

// Where the share starts when an admin turns the balance on.
export const VIDEO_SHARE_START_PERCENT = 50;
export const VIDEO_SHARE_STEP = 5;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// A concrete reading of the share for the admin, using the course's own
// sources-per-search setting.
export function videoShareExample(videoSharePercent: number | null, finalCount: number): string {
  if (videoSharePercent === null) {
    return 'Off: each search keeps the most relevant passages, whatever their type.';
  }
  const fromVideo = Math.round((finalCount * videoSharePercent) / 100);
  return `Example: with ${plural(finalCount, 'source')} per search and passages of similar length, about ${fromVideo} would come from video and ${finalCount - fromVideo} from documents, when both have enough relevant passages.`;
}

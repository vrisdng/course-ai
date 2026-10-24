import { describe, expect, it } from "vitest";

import {
  CHAT_SETTING_RANGES,
  DEFAULT_CHAT_SETTINGS,
  resolveChatSettings,
  resolveRequestedModelTier,
  type CourseChatSettingsRow,
} from "./chatSettings.ts";

describe("resolveChatSettings", () => {
  it("returns the defaults when a course has no settings row", () => {
    expect(resolveChatSettings(null)).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  it("maps a stored row onto camelCase settings", () => {
    const row: CourseChatSettingsRow = {
      match_threshold: 0.3,
      summary_match_threshold: 0.25,
      match_count: 20,
      summary_match_count: 40,
      filtered_match_count: 26,
      relevance_floor: 0.28,
      summary_relevance_floor: 0.22,
      final_count: 8,
      semantic_weight: 0.6,
      source_context_chars: 1500,
      answer_temperature: 0.2,
      max_answer_tokens: 3000,
      default_model_tier: "smart",
      allowed_model_tiers: ["fast", "smart"],
      history_turn_limit: 10,
      history_char_budget: 6000,
      history_message_clip: 600,
      query_rewrite_enabled: false,
      video_spread_window_ms: 30_000,
      video_share_percent: 35,
      course_instructions: "Answer in British English.",
    };

    expect(resolveChatSettings(row)).toEqual({
      matchThreshold: 0.3,
      summaryMatchThreshold: 0.25,
      matchCount: 20,
      summaryMatchCount: 40,
      filteredMatchCount: 26,
      relevanceFloor: 0.28,
      summaryRelevanceFloor: 0.22,
      finalCount: 8,
      semanticWeight: 0.6,
      sourceContextChars: 1500,
      answerTemperature: 0.2,
      maxAnswerTokens: 3000,
      defaultModelTier: "smart",
      allowedModelTiers: ["fast", "smart"],
      historyTurnLimit: 10,
      historyCharBudget: 6000,
      historyMessageClip: 600,
      queryRewriteEnabled: false,
      videoSpreadWindowMs: 30_000,
      videoSharePercent: 35,
      courseInstructions: "Answer in British English.",
    });
  });

  it("falls back to the default for missing or non-numeric fields", () => {
    const settings = resolveChatSettings({ match_count: null, final_count: Number.NaN, answer_temperature: "hot" as unknown as number });
    expect(settings.matchCount).toBe(DEFAULT_CHAT_SETTINGS.matchCount);
    expect(settings.finalCount).toBe(DEFAULT_CHAT_SETTINGS.finalCount);
    expect(settings.answerTemperature).toBe(DEFAULT_CHAT_SETTINGS.answerTemperature);
  });

  it("clamps out-of-range numbers to the allowed range", () => {
    const settings = resolveChatSettings({ final_count: 500, match_threshold: -3, answer_temperature: 9 });
    expect(settings.finalCount).toBe(CHAT_SETTING_RANGES.finalCount.max);
    expect(settings.matchThreshold).toBe(CHAT_SETTING_RANGES.matchThreshold.min);
    expect(settings.answerTemperature).toBe(CHAT_SETTING_RANGES.answerTemperature.max);
  });

  it("rounds integer settings", () => {
    expect(resolveChatSettings({ match_count: 17.6 }).matchCount).toBe(18);
  });

  it("drops unknown model tiers and falls back to all tiers when none remain", () => {
    expect(resolveChatSettings({ allowed_model_tiers: ["smart", "turbo"] }).allowedModelTiers).toEqual(["smart"]);
    expect(resolveChatSettings({ allowed_model_tiers: ["turbo"] }).allowedModelTiers).toEqual(DEFAULT_CHAT_SETTINGS.allowedModelTiers);
  });

  it("uses the first allowed tier when the default tier is not allowed", () => {
    const settings = resolveChatSettings({ default_model_tier: "fast", allowed_model_tiers: ["smart", "pro"] });
    expect(settings.defaultModelTier).toBe("smart");
  });

  it("trims course instructions and caps their length", () => {
    expect(resolveChatSettings({ course_instructions: "  Be brief.  " }).courseInstructions).toBe("Be brief.");
    const long = "x".repeat(CHAT_SETTING_RANGES.courseInstructionsMaxChars + 50);
    expect(resolveChatSettings({ course_instructions: long }).courseInstructions).toHaveLength(
      CHAT_SETTING_RANGES.courseInstructionsMaxChars,
    );
  });

  it("keeps the default query-rewrite flag unless a boolean is stored", () => {
    expect(resolveChatSettings({ query_rewrite_enabled: null }).queryRewriteEnabled).toBe(true);
    expect(resolveChatSettings({ query_rewrite_enabled: false }).queryRewriteEnabled).toBe(false);
  });
});

describe("resolveChatSettings video share", () => {
  it("is off (pure relevance ranking) by default and when nothing is stored", () => {
    expect(DEFAULT_CHAT_SETTINGS.videoSharePercent).toBeNull();
    expect(resolveChatSettings({}).videoSharePercent).toBeNull();
    expect(resolveChatSettings({ video_share_percent: null }).videoSharePercent).toBeNull();
  });

  it("keeps the endpoints and a midpoint", () => {
    expect(resolveChatSettings({ video_share_percent: 0 }).videoSharePercent).toBe(0);
    expect(resolveChatSettings({ video_share_percent: 50 }).videoSharePercent).toBe(50);
    expect(resolveChatSettings({ video_share_percent: 100 }).videoSharePercent).toBe(100);
  });

  it("clamps to 0-100 and rounds to whole percents", () => {
    expect(resolveChatSettings({ video_share_percent: -5 }).videoSharePercent).toBe(0);
    expect(resolveChatSettings({ video_share_percent: 140 }).videoSharePercent).toBe(100);
    expect(resolveChatSettings({ video_share_percent: 32.6 }).videoSharePercent).toBe(33);
  });

  it("treats a non-numeric value as off rather than guessing a share", () => {
    expect(resolveChatSettings({ video_share_percent: Number.NaN }).videoSharePercent).toBeNull();
    expect(resolveChatSettings({ video_share_percent: "40" as unknown as number }).videoSharePercent).toBeNull();
  });
});

describe("resolveRequestedModelTier", () => {
  const settings = resolveChatSettings({ default_model_tier: "smart", allowed_model_tiers: ["fast", "smart"] });

  it("honours a requested tier the course allows", () => {
    expect(resolveRequestedModelTier("fast", settings)).toBe("fast");
  });

  it("uses the course default for a tier the course does not allow", () => {
    expect(resolveRequestedModelTier("pro", settings)).toBe("smart");
  });

  it("uses the course default when no valid tier is requested", () => {
    expect(resolveRequestedModelTier(undefined, settings)).toBe("smart");
    expect(resolveRequestedModelTier("turbo", settings)).toBe("smart");
  });
});

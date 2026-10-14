import { describe, expect, it } from 'vitest';

import {
  CHAT_SETTING_FIELD_GROUPS,
  CHAT_SETTING_RANGES,
  DEFAULT_CHAT_SETTINGS,
  resolveChatSettings,
  toSettingsRow,
  validateChatSettings,
} from './chatSettingsForm';

describe('toSettingsRow', () => {
  it('round-trips through resolveChatSettings', () => {
    const settings = {
      ...DEFAULT_CHAT_SETTINGS,
      matchThreshold: 0.33,
      finalCount: 7,
      allowedModelTiers: ['smart' as const, 'pro' as const],
      defaultModelTier: 'pro' as const,
      queryRewriteEnabled: false,
      courseInstructions: 'Use SI units.',
    };
    expect(resolveChatSettings(toSettingsRow(settings))).toEqual(settings);
  });

  it('writes snake_case column names', () => {
    const row = toSettingsRow(DEFAULT_CHAT_SETTINGS);
    expect(row).toMatchObject({
      match_threshold: DEFAULT_CHAT_SETTINGS.matchThreshold,
      final_count: DEFAULT_CHAT_SETTINGS.finalCount,
      video_spread_window_ms: DEFAULT_CHAT_SETTINGS.videoSpreadWindowMs,
      course_instructions: '',
    });
  });

  it('trims course instructions', () => {
    expect(toSettingsRow({ ...DEFAULT_CHAT_SETTINGS, courseInstructions: '  Be brief.  ' }).course_instructions).toBe('Be brief.');
  });
});

describe('validateChatSettings', () => {
  it('accepts the defaults', () => {
    expect(validateChatSettings(DEFAULT_CHAT_SETTINGS)).toEqual({});
  });

  it('flags numbers outside their range', () => {
    const errors = validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, finalCount: 99, matchThreshold: -0.1 });
    expect(errors.finalCount).toMatch(/between 1 and 30/);
    expect(errors.matchThreshold).toMatch(/between 0 and 1/);
  });

  it('flags non-integers for integer settings and empty inputs', () => {
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, matchCount: 4.5 }).matchCount).toMatch(/whole number/);
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, matchCount: Number.NaN }).matchCount).toMatch(/Enter a number/);
  });

  it('requires at least one model tier and a default among them', () => {
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, allowedModelTiers: [] }).allowedModelTiers).toBeDefined();
    expect(
      validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, allowedModelTiers: ['smart'], defaultModelTier: 'fast' }).defaultModelTier,
    ).toBeDefined();
  });

  it('caps course instructions', () => {
    const courseInstructions = 'x'.repeat(CHAT_SETTING_RANGES.courseInstructionsMaxChars + 1);
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, courseInstructions }).courseInstructions).toBeDefined();
  });
});

describe('CHAT_SETTING_FIELD_GROUPS', () => {
  it('lists every numeric setting exactly once', () => {
    const keys = CHAT_SETTING_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key));
    const numericKeys = Object.keys(CHAT_SETTING_RANGES).filter((key) => key !== 'courseInstructionsMaxChars');
    expect([...keys].sort()).toEqual([...numericKeys].sort());
  });
});

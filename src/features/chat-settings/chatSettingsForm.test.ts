import { describe, expect, it } from 'vitest';

import {
  CHAT_SETTING_FIELD_GROUPS,
  CHAT_SETTING_RANGES,
  DEFAULT_CHAT_SETTINGS,
  resolveChatSettings,
  sliderRange,
  snapToStep,
  toSettingsRow,
  validateChatSettings,
  videoShareExample,
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
      videoSharePercent: 40,
      courseInstructions: 'Use SI units.',
    };
    expect(resolveChatSettings(toSettingsRow(settings))).toEqual(settings);
  });

  it('writes the video share, and null when the balance is off', () => {
    expect(toSettingsRow({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: 0 }).video_share_percent).toBe(0);
    expect(toSettingsRow({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: 100 }).video_share_percent).toBe(100);
    expect(toSettingsRow(DEFAULT_CHAT_SETTINGS).video_share_percent).toBeNull();
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

  it('accepts the video share off or anywhere from 0 to 100', () => {
    for (const videoSharePercent of [null, 0, 50, 100]) {
      expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent })).toEqual({});
    }
  });

  it('flags a video share outside 0-100, fractional, or empty', () => {
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: 101 }).videoSharePercent).toMatch(/between 0 and 100/);
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: -1 }).videoSharePercent).toMatch(/between 0 and 100/);
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: 12.5 }).videoSharePercent).toMatch(/whole number/);
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, videoSharePercent: Number.NaN }).videoSharePercent).toMatch(/Enter a number/);
  });

  it('caps course instructions', () => {
    const courseInstructions = 'x'.repeat(CHAT_SETTING_RANGES.courseInstructionsMaxChars + 1);
    expect(validateChatSettings({ ...DEFAULT_CHAT_SETTINGS, courseInstructions }).courseInstructions).toBeDefined();
  });
});

describe('CHAT_SETTING_FIELD_GROUPS', () => {
  it('lists every numeric setting exactly once', () => {
    const keys = CHAT_SETTING_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key));
    // The video share is optional (null = off), so it has its own control.
    const numericKeys = Object.keys(CHAT_SETTING_RANGES).filter(
      (key) => key !== 'courseInstructionsMaxChars' && key !== 'videoSharePercent',
    );
    expect([...keys].sort()).toEqual([...numericKeys].sort());
  });
});

const field = (key: string) => CHAT_SETTING_FIELD_GROUPS.flatMap((g) => g.fields).find((f) => f.key === key)!;

describe('sliderRange', () => {
  it('gives the range and step in the units the admin sees', () => {
    expect(sliderRange(field('matchThreshold'))).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(sliderRange(field('finalCount'))).toEqual({ min: 1, max: 30, step: 1 });
    // Stored in ms, shown in seconds.
    expect(sliderRange(field('videoSpreadWindowMs'))).toEqual({ min: 0, max: 600, step: 5 });
  });
});

describe('snapToStep', () => {
  it('removes floating-point noise from slider values', () => {
    expect(snapToStep(field('matchThreshold'), 0.21000000000000002)).toBe(0.21);
    expect(snapToStep(field('answerTemperature'), 0.30000000000000004)).toBe(0.3);
  });

  it('rounds to the nearest step', () => {
    expect(snapToStep(field('answerTemperature'), 0.42)).toBe(0.4);
    expect(snapToStep(field('sourceContextChars'), 1320)).toBe(1300);
  });

  it('stays within the range', () => {
    expect(snapToStep(field('finalCount'), 31)).toBe(30);
    expect(snapToStep(field('matchThreshold'), -0.2)).toBe(0);
  });
});

describe('videoShareExample', () => {
  it('explains the off state', () => {
    expect(videoShareExample(null, 10)).toBe('Off: each search keeps the most relevant passages, whatever their type.');
  });

  it('turns the share into an example split of the sources per search', () => {
    expect(videoShareExample(30, 10)).toBe(
      'Example: with 10 sources per search and passages of similar length, about 3 would come from video and 7 from documents, when both have enough relevant passages.',
    );
    expect(videoShareExample(0, 10)).toContain('about 0 would come from video and 10 from documents');
    expect(videoShareExample(100, 6)).toContain('about 6 would come from video and 0 from documents');
    expect(videoShareExample(50, 1)).toContain('with 1 source per search');
  });
});

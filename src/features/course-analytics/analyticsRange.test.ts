import { describe, expect, it } from 'vitest';

import {
  RANGE_PRESETS,
  formatDateTimeLocalValue,
  formatRangeLabel,
  presetRange,
  resolveCustomRange,
} from './analyticsRange';

describe('presetRange', () => {
  it('ends now and starts the given number of days earlier', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    expect(presetRange(30, now)).toEqual({ startAt: '2026-09-24T12:00:00.000Z', endAt: '2026-10-24T12:00:00.000Z' });
    expect(presetRange(7, now).startAt).toBe('2026-10-17T12:00:00.000Z');
  });

  it('offers 7, 30 and 90 days', () => {
    expect(RANGE_PRESETS.map((preset) => preset.days)).toEqual([7, 30, 90]);
  });
});

describe('resolveCustomRange', () => {
  it('turns two local date-times into an ISO range', () => {
    const start = new Date(2026, 9, 1, 9, 30);
    const end = new Date(2026, 9, 2, 17, 0);
    expect(resolveCustomRange(formatDateTimeLocalValue(start), formatDateTimeLocalValue(end))).toEqual({
      range: { startAt: start.toISOString(), endAt: end.toISOString() },
      error: null,
    });
  });

  it('explains each problem', () => {
    expect(resolveCustomRange('', '2026-10-02T00:00').error).toBe('Choose a start date and time.');
    expect(resolveCustomRange('nonsense', '2026-10-02T00:00').error).toBe('Enter a valid start date and time.');
    expect(resolveCustomRange('2026-10-01T00:00', '').error).toBe('Choose an end date and time.');
    expect(resolveCustomRange('2026-10-01T00:00', 'nonsense').error).toBe('Enter a valid end date and time.');
    expect(resolveCustomRange('2026-10-02T00:00', '2026-10-01T00:00')).toEqual({
      range: null,
      error: 'Start date and time must be earlier than or equal to the end date and time.',
    });
  });
});

describe('formatRangeLabel', () => {
  it('names both ends', () => {
    const label = formatRangeLabel({ startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-24T00:00:00.000Z' });
    expect(label).toMatch(/2026/);
    expect(label).toContain(' – ');
  });
});

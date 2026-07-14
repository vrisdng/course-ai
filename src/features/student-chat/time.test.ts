import { describe, expect, it } from 'vitest';
import { formatCitationLocator, formatTimestamp } from './time';

describe('time formatting', () => {
  it('formats negative, minute, and hour timestamps', () => {
    expect(formatTimestamp(-1)).toBe('0:00');
    expect(formatTimestamp(65_999)).toBe('1:05');
    expect(formatTimestamp(3_661_000)).toBe('1:01:01');
  });

  it('prefers timestamp ranges, then pages, then a fallback', () => {
    expect(formatCitationLocator({ startMs: 1_000, endMs: 3_000, pageNumber: 9 })).toBe('0:01-0:03');
    expect(formatCitationLocator({ startMs: 1_000 })).toBe('0:01');
    expect(formatCitationLocator({ pageNumber: 0 })).toBe('Page 0');
    expect(formatCitationLocator({})).toBe('Location not available');
  });
});

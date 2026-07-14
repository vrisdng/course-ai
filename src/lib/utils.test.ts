import { describe, expect, it } from 'vitest';
import { cn, formatBytes } from './utils';

describe('shared UI utilities', () => {
  it('merges conditional and conflicting Tailwind classes', () => {
    expect(cn('px-2', null, 'px-4')).toBe('px-4');
  });

  it('formats unknown, bytes, kilobytes, and megabytes', () => {
    expect(formatBytes(null)).toBe('Unknown size');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

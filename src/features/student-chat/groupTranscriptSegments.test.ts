import { describe, expect, it } from 'vitest';
import { groupSegmentsIntoParagraphs } from './groupTranscriptSegments';

describe('groupSegmentsIntoParagraphs', () => {
  it('handles empty input and joins short segments into one trimmed paragraph', () => {
    expect(groupSegmentsIntoParagraphs([])).toEqual([]);
    expect(groupSegmentsIntoParagraphs([
      { start_ms: 0, end_ms: 10_000, text: ' Hello ' },
      { start_ms: 10_000, end_ms: 20_000, text: 'world.' },
    ])).toEqual([{ id: 'para-0', startMs: 0, endMs: 20_000, text: 'Hello  world.', index: 0 }]);
  });

  it('waits for a sentence boundary after one minute', () => {
    const result = groupSegmentsIntoParagraphs([
      { start_ms: 0, end_ms: 60_000, text: 'Still speaking' },
      { start_ms: 60_000, end_ms: 70_000, text: 'finished!' },
      { start_ms: 70_000, end_ms: 75_000, text: 'Next thought.' },
    ]);
    expect(result.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual([
      { startMs: 0, endMs: 70_000, text: 'Still speaking finished!' },
      { startMs: 70_000, endMs: 75_000, text: 'Next thought.' },
    ]);
  });

  it('hard-cuts at the ninety-second grace limit without punctuation', () => {
    const result = groupSegmentsIntoParagraphs([
      { start_ms: 0, end_ms: 60_000, text: 'one' },
      { start_ms: 60_000, end_ms: 90_000, text: 'two' },
      { start_ms: 90_000, end_ms: 100_000, text: 'three' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ endMs: 90_000, text: 'one two' });
  });
});

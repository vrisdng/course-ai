// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { selectCitedVideoSegments } from './videoEvidence.ts';
const segments = [
  { id: 'a', segmentIndex: 1, startMs: 100, endMs: 200, text: 'First claim.' },
  { id: 'b', segmentIndex: 2, startMs: 200, endMs: 300, text: 'Second claim.' },
];
describe('direct video evidence', () => {
  it('resolves only shown segment indexes, deduplicated in time order', () => {
    expect(selectCitedVideoSegments([1, 0, 1, 9, -1, 0.5], segments)).toEqual(segments);
  });
  it('keeps whole-source citations approximate rather than inventing precise evidence', () => {
    expect(selectCitedVideoSegments([], segments)).toEqual([]);
  });
  it('cannot resolve a segment that was clipped out of the model context', () => {
    expect(selectCitedVideoSegments([1], segments.slice(0, 1))).toEqual([]);
  });
});

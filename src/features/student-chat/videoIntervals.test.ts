import { describe, expect, it } from 'vitest';

import { getVideoInterval } from './videoIntervals';

describe('getVideoInterval', () => {
  it('uses the citation interval when there is no exact evidence', () => {
    expect(getVideoInterval({ startMs: 40_000, endMs: 45_000 })).toEqual({
      startMs: 40_000,
      endMs: 45_000,
      exact: false,
    });
  });

  it('uses the full evidence span when exact segments exist', () => {
    expect(getVideoInterval({
      startMs: 40_000,
      endMs: 60_000,
      evidenceSegments: [
        { id: 'b', segmentIndex: 2, startMs: 65_260, endMs: 69_000, text: 'Second.' },
        { id: 'a', segmentIndex: 1, startMs: 63_000, endMs: 65_500, text: 'First.' },
      ],
    })).toEqual({
      startMs: 63_000,
      endMs: 69_000,
      exact: true,
    });
  });

  it('treats an empty evidence list as the approximate citation interval', () => {
    expect(getVideoInterval({ startMs: 10_000, endMs: 20_000, evidenceSegments: [] })).toEqual({
      startMs: 10_000,
      endMs: 20_000,
      exact: false,
    });
  });
});

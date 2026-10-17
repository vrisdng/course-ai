import { describe, expect, it } from 'vitest';

import { parseVideoEvidenceSegments } from './videoEvidence';

describe('parseVideoEvidenceSegments', () => {
  const segment = { id: 's1', segmentIndex: 2, startMs: 1000, endMs: 2000, text: 'The supporting line.' };

  it('keeps a valid persisted evidence snapshot', () => {
    expect(parseVideoEvidenceSegments([segment])).toEqual([segment]);
  });

  it('treats missing or malformed evidence as an approximate legacy citation', () => {
    expect(parseVideoEvidenceSegments(null)).toBeNull();
    expect(parseVideoEvidenceSegments([{ ...segment, startMs: 'one' }])).toBeNull();
    expect(parseVideoEvidenceSegments([{ ...segment, endMs: 0 }])).toBeNull();
  });
});

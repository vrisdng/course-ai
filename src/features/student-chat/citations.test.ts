import { describe, expect, it } from 'vitest';
import { getCitationKey, groupAdjacentCitations, isWebcastCitation, markdownWithCitationLinks, normalizeHeadings } from './citations';
import type { Citation } from './types';

const citation = (documentType: string): Citation => ({
  id: documentType, chunkId: `chunk-${documentType}`, excerpt: 'Excerpt', documentName: 'Source',
  documentType, relevanceScore: 0.9,
});

describe('student chat citation formatting', () => {
  it('builds stable keys and identifies webcast types case-insensitively', () => {
    expect(getCitationKey('message', 2)).toBe('message-2');
    expect(isWebcastCitation(citation('VIDEO'))).toBe(true);
    expect(isWebcastCitation(citation('pdf'))).toBe(false);
    expect(isWebcastCitation({ ...citation('pdf'), documentType: undefined! })).toBe(false);
  });

  it('adds the blank line markdown requires before headings', () => {
    expect(normalizeHeadings('Paragraph\n## Heading')).toBe('Paragraph\n\n## Heading');
    expect(normalizeHeadings('Paragraph\n\n## Heading')).toBe('Paragraph\n\n## Heading');
  });

  it('groups only adjacent citations spanning webcast and notes sources', () => {
    const sources = [citation('video'), citation('pdf'), citation('transcript')];
    expect(groupAdjacentCitations('Claim <<cite:1>> <<cite:2>>', sources)).toBe('Claim <<cite:1+2>>');
    expect(groupAdjacentCitations('Claim <<cite:1>><<cite:3>>', sources)).toBe('Claim <<cite:1>><<cite:3>>');
    expect(groupAdjacentCitations('Claim <<cite:1>>', sources)).toBe('Claim <<cite:1>>');
    expect(groupAdjacentCitations('Claim <<cite:1>><<cite:99>>', sources)).toBe('Claim <<cite:1>><<cite:99>>');
  });

  it('normalizes current and legacy citation syntax and rejects out-of-range tokens', () => {
    expect(markdownWithCitationLinks('See << CITE : 2 >>, [1], and (2).', 2))
      .toBe('See [\\[2\\]](citation:2), [\\[1\\]](citation:1), and [\\[2\\]](citation:2).');
    expect(markdownWithCitationLinks('Bad <<cite:3>> and [3].', 2)).toBe('Bad  and [3].');
    expect(markdownWithCitationLinks('Combined <<cite:1+2>>', 2)).toBe('Combined [\\[1·2\\]](citation:1+2)');
  });
});

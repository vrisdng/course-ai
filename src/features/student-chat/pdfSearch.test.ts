import { describe, expect, it } from 'vitest';

import { findMatches, highlightMatches } from './pdfSearch';

describe('findMatches', () => {
  // Each page is the list of its text-layer items.
  const pages = [['Open addressing stores keys.', 'Linear probing.'], ['Double hashing.'], ['Probing again: PROBING']];

  it('finds every match, case-insensitively, in page then item order', () => {
    expect(findMatches(pages, 'probing')).toEqual([
      { page: 1, item: 1, occurrence: 0 },
      { page: 3, item: 0, occurrence: 0 },
      { page: 3, item: 0, occurrence: 1 },
    ]);
  });

  it('treats runs of whitespace as one space', () => {
    expect(findMatches([['Linear   probing']], 'linear probing')).toEqual([{ page: 1, item: 0, occurrence: 0 }]);
  });

  it('finds nothing for a blank or one-letter query', () => {
    expect(findMatches(pages, '')).toEqual([]);
    expect(findMatches(pages, ' p ')).toEqual([]);
  });
});

describe('highlightMatches', () => {
  const hit = (text: string) => `<mark class="pdf-search-hit">${text}</mark>`;
  const active = (text: string) => `<mark class="pdf-search-hit pdf-search-hit--active">${text}</mark>`;

  it('outlines every match and fills only the active occurrence', () => {
    expect(highlightMatches('probing and Probing', 'probing', 1)).toBe(`${hit('probing')} and ${active('Probing')}`);
    expect(highlightMatches('probing and Probing', 'probing', null)).toBe(`${hit('probing')} and ${hit('Probing')}`);
  });

  it('escapes the page text so it is never treated as HTML', () => {
    expect(highlightMatches('a <b> & probing', 'probing', null)).toBe(`a &lt;b&gt; &amp; ${hit('probing')}`);
  });

  it('treats regex characters in the query literally', () => {
    expect(highlightMatches('cost O(1) here', 'o(1)', 0)).toBe(`cost ${active('O(1)')} here`);
  });

  it('returns escaped text unchanged without a usable query', () => {
    expect(highlightMatches('a < b', 'x', null)).toBe('a &lt; b');
  });
});

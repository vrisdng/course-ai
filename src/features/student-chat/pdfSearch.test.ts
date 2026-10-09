import { describe, expect, it } from 'vitest';

import { findMatches, highlightMatches } from './pdfSearch';

describe('findMatches', () => {
  const pages = ['Open addressing stores keys. Linear probing.', 'Double hashing.', 'Probing again: PROBING'];

  it('finds every match, case-insensitively, in page order', () => {
    expect(findMatches(pages, 'probing')).toEqual([
      { page: 1, offset: 36 },
      { page: 3, offset: 0 },
      { page: 3, offset: 15 },
    ]);
  });

  it('treats runs of whitespace as one space', () => {
    expect(findMatches(['Linear   probing'], 'linear probing')).toEqual([{ page: 1, offset: 0 }]);
  });

  it('finds nothing for a blank or one-letter query', () => {
    expect(findMatches(pages, '')).toEqual([]);
    expect(findMatches(pages, ' p ')).toEqual([]);
  });
});

describe('highlightMatches', () => {
  it('wraps matches in <mark>, case-insensitively', () => {
    expect(highlightMatches('Linear probing and Probing', 'probing')).toBe(
      'Linear <mark class="pdf-search-hit">probing</mark> and <mark class="pdf-search-hit">Probing</mark>',
    );
  });

  it('escapes the page text so it is never treated as HTML', () => {
    expect(highlightMatches('a <b> & probing', 'probing')).toBe(
      'a &lt;b&gt; &amp; <mark class="pdf-search-hit">probing</mark>',
    );
  });

  it('treats regex characters in the query literally', () => {
    expect(highlightMatches('cost O(1) here', 'o(1)')).toBe('cost <mark class="pdf-search-hit">O(1)</mark> here');
  });

  it('returns escaped text unchanged without a usable query', () => {
    expect(highlightMatches('a < b', 'x')).toBe('a &lt; b');
  });
});

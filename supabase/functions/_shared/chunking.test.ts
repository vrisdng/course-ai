import { describe, expect, it } from 'vitest';
import { chunkText } from './chunking';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// Mathematical italic x (U+1D465): one character, two UTF-16 code units, common in PDF maths.
const MATH_X = '\u{1D465}';

describe('chunkText', () => {
  it('normalizes whitespace and returns no empty chunks', () => {
    expect(chunkText(' \r\n\t ', 200, 0)).toEqual([]);
    expect(chunkText('one\r\ntwo\tthree   four', 200, 0)).toEqual([
      { text: 'one\ntwo three four', start: 0, end: 18 },
    ]);
  });

  it('enforces safe size and overlap bounds while preserving positions', () => {
    const text = 'x'.repeat(450);
    const chunks = chunkText(text, 100, 999);
    expect(chunks.map(({ start, end, text: value }) => ({ start, end, length: value.length }))).toEqual([
      { start: 0, end: 200, length: 200 },
      { start: 100, end: 300, length: 200 },
      { start: 200, end: 400, length: 200 },
      { start: 300, end: 450, length: 150 },
      { start: 400, end: 450, length: 50 },
    ]);
  });

  it('never splits a surrogate pair at a chunk boundary', () => {
    // An odd step and an odd prefix put naive start and end boundaries mid-character.
    const text = 'a' + MATH_X.repeat(400);
    const chunks = chunkText(text, 201, 0);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(LONE_SURROGATE);
      expect(text.slice(chunk.start, chunk.end).trim()).toBe(chunk.text);
    }
  });

  it('never splits a surrogate pair when chunks overlap', () => {
    const text = MATH_X.repeat(1500);
    const chunks = chunkText(text, 1201, 201);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(LONE_SURROGATE);
    }
  });

  it('removes null bytes and other control characters Postgres cannot store', () => {
    expect(chunkText('a\u0000b\u0007c\u001Fd\ne', 200, 0)).toEqual([
      { text: 'abcd\ne', start: 0, end: 6 },
    ]);
  });

  it('removes lone surrogates already present in the input', () => {
    expect(chunkText('a\uD835b\uDC65c' + MATH_X, 200, 0)).toEqual([
      { text: 'abc' + MATH_X, start: 0, end: 5 },
    ]);
  });
});

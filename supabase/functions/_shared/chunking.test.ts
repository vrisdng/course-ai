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
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
  });

  it('never splits a surrogate pair when chunks overlap', () => {
    const text = MATH_X.repeat(1500);
    const chunks = chunkText(text, 1201, 201);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(LONE_SURROGATE);
    }
  });

  it.each(
    Array.from({ length: 32 }, (_, code) => code).filter((code) => code !== 10 && code !== 13),
  )('preserves word boundaries for C0 control character %i', (code) => {
    expect(chunkText(`first${String.fromCharCode(code)}second`, 200, 0)).toEqual([
      { text: 'first second', start: 0, end: 12 },
    ]);
  });

  it('collapses control separators into spaces while retaining line breaks', () => {
    expect(chunkText(' first\f\t\v  second\r\nthird\rfourth\nfifth\u0000 ', 200, 0)).toEqual([
      { text: 'first second\nthird\rfourth\nfifth', start: 0, end: 31 },
    ]);
  });

  it('removes lone surrogates already present in the input', () => {
    expect(chunkText('a\uD835b\uDC65c' + MATH_X, 200, 0)).toEqual([
      { text: 'abc' + MATH_X, start: 0, end: 5 },
    ]);
  });

  it('removes only unpaired surrogates next to valid pairs and separators', () => {
    const text = `\uDC65${MATH_X}\uD835\f\uDC65${MATH_X}\uD835`;
    expect(chunkText(text, 200, 0)).toEqual([
      { text: `${MATH_X} ${MATH_X}`, start: 0, end: 5 },
    ]);
  });

  it('returns no chunks for input containing only controls and lone surrogates', () => {
    expect(chunkText('\u0000\f\v\t\uD835 \uDC65\r\n', 200, 0)).toEqual([]);
  });

  it.each([0, 200])('keeps sanitized positions and valid pairs with overlap %i', (overlap) => {
    const text = ` first\f a${MATH_X.repeat(1200)}\uD835second\uDC65\u0000third `;
    const cleaned = `first a${MATH_X.repeat(1200)}second third`;
    const chunks = chunkText(text, 1200, overlap);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(LONE_SURROGATE);
      expect(chunk.text).toBe(cleaned.slice(chunk.start, chunk.end).trim());
    }
    expect(chunks[0].text).toMatch(/^first a/);
    expect(chunks.at(-1)?.text).toMatch(/second third$/);
  });
});

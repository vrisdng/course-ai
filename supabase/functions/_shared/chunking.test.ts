import { describe, expect, it } from 'vitest';
import { chunkText } from './chunking';

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
});

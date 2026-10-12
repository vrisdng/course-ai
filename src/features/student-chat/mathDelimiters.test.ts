import { describe, expect, it } from 'vitest';

import { normalizeMathDelimiters } from './mathDelimiters';

describe('normalizeMathDelimiters', () => {
  it('turns backslash-paren inline maths into dollar maths', () => {
    expect(normalizeMathDelimiters('The area is \\(\\pi r^2\\) here.')).toBe('The area is $\\pi r^2$ here.');
  });

  it('turns backslash-bracket display maths into a $$ block on its own lines', () => {
    expect(normalizeMathDelimiters('Value: \\[\\text{Total} = a + b\\] done.')).toBe(
      'Value: \n$$\n\\text{Total} = a + b\n$$\n done.',
    );
  });

  it('leaves dollar maths, plain text and lone dollars unchanged', () => {
    const src = 'Mass $E=mc^2$ and\n\n$$\\frac{a}{b}$$\n\ncosts $5 each';
    expect(normalizeMathDelimiters(src)).toBe(src);
  });

  it('leaves fenced code and inline code untouched', () => {
    const src = '```latex\n\\(x\\) \\[y\\]\n```\nUse `\\(z\\)` here.';
    expect(normalizeMathDelimiters(src)).toBe(src);
  });
});

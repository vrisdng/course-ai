import { describe, expect, it } from 'vitest';
import katex from 'katex';

import { processMath } from './processMath';

describe('processMath', () => {
  it('renders inline LaTeX to KaTeX HTML', () => {
    const out = processMath('Mass $E=mc^2$ energy.');
    expect(out).toContain('katex');
    expect(out).not.toContain('$E=mc^2$');
  });

  it('renders block LaTeX as display mode', () => {
    const src = 'Equation:\n\n$$\\frac{a}{b}$$\n\ndone.';
    const out = processMath(src);
    expect(out).toContain('katex');
    expect(out).not.toContain('$\\frac{a}{b}$$');
    expect(out).toContain('\\frac{a}{b}');
    expect(out).toContain('done.');
  });

  it('renders block LaTeX delimited by backslash brackets', () => {
    const src = 'Value:\n\n\\[\\text{Total} = \\ldots\\]\n\ndone.';
    const out = processMath(src);
    expect(out).toContain('katex');
    expect(out).not.toContain('\\[');
    expect(out).not.toContain('\\]');
    expect(out).toContain('\\text{Total} = \\ldots');
    expect(out).toContain('done.');
  });

  it('renders inline LaTeX delimited by backslash parens', () => {
    const src = 'The area is \\(\\pi r^2\\) here.';
    const out = processMath(src);
    expect(out).toContain('katex');
    expect(out).not.toContain('\\(');
    expect(out).not.toContain('\\)');
    expect(out).toContain('\\pi r^2');
    expect(out).toContain('here.');
  });

  it('leaves fenced code blocks untouched', () => {
    const src = '```python\nx = "$not_math"\n```';
    expect(processMath(src)).toBe(src);
  });

  it('leaves inline code spans untouched', () => {
    const src = 'Use `let y = $z$;` here.';
    expect(processMath(src)).toBe(src);
  });

  it('leaves unmatched dollars alone', () => {
    expect(processMath('costs $5 each')).toBe('costs $5 each');
  });

  it('renders math that sits next to code fences in the same document', () => {
    const src = 'Formula $a^2+b^2=c^2$ then code\n\n```text\n$ stays literal\n```';
    const out = processMath(src);
    expect(out).toContain('katex');
    expect(out).toContain('$ stays literal');
  });
});

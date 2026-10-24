import { describe, expect, it } from 'vitest';

import { pickTopTerms, type QuestionTerm } from './questionTerms';

const term = (key: string, text: string, questionCount: number): QuestionTerm => ({
  key,
  term: text,
  wordCount: key.split(' ').length,
  questionCount,
  studentCount: 1,
});

describe('pickTopTerms', () => {
  it('drops a word that mostly appears inside a phrase', () => {
    const picked = pickTopTerms([
      term('cortado compani', 'cortado company', 4),
      term('cortado', 'cortado', 4),
      term('compani', 'company', 5),
      term('hash', 'hashing', 8),
      term('hash tabl', 'hash table', 4),
    ]);
    expect(picked.map((t) => t.term)).toEqual(['hashing', 'cortado company', 'hash table']);
  });

  it('keeps a word much more common than its phrases', () => {
    const picked = pickTopTerms([term('tree', 'tree', 10), term('binari tree', 'binary tree', 3)]);
    expect(picked.map((t) => t.term)).toEqual(['tree', 'binary tree']);
  });

  it('ranks by questions, phrases first on a tie, and applies the limit', () => {
    const picked = pickTopTerms([term('probe', 'probing', 3), term('linear chain', 'linear chaining', 3), term('heap', 'heap', 9)], 2);
    expect(picked.map((t) => t.term)).toEqual(['heap', 'linear chaining']);
  });

  it('handles no terms', () => {
    expect(pickTopTerms([])).toEqual([]);
  });
});

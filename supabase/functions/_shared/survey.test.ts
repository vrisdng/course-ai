import { describe, expect, it } from 'vitest';

import { parseSurveyAnswers } from './survey';

describe('survey answers parser', () => {
  it('trims answers and drops blank responses', () => {
    expect(parseSurveyAnswers([
      { question: ' 1. Ease? ', answer: ' 5 ' },
      { question: '2. Task?', answer: '   ' },
    ])).toEqual([{ question: '1. Ease?', answer: '5' }]);
  });

  it('rejects malformed, oversized, or missing answer collections', () => {
    expect(() => parseSurveyAnswers(null)).toThrow('answers must be an array');
    expect(() => parseSurveyAnswers([{ question: 'Q' }])).toThrow('Each answer needs a question and an answer');
    expect(() => parseSurveyAnswers(Array.from({ length: 41 }, () => ({ question: 'Q', answer: 'A' })))).toThrow('Too many answers');
    expect(() => parseSurveyAnswers([{ question: 'Q', answer: 'x'.repeat(5001) }])).toThrow('Answer is too long');
  });
});

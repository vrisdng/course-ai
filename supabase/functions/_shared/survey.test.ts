import { describe, expect, it } from 'vitest';

import { buildSurveyEmail, escapeHtml, parseSurveyAnswers } from './survey';

describe('survey email payload', () => {
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

  it('escapes HTML so answers cannot inject markup into the email', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'quoted'`))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;');
  });

  it('formats every answer into the subject, HTML, and plain text', () => {
    const email = buildSurveyEmail(
      [
        { question: '1. How easy was it?', answer: 'Very easy' },
        { question: '14. What broke?', answer: 'Upload <froze>\nAfter sign-in' },
      ],
      new Date('2026-10-28T04:05:06.000Z'),
    );

    expect(email.subject).toBe('CEEGPT survey response (2 answers)');
    expect(email.html).toContain('2026-10-28T04:05:06.000Z');
    expect(email.html).toContain('1. How easy was it?');
    expect(email.html).toContain('Very easy');
    expect(email.html).toContain('Upload &lt;froze&gt;');
    expect(email.html).toContain('white-space:pre-wrap');
    expect(email.text).toContain('1. How easy was it?\nVery easy');
    expect(email.text).toContain('14. What broke?\nUpload <froze>\nAfter sign-in');
  });
});

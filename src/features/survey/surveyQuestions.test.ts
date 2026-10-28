import { describe, expect, it } from 'vitest';

import {
  buildSurveyAnswers,
  matrixAnswerKey,
  SURVEY_FEATURES,
  SURVEY_QUESTIONS,
  SURVEY_SECTIONS,
} from './surveyQuestions';

describe('survey questions', () => {
  it('contains all twenty numbered questions across the four sections', () => {
    expect(SURVEY_QUESTIONS).toHaveLength(20);
    expect(SURVEY_QUESTIONS.map((question) => question.number)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(new Set(SURVEY_QUESTIONS.map((question) => question.section))).toEqual(
      new Set(SURVEY_SECTIONS.map((section) => section.id)),
    );
  });

  it('offers every priority feature in the importance matrix', () => {
    const matrix = SURVEY_QUESTIONS.find((question) => question.kind === 'matrix');
    expect(matrix?.features).toEqual(SURVEY_FEATURES);
  });

  it('keeps questions optional by omitting blank answers', () => {
    expect(buildSurveyAnswers({})).toEqual([]);
    expect(buildSurveyAnswers({ 'wanted-feature': '   ' })).toEqual([]);
  });

  it('trims answered questions into the email payload', () => {
    const answers = buildSurveyAnswers({
      'first-answer-ease': ' 5 ',
      'frustrating-moment': '  The source panel was hard to find.  ',
    });

    expect(answers).toEqual([
      {
        question: '1. How easy was it to get your first useful answer?',
        answer: '5',
      },
      {
        question: '5. What was the most frustrating moment?',
        answer: 'The source panel was hard to find.',
      },
    ]);
  });

  it('expands each rated feature into its own answer', () => {
    const answers = buildSurveyAnswers({
      [matrixAnswerKey('feature-importance', 'Mobile use')]: '5',
      [matrixAnswerKey('feature-importance', 'Offline access')]: '2',
    });

    expect(answers).toEqual([
      {
        question: '18. Rate the importance of each of the following. — Mobile use',
        answer: '5',
      },
      {
        question: '18. Rate the importance of each of the following. — Offline access',
        answer: '2',
      },
    ]);
  });
});

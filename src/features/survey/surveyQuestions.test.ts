import { describe, expect, it } from 'vitest';

import {
  buildSurveyAnswers,
  matrixAnswerKey,
  SURVEY_QUESTIONS,
  SURVEY_SECTIONS,
} from './surveyQuestions';

describe('survey questions', () => {
  it('matches the twelve numbered questions in the feedback survey', () => {
    expect(SURVEY_QUESTIONS).toHaveLength(13);
    expect(SURVEY_QUESTIONS.map((question) => question.number)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12],
    );
    expect(new Set(SURVEY_QUESTIONS.map((question) => question.section))).toEqual(new Set(SURVEY_SECTIONS.map((section) => section.id)));
    expect(SURVEY_QUESTIONS.map((question) => question.prompt)).toEqual([
      'Which course are you using the Learning Companion for?',
      'How frequently have you used the Learning Companion for this course?',
      'What have you used the Learning Companion for during your exam revision?',
      'To what extent do you agree with the following statement? “Using the Learning Companion has helped me better understand the course content during my study.”',
      'In what ways has the Learning Companion helped with your learning?',
      'How would you rate the following aspects of the AI-generated responses?',
      'What problems have you encountered when using the Learning Companion?',
      'Compared with general-purpose AI tools such as ChatGPT, how useful is the Learning Companion for revising this course?',
      'What do you like most about the Learning Companion?',
      'Which new features would you find most useful?',
      'Which aspects of the Learning Companion do you think need improvement?',
      'Overall, how satisfied are you with the Learning Companion?',
      'Any additional comments? (Optional)',
    ]);
  });

  it('keeps questions optional by omitting blank answers', () => {
    expect(buildSurveyAnswers({})).toEqual([]);
    expect(buildSurveyAnswers({ 'course-code': '   ' })).toEqual([]);
  });

  it('trims answered questions into the email payload', () => {
    const answers = buildSurveyAnswers({
      'course-code': '  CEE  ',
      'usage-frequency': '  A few times ',
    });

    expect(answers).toEqual([
      { question: '1. Which course are you using the Learning Companion for?', answer: 'CEE' },
      { question: '2. How frequently have you used the Learning Companion for this course?', answer: 'A few times' },
    ]);
  });

  it('keeps every selected multi-choice answer and its other response', () => {
    const answers = buildSurveyAnswers({
      'revision-uses': 'Clarify concepts that I do not understand\nOther (please specify)',
      'revision-uses:other': 'Practise explaining answers aloud',
    });

    expect(answers).toEqual([{
      question: '3. What have you used the Learning Companion for during your exam revision?',
      answer: 'Clarify concepts that I do not understand; Other (please specify): Practise explaining answers aloud',
    }]);
  });

  it('expands each AI response rating into its own answer', () => {
    const answers = buildSurveyAnswers({
      [matrixAnswerKey('response-quality', 'Relevance – answers address my questions')]: '5',
      [matrixAnswerKey('response-quality', 'Citations – references help me verify the answers')]: '4',
    });

    expect(answers).toEqual([
      {
        question: '6. How would you rate the following aspects of the AI-generated responses? — Relevance – answers address my questions',
        answer: '5',
      },
      {
        question: '6. How would you rate the following aspects of the AI-generated responses? — Citations – references help me verify the answers',
        answer: '4',
      },
    ]);
  });
});

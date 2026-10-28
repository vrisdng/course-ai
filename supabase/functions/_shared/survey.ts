export interface SurveyAnswer {
  question: string;
  answer: string;
}

const MAX_ANSWERS = 40;
const MAX_QUESTION_LENGTH = 600;
const MAX_ANSWER_LENGTH = 5000;

export function parseSurveyAnswers(input: unknown): SurveyAnswer[] {
  if (!Array.isArray(input)) {
    throw new Error('answers must be an array');
  }

  if (input.length > MAX_ANSWERS) {
    throw new Error('Too many answers');
  }

  const answers: SurveyAnswer[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each answer must be an object');
    }

    const record = item as Record<string, unknown>;
    if (typeof record.question !== 'string' || typeof record.answer !== 'string') {
      throw new Error('Each answer needs a question and an answer');
    }

    const question = record.question.trim();
    const answer = record.answer.trim();
    if (!question || !answer) {
      continue;
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      throw new Error('Question is too long');
    }

    if (answer.length > MAX_ANSWER_LENGTH) {
      throw new Error('Answer is too long');
    }

    answers.push({ question, answer });
  }

  return answers;
}

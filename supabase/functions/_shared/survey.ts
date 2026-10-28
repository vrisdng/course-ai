export interface SurveyAnswer {
  question: string;
  answer: string;
}

export interface SurveyEmailContent {
  subject: string;
  html: string;
  text: string;
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSurveyEmail(answers: SurveyAnswer[], submittedAt: Date): SurveyEmailContent {
  const answerLabel = answers.length === 1 ? 'answer' : 'answers';
  const subject = `CEEGPT survey response (${answers.length} ${answerLabel})`;
  const submitted = submittedAt.toISOString();

  const rows = answers
    .map((entry) => `
      <tr>
        <td style="padding:10px 12px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;vertical-align:top;width:38%;">${escapeHtml(entry.question)}</td>
        <td style="padding:10px 12px;border:1px solid #e5e7eb;white-space:pre-wrap;vertical-align:top;">${escapeHtml(entry.answer)}</td>
      </tr>`)
    .join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="padding:20px 24px;background:#111827;color:#ffffff;">
        <h1 style="margin:0;font-size:20px;">CEEGPT feedback survey</h1>
      </div>
      <div style="padding:20px 24px;">
        <p style="margin:0 0 16px;font-size:14px;color:#4b5563;">Submitted: ${escapeHtml(submitted)}</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </body>
</html>`;

  const text = [
    'CEEGPT feedback survey',
    `Submitted: ${submitted}`,
    '',
    ...answers.map((entry, index) => `${index + 1}. ${entry.question}\n${entry.answer}\n`),
  ].join('\n');

  return { subject, html, text };
}

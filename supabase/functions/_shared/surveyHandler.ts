import { corsHeaders } from './cors.ts';
import { buildSurveyEmail, parseSurveyAnswers, type SurveyEmailContent } from './survey.ts';

export interface SurveyEmailMessage extends SurveyEmailContent {
  to: string;
  from: string;
}

export type SurveyAuthResult = Response | { userId: string };

export interface SubmitSurveyDeps {
  authenticate: (req: Request) => Promise<SurveyAuthResult>;
  sendEmail: (message: SurveyEmailMessage) => Promise<void>;
  recipientEmail: string;
  fromEmail: string;
  now?: () => Date;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function handleSubmitSurvey(req: Request, deps: SubmitSurveyDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await deps.authenticate(req);
  if (auth instanceof Response) {
    return auth;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const answersInput = body && typeof body === 'object'
    ? (body as Record<string, unknown>).answers
    : undefined;

  let answers: ReturnType<typeof parseSurveyAnswers>;
  try {
    answers = parseSurveyAnswers(answersInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid answers';
    return jsonResponse({ error: message }, 400);
  }

  if (answers.length === 0) {
    return jsonResponse({ error: 'Please answer at least one question.' }, 400);
  }

  const content = buildSurveyEmail(answers, deps.now?.() ?? new Date());

  try {
    await deps.sendEmail({
      ...content,
      to: deps.recipientEmail,
      from: deps.fromEmail,
    });
  } catch (error) {
    console.error('submit-survey email error:', error);
    return jsonResponse({ error: 'We could not save your response. Please try again.' }, 500);
  }

  return jsonResponse({ success: true });
}

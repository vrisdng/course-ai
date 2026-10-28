import { describe, expect, it, vi } from 'vitest';

import { handleSubmitSurvey, jsonResponse, type SubmitSurveyDeps } from './surveyHandler';

const request = (body: unknown, method = 'POST') => new Request('http://local/survey', {
  method,
  headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
  body: method === 'POST' ? JSON.stringify(body) : undefined,
});

function deps(overrides: Partial<SubmitSurveyDeps> = {}): SubmitSurveyDeps {
  return {
    authenticate: vi.fn().mockResolvedValue({ userId: 'user-1' }),
    sendEmail: vi.fn().mockResolvedValue(undefined),
    recipientEmail: 'owner@example.test',
    fromEmail: 'CEEGPT Survey <survey@example.test>',
    now: () => new Date('2026-10-28T00:00:00.000Z'),
    ...overrides,
  };
}

describe('submit survey handler', () => {
  it('answers CORS preflight requests', async () => {
    const authenticate = vi.fn();
    const response = await handleSubmitSurvey(request({}, 'OPTIONS'), deps({ authenticate }));

    expect(response.status).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods', async () => {
    const response = await handleSubmitSurvey(request({}, 'GET'), deps());
    expect(response.status).toBe(405);
  });

  it('requires an authenticated user', async () => {
    const response = await handleSubmitSurvey(
      request({ answers: [{ question: 'Q', answer: 'A' }] }),
      deps({ authenticate: vi.fn().mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401)) }),
    );

    expect(response.status).toBe(401);
  });

  it('rejects invalid JSON and empty answers', async () => {
    const invalidJson = await handleSubmitSurvey(
      new Request('http://local/survey', {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
        body: '{',
      }),
      deps(),
    );
    expect(invalidJson.status).toBe(400);

    const empty = await handleSubmitSurvey(request({ answers: [] }), deps());
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'Please answer at least one question.' });
  });

  it('emails optional answers to the configured recipient', async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const response = await handleSubmitSurvey(
      request({
        answers: [
          { question: '1. How easy was it?', answer: '5' },
          { question: '5. Frustrating moment?', answer: '' },
        ],
      }),
      deps({ sendEmail }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.test',
      from: 'CEEGPT Survey <survey@example.test>',
      subject: 'CEEGPT survey response (1 answer)',
    }));
    expect(sendEmail.mock.calls[0][0].html).toContain('1. How easy was it?');
    expect(sendEmail.mock.calls[0][0].text).toContain('1. How easy was it?\n5');
  });

  it('does not leak provider details when email delivery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handleSubmitSurvey(
      request({ answers: [{ question: 'Q', answer: 'A' }] }),
      deps({ sendEmail: vi.fn().mockRejectedValue(new Error('resend down')) }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'We could not save your response. Please try again.',
    });
  });
});

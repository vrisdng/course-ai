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
    save: vi.fn().mockResolvedValue('row-1'),
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

  it('saves non-blank answers to the database and returns the row id', async () => {
    const save = vi.fn().mockResolvedValue('row-1');
    const response = await handleSubmitSurvey(
      request({
        answers: [
          { question: '1. How easy was it?', answer: '5' },
          { question: '5. Frustrating moment?', answer: '' },
        ],
      }),
      deps({ save }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: 'row-1' });
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith({
      userId: 'user-1',
      answers: [{ question: '1. How easy was it?', answer: '5' }],
    });
  });

  it('returns a generic error when saving fails', async () => {
    const response = await handleSubmitSurvey(
      request({ answers: [{ question: 'Q', answer: 'A' }] }),
      deps({ save: vi.fn().mockRejectedValue(new Error('postgres down')) }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'We could not save your response. Please try again.',
    });
  });
});

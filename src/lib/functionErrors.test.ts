import { describe, expect, it } from 'vitest';

import { UploadRejectedError, functionInvokeError } from './functionErrors';

const httpError = (status: number, body: string) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(body, { status }),
});

describe('functionInvokeError', () => {
  it('turns a 415 admission refusal into an UploadRejectedError with the server message', async () => {
    const error = await functionInvokeError(httpError(415, JSON.stringify({ error: 'Only PDF', code: 'unsupported_type' })), 'Failed');
    expect(error).toBeInstanceOf(UploadRejectedError);
    expect(error.message).toBe('Only PDF');
    expect((error as UploadRejectedError).code).toBe('unsupported_type');
  });

  it('uses the JSON error body of other failures, with an optional prefix', async () => {
    const error = await functionInvokeError(httpError(500, JSON.stringify({ error: 'Queue down' })), 'Failed', 'Session: ');
    expect(error).not.toBeInstanceOf(UploadRejectedError);
    expect(error.message).toBe('Session: Queue down');
  });

  it('falls back to the client error message, then to the fallback', async () => {
    expect((await functionInvokeError(httpError(502, 'not json'), 'Failed')).message).toBe(
      'Edge Function returned a non-2xx status code',
    );
    expect((await functionInvokeError({ message: 'Failed to send a request' }, 'Failed')).message).toBe('Failed to send a request');
    expect((await functionInvokeError(null, 'Failed')).message).toBe('Failed');
  });

  it('does not treat a 415 without a message body as a policy rejection', async () => {
    const error = await functionInvokeError(httpError(415, '{}'), 'Failed');
    expect(error).not.toBeInstanceOf(UploadRejectedError);
  });
});

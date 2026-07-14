import { describe, expect, it } from 'vitest';
import { formatSseEvent, isAbortError, throwIfAborted } from './sse';

describe('server SSE helpers', () => {
  it('encodes named JSON events', () => {
    expect(formatSseEvent('delta', { text: 'hello' })).toBe('event: delta\ndata: {"text":"hello"}\n\n');
  });

  it('recognizes abort errors and throws for aborted signals', () => {
    expect(isAbortError(new DOMException('stopped', 'AbortError'))).toBe(true);
    const error = new Error('stopped'); error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
    expect(isAbortError(new Error('other'))).toBe(false);
    expect(() => throwIfAborted()).not.toThrow();
    const controller = new AbortController(); controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrowError(/aborted/i);
  });
});

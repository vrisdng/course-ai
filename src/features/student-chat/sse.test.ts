import { describe, expect, it } from 'vitest';

import { parseMaybeJson, parseSseEventBlock } from './sse';

describe('parseSseEventBlock', () => {
  it('parses an event with a named type and JSON data', () => {
    const block = 'event: token\ndata: {"text":"hi"}';
    expect(parseSseEventBlock(block)).toEqual({ event: 'token', data: '{"text":"hi"}' });
  });

  it('defaults to the "message" event type when none is given', () => {
    const block = 'data: hello';
    expect(parseSseEventBlock(block)).toEqual({ event: 'message', data: 'hello' });
  });

  it('joins multiple data: lines with newlines', () => {
    const block = 'event: final\ndata: line one\ndata: line two';
    expect(parseSseEventBlock(block)).toEqual({ event: 'final', data: 'line one\nline two' });
  });

  it('ignores comment lines starting with a colon', () => {
    const block = ': this is a keep-alive comment\nevent: token\ndata: hi';
    expect(parseSseEventBlock(block)).toEqual({ event: 'token', data: 'hi' });
  });

  it('normalizes CRLF line endings', () => {
    const block = 'event: token\r\ndata: hi\r\n';
    expect(parseSseEventBlock(block)).toEqual({ event: 'token', data: 'hi' });
  });

  it('returns null when there are no data lines', () => {
    expect(parseSseEventBlock('event: token')).toBeNull();
    expect(parseSseEventBlock('')).toBeNull();
  });
});

describe('parseMaybeJson', () => {
  it('parses valid JSON', () => {
    expect(parseMaybeJson('{"text":"hi"}')).toEqual({ text: 'hi' });
  });

  it('returns the raw string when JSON parsing fails', () => {
    expect(parseMaybeJson('not json')).toBe('not json');
  });
});

import { describe, expect, it } from 'vitest';
import { parseStudentEmails } from './parseStudentEmails';

describe('parseStudentEmails', () => {
  it('accepts an email-only CSV or newline list and removes duplicates', () => {
    expect(parseStudentEmails('\uFEFFemail\r\n"Ada@example.test", grace@example.test\nADA@example.test,,')).toEqual({
      emails: ['ada@example.test', 'grace@example.test'], invalid: [],
    });
  });
  it('reports malformed entries instead of silently discarding columns', () => {
    expect(parseStudentEmails('name,email\nAda,ada@example.test')).toEqual({
      emails: ['ada@example.test'], invalid: ['name', 'email', 'Ada'],
    });
    expect(parseStudentEmails(' ,\n')).toEqual({ emails: [], invalid: [] });
  });
});

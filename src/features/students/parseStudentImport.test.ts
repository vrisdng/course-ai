import { describe, expect, it } from 'vitest';
import { parseStudentImport } from './parseStudentImport';

describe('parseStudentImport', () => {
  it('keeps email-only CSV, newline lists, an optional header and duplicate removal', () => {
    expect(parseStudentImport('\uFEFFemail\r\n"Ada@example.test", grace@example.test\nADA@example.test,,')).toEqual({
      students: [{ email: 'ada@example.test' }, { email: 'grace@example.test' }], invalid: [],
    });
    expect(parseStudentImport('email,ada@example.test,grace@example.test')).toEqual({
      students: [{ email: 'ada@example.test' }, { email: 'grace@example.test' }], invalid: [],
    });
    expect(parseStudentImport(' ,\n')).toEqual({ students: [], invalid: [] });
  });
  it('parses named CSV with a header, quoted commas, escaped quotes and Unicode', () => {
    expect(parseStudentImport('email,fullName\r\nADA@example.test,"  Lovelace, Ada  "\r\ngrace@example.test,"Grace ""Amazing"" Hopper"\nmai@example.test,Ngọc Mai')).toEqual({
      students: [{ email: 'ada@example.test', fullName: 'Lovelace, Ada' },
        { email: 'grace@example.test', fullName: 'Grace "Amazing" Hopper' }, { email: 'mai@example.test', fullName: 'Ngọc Mai' }], invalid: [],
    });
  });
  it('accepts named rows without a header and optional missing names', () => {
    expect(parseStudentImport('ada@example.test,Ada Lovelace\ngrace@example.test,\nmai@example.test')).toEqual({
      students: [{ email: 'ada@example.test', fullName: 'Ada Lovelace' }, { email: 'grace@example.test' }, { email: 'mai@example.test' }], invalid: [],
    });
  });
  it('blocks malformed email cells in a mixed list of named and email-only rows', () => {
    expect(parseStudentImport('ada@example.test,Ada\ninvalid-email,Grace\nmai@example.test')).toEqual({
      students: [{ email: 'ada@example.test', fullName: 'Ada' }, { email: 'mai@example.test' }], invalid: ['invalid-email', 'Grace'],
    });
  });
  it('preserves every email when bulk-email rows and named rows are mixed', () => {
    expect(parseStudentImport('ada@example.test,bob@example.test\ncharlie@example.test,Charlie')).toEqual({
      students: [{ email: 'ada@example.test' }, { email: 'bob@example.test' },
        { email: 'charlie@example.test', fullName: 'Charlie' }], invalid: [],
    });
  });
  it('keeps comma-separated email lists as individual students', () => {
    expect(parseStudentImport('ada@example.test,grace@example.test\nmai@example.test,lin@example.test').students).toEqual([
      { email: 'ada@example.test' }, { email: 'grace@example.test' }, { email: 'mai@example.test' }, { email: 'lin@example.test' },
    ]);
  });
  it('reports invalid email entries, overlong fields and extra named columns', () => {
    expect(parseStudentImport('name,email\nAda,ada@example.test')).toEqual({
      students: [{ email: 'ada@example.test' }], invalid: ['name', 'email', 'Ada'],
    });
    for (const text of ['email,fullName\ninvalid,Ada', 'email,fullName\nada@example.test,Ada,extra',
      `email,fullName\nada@example.test,${'A'.repeat(201)}`, `${'a'.repeat(250)}@x.test`]) {
      expect(parseStudentImport(text).invalid.length).toBeGreaterThan(0);
    }
  });
  it('blocks malformed CSV quotes instead of silently misreading a name', () => {
    for (const text of ['email,fullName\nada@example.test,"Ada', 'email,fullName\nada@example.test,"Ada"oops',
      'email,fullName\nada@example.test,Ad"a']) {
      expect(parseStudentImport(text).invalid.length).toBeGreaterThan(0);
    }
  });
  it('deduplicates case-insensitive emails, retains a supplied name and flags conflicting names', () => {
    expect(parseStudentImport('email,fullName\nada@example.test,\nADA@example.test,Ada\nada@example.test,Ada')).toEqual({
      students: [{ email: 'ada@example.test', fullName: 'Ada' }], invalid: [],
    });
    expect(parseStudentImport('email,fullName\nada@example.test,Ada\nada@example.test,Grace').invalid.length).toBeGreaterThan(0);
  });
});

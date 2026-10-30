import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStudentImport, INITIAL_STUDENT_PASSWORD, type StudentImportStore } from './studentImport';

const student = { userId: 'student-id', role: 'student' };
const store: StudentImportStore = {
  authenticate: vi.fn(), courseExists: vi.fn(), findProfile: vi.fn(),
  createStudent: vi.fn(), enroll: vi.fn(),
};
const request = (body: unknown, token = 'admin') => new Request('http://local/import', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const body = { courseId: '8ab379d4-ec0d-46a7-b13b-c7bcad969aa0', emails: ['ada@example.test'] };

describe('student import', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(store.authenticate).mockResolvedValue({ role: 'admin', mustChangePassword: false });
    vi.mocked(store.courseExists).mockResolvedValue(true);
    vi.mocked(store.findProfile).mockResolvedValue(null);
    vi.mocked(store.createStudent).mockResolvedValue(student.userId);
    vi.mocked(store.enroll).mockResolvedValue('enrolled');
  });
  it('requires an authenticated admin who has finished password setup', async () => {
    expect((await handleStudentImport(request(body, ''), store)).status).toBe(401);
    vi.mocked(store.authenticate).mockResolvedValue(null);
    expect((await handleStudentImport(request(body), store)).status).toBe(401);
    vi.mocked(store.authenticate).mockResolvedValue({ role: 'student', mustChangePassword: false });
    expect((await handleStudentImport(request(body), store)).status).toBe(403);
    vi.mocked(store.authenticate).mockResolvedValue({ role: 'admin', mustChangePassword: true });
    expect((await handleStudentImport(request(body), store)).status).toBe(403);
    expect(store.createStudent).not.toHaveBeenCalled();
  });
  it('rejects malformed or oversized batches and missing courses before creating accounts', async () => {
    for (const invalid of [null, {}, { ...body, emails: [4] }, { ...body, emails: ['invalid'] }, { ...body, emails: [{ email: 'ada@example.test', fullName: 'Ada' }] },
      { ...body, emails: Array.from({ length: 21 }, (_, n) => `s${n}@example.test`) }]) {
      expect((await handleStudentImport(request(invalid), store)).status).toBe(400);
    }
    vi.mocked(store.courseExists).mockResolvedValue(false);
    expect((await handleStudentImport(request(body), store)).status).toBe(404);
    expect(store.createStudent).not.toHaveBeenCalled();
  });
  it('creates accounts with a confirmed email, shared initial password and trusted setup flag', async () => {
    const response = await handleStudentImport(request({ ...body, emails: ['ADA@example.test', 'ada@example.test'] }), store);
    expect(response.status).toBe(200);
    expect(store.createStudent).toHaveBeenCalledExactlyOnceWith({
      email: 'ada@example.test', password: INITIAL_STUDENT_PASSWORD, email_confirm: true,
      app_metadata: { must_change_password: true },
    });
    expect(store.enroll).toHaveBeenCalledWith(student.userId, body.courseId);
    const result = await response.json();
    expect(result.results).toEqual([{ email: 'ada@example.test', status: 'created' }]);
    expect(JSON.stringify(result)).not.toContain(INITIAL_STUDENT_PASSWORD);
  });
  it('creates named students through signup metadata while still requiring password setup', async () => {
    const response = await handleStudentImport(request({ courseId: body.courseId, students: [
      { email: ' ADA@example.test ', fullName: '  Ngọc Mai  ' },
      { email: 'grace@example.test' },
    ] }), store);
    expect(response.status).toBe(200);
    expect(store.createStudent).toHaveBeenNthCalledWith(1, {
      email: 'ada@example.test', password: INITIAL_STUDENT_PASSWORD, email_confirm: true,
      app_metadata: { must_change_password: true }, user_metadata: { full_name: 'Ngọc Mai' },
    });
    expect(store.createStudent).toHaveBeenNthCalledWith(2, {
      email: 'grace@example.test', password: INITIAL_STUDENT_PASSWORD, email_confirm: true,
      app_metadata: { must_change_password: true },
    });
  });
  it('rejects invalid named batches and ambiguous request shapes before any writes', async () => {
    const named = { courseId: body.courseId, students: [{ email: 'ada@example.test', fullName: 'Ada' }] };
    for (const students of [null, [], [null], [4], ['ada@example.test'], [{}],
      [{ email: 4 }], [{ email: 'invalid', fullName: 'Ada' }], [{ email: 'a'.repeat(250) + '@x.test' }],
      [{ email: 'ada@example.test', fullName: 4 }], [{ email: 'ada@example.test', fullName: null }],
      [{ email: 'ada@example.test', fullName: '  ' }], [{ email: 'ada@example.test', fullName: 'A'.repeat(201) }],
      Array.from({ length: 21 }, (_, n) => ({ email: `s${n}@example.test`, fullName: 'Student' }))]) {
      expect((await handleStudentImport(request({ ...named, students }), store)).status).toBe(400);
    }
    expect((await handleStudentImport(request({ ...named, emails: body.emails }), store)).status).toBe(400);
    expect((await handleStudentImport(request({ ...named, emails: null }), store)).status).toBe(400);
    expect(store.courseExists).not.toHaveBeenCalled();
    expect(store.createStudent).not.toHaveBeenCalled();
    expect(store.enroll).not.toHaveBeenCalled();
  });
  it('deduplicates named entries and refuses conflicting names before writes', async () => {
    const students = [{ email: 'ada@example.test' }, { email: 'ADA@example.test', fullName: ' Ada ' },
      { email: 'ada@example.test', fullName: 'Ada' }];
    const response = await handleStudentImport(request({ courseId: body.courseId, students }), store);
    expect(response.status).toBe(200);
    expect(store.createStudent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user_metadata: { full_name: 'Ada' } }));
    vi.clearAllMocks();
    const conflict = await handleStudentImport(request({ courseId: body.courseId, students: [
      ...students, { email: 'ada@example.test', fullName: 'Grace' },
    ] }), store);
    expect(conflict.status).toBe(400);
    expect(store.createStudent).not.toHaveBeenCalled();
  });
  it('does not change existing accounts when a name is supplied, including concurrent imports', async () => {
    vi.mocked(store.findProfile).mockResolvedValueOnce(student).mockResolvedValueOnce({ ...student, role: 'admin' });
    const response = await handleStudentImport(request({ courseId: body.courseId, students: [
      { email: 'ada@example.test', fullName: 'Replacement name' }, { email: 'admin@example.test', fullName: 'Admin name' },
    ] }), store);
    expect((await response.json()).results.map((r: { status: string }) => r.status)).toEqual(['enrolled', 'skipped_non_student']);
    expect(store.createStudent).not.toHaveBeenCalled();
    expect(store.enroll).toHaveBeenCalledExactlyOnceWith(student.userId, body.courseId);
    vi.mocked(store.findProfile).mockResolvedValueOnce(null).mockResolvedValueOnce(student);
    vi.mocked(store.createStudent).mockRejectedValueOnce(new Error('duplicate'));
    const concurrent = await handleStudentImport(request({ courseId: body.courseId, students: [
      { email: 'ada@example.test', fullName: 'Replacement name' },
    ] }), store);
    expect((await concurrent.json()).results[0].status).toBe('enrolled');
  });
  it('preserves existing student credentials and skips non-student accounts', async () => {
    vi.mocked(store.findProfile).mockResolvedValueOnce(student).mockResolvedValueOnce({ ...student, role: 'admin' });
    const response = await handleStudentImport(request({ ...body, emails: ['ada@example.test', 'admin@example.test'] }), store);
    expect((await response.json()).results.map((r: { status: string }) => r.status)).toEqual(['enrolled', 'skipped_non_student']);
    expect(store.createStudent).not.toHaveBeenCalled();
    expect(store.enroll).toHaveBeenCalledTimes(1);
  });
  it('keeps partial success and safely retries accounts already created', async () => {
    vi.mocked(store.enroll).mockRejectedValueOnce(new Error('database unavailable'));
    const failed = await handleStudentImport(request(body), store);
    expect((await failed.json()).results[0]).toMatchObject({ status: 'failed', accountCreated: true });
    vi.mocked(store.findProfile).mockResolvedValue(student);
    vi.mocked(store.enroll).mockResolvedValue('already_enrolled');
    const retried = await handleStudentImport(request(body), store);
    expect((await retried.json()).results[0].status).toBe('already_enrolled');
    expect(store.createStudent).toHaveBeenCalledTimes(1);
  });
  it('recovers from concurrent account creation without resetting a password', async () => {
    vi.mocked(store.createStudent).mockRejectedValue(new Error('duplicate'));
    vi.mocked(store.findProfile).mockResolvedValueOnce(null).mockResolvedValueOnce(student);
    const response = await handleStudentImport(request(body), store);
    expect((await response.json()).results[0].status).toBe('enrolled');
  });
  it('reuses one account across courses without resetting its password', async () => {
    const secondCourseId = '8ab379d4-ec0d-46a7-b13b-c7bcad969aa1';
    vi.mocked(store.findProfile).mockResolvedValueOnce(null).mockResolvedValue(student);
    const first = await handleStudentImport(request(body), store);
    const second = await handleStudentImport(request({ ...body, courseId: secondCourseId }), store);
    expect((await first.json()).results[0].status).toBe('created');
    expect((await second.json()).results[0].status).toBe('enrolled');
    expect(store.createStudent).toHaveBeenCalledTimes(1);
    expect(store.enroll).toHaveBeenNthCalledWith(1, student.userId, body.courseId);
    expect(store.enroll).toHaveBeenNthCalledWith(2, student.userId, secondCourseId);
  });
  it('does not create or enroll an account if the trusted lookup fails', async () => {
    vi.mocked(store.findProfile).mockRejectedValue(new Error('Lookup unavailable'));
    const response = await handleStudentImport(request(body), store);
    expect((await response.json()).results[0].status).toBe('failed');
    expect(store.createStudent).not.toHaveBeenCalled();
    expect(store.enroll).not.toHaveBeenCalled();
  });
});

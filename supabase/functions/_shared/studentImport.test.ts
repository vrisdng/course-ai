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
    for (const invalid of [null, {}, { ...body, emails: [4] }, { ...body, emails: ['invalid'] },
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
});

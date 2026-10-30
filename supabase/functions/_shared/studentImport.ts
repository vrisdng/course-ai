import { corsHeaders } from './cors.ts';
import { normalizeEmail } from './email.ts';

export const INITIAL_STUDENT_PASSWORD = 'iLoveStudying8!';
export const STUDENT_IMPORT_BATCH_SIZE = 20;

interface StudentProfile { userId: string; role: string }
interface NewStudent {
  email: string; password: string; email_confirm: true;
  app_metadata: { must_change_password: true };
  user_metadata?: { full_name: string };
}
export interface StudentImportStore {
  authenticate(token: string): Promise<{ role: string; mustChangePassword: boolean } | null>;
  courseExists(id: string): Promise<boolean>;
  findProfile(email: string): Promise<StudentProfile | null>;
  createStudent(student: NewStudent): Promise<string>;
  enroll(userId: string, courseId: string): Promise<'enrolled' | 'already_enrolled'>;
}
interface ImportStudent { email: string; fullName?: string }
interface ImportRequest { courseId: string; emails?: string[]; students?: ImportStudent[] }
interface ImportResult {
  email: string;
  status: 'created' | 'enrolled' | 'already_enrolled' | 'skipped_non_student' | 'failed';
  accountCreated?: boolean;
  error?: string;
}
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function isImportStudent(value: unknown): value is ImportStudent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const student = value as Record<string, unknown>;
  return typeof student.email === 'string' && student.email.length <= 254 &&
    /^[^\s@",]+@[^\s@",]+\.[^\s@",]+$/.test(student.email.trim()) &&
    (student.fullName === undefined || (typeof student.fullName === 'string' &&
      student.fullName.trim().length > 0 && student.fullName.trim().length <= 200));
}

export async function handleStudentImport(req: Request, store: StudentImportStore): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ') || !authorization.slice(7).trim()) return json({ error: 'Unauthorized' }, 401);
    const actor = await store.authenticate(authorization.slice(7));
    if (!actor) return json({ error: 'Unauthorized' }, 401);
    if (actor.role !== 'admin' || actor.mustChangePassword) return json({ error: 'Admin access required' }, 403);
    let body: ImportRequest;
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.courseId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(body.courseId) ||
      ('emails' in body) === ('students' in body)) {
      return json({ error: 'Provide a course ID and either emails or students, not both' }, 400);
    }
    const entries = 'students' in body ? body.students :
      Array.isArray(body.emails) && body.emails.length <= STUDENT_IMPORT_BATCH_SIZE ? body.emails.map((email) => ({ email })) : null;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > STUDENT_IMPORT_BATCH_SIZE ||
      !entries.every(isImportStudent)) {
      return json({ error: `Provide 1–${STUDENT_IMPORT_BATCH_SIZE} valid students; optional fullName must contain 1–200 characters` }, 400);
    }
    const students = new Map<string, ImportStudent>();
    for (const entry of entries) {
      const email = normalizeEmail(entry.email);
      const fullName = entry.fullName?.trim();
      const previous = students.get(email);
      if (previous?.fullName && fullName && previous.fullName !== fullName) {
        return json({ error: 'Conflicting names for the same email address' }, 400);
      }
      const name = fullName || previous?.fullName;
      students.set(email, { email, ...(name ? { fullName: name } : {}) });
    }
    if (!await store.courseExists(body.courseId)) return json({ error: 'Course not found' }, 404);
    const results: ImportResult[] = [];
    for (const { email, fullName } of students.values()) {
      let accountCreated = false;
      try {
        let profile = await store.findProfile(email);
        if (!profile) {
          try {
            const userId = await store.createStudent({ email, password: INITIAL_STUDENT_PASSWORD, email_confirm: true,
              app_metadata: { must_change_password: true }, ...(fullName ? { user_metadata: { full_name: fullName } } : {}) });
            accountCreated = true;
            profile = { userId, role: 'student' };
          } catch {
            // A concurrent import may have created the account between lookup and insert.
            profile = await store.findProfile(email);
            if (!profile) throw new Error('Account creation failed. Check whether the email already has an Auth account without a student profile.');
          }
        }
        if (profile.role !== 'student') {
          results.push({ email, status: 'skipped_non_student' }); continue;
        }
        const enrollment = await store.enroll(profile.userId, body.courseId);
        results.push({ email, status: accountCreated ? 'created' : enrollment });
      } catch {
        results.push({ email, status: 'failed', accountCreated,
          error: accountCreated ? 'Account created, but enrollment failed. Retry to finish enrollment.' : 'Import failed. Retry or check the existing account.' });
      }
    }
    return json({ results });
  } catch {
    return json({ error: 'Import service unavailable. Completed entries can be safely retried.' }, 503);
  }
}

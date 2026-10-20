import { corsHeaders } from './cors.ts';
import { normalizeEmail } from './email.ts';

export const INITIAL_STUDENT_PASSWORD = 'iLoveStudying8!';
export const STUDENT_IMPORT_BATCH_SIZE = 20;

interface StudentProfile { userId: string; role: string }
interface NewStudent {
  email: string; password: string; email_confirm: true;
  app_metadata: { must_change_password: true };
}
export interface StudentImportStore {
  authenticate(token: string): Promise<{ role: string; mustChangePassword: boolean } | null>;
  courseExists(id: string): Promise<boolean>;
  findProfile(email: string): Promise<StudentProfile | null>;
  createStudent(student: NewStudent): Promise<string>;
  enroll(userId: string, courseId: string): Promise<'enrolled' | 'already_enrolled'>;
}
interface ImportRequest { courseId: string; emails: string[] }
interface ImportResult {
  email: string;
  status: 'created' | 'enrolled' | 'already_enrolled' | 'skipped_non_student' | 'failed';
  accountCreated?: boolean;
  error?: string;
}
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

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
    if (!body || typeof body.courseId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(body.courseId) ||
      !Array.isArray(body.emails) || body.emails.length === 0 || body.emails.length > STUDENT_IMPORT_BATCH_SIZE ||
      body.emails.some((email) => typeof email !== 'string' || email.length > 254 || !/^[^\s@",]+@[^\s@",]+\.[^\s@",]+$/.test(email.trim()))) {
      return json({ error: `Provide a course ID and 1–${STUDENT_IMPORT_BATCH_SIZE} valid email addresses` }, 400);
    }
    if (!await store.courseExists(body.courseId)) return json({ error: 'Course not found' }, 404);
    const results: ImportResult[] = [];
    for (const email of new Set(body.emails.map(normalizeEmail))) {
      let accountCreated = false;
      try {
        let profile = await store.findProfile(email);
        if (!profile) {
          try {
            const userId = await store.createStudent({ email, password: INITIAL_STUDENT_PASSWORD, email_confirm: true,
              app_metadata: { must_change_password: true } });
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

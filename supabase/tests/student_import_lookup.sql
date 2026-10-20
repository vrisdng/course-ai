-- Run against an isolated database after the student-import lookup migration.
BEGIN;
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'import-owner@example.test', '{}', '{}'),
  ('c0000000-0000-4000-8000-000000000002', 'import-other@example.test', '{}', '{}');

SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE public.profiles SET email = 'import-owner@example.test' WHERE user_id = auth.uid();
RESET ROLE;
UPDATE public.profiles SET email = 'outdated-profile@example.test'
WHERE user_id = 'c0000000-0000-4000-8000-000000000001';

DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.find_student_import_profile(text)', 'EXECUTE'), 'Anonymous callers must not look up Auth accounts';
  ASSERT NOT has_function_privilege('authenticated', 'public.find_student_import_profile(text)', 'EXECUTE'), 'Students must not look up Auth accounts';
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  ASSERT (SELECT user_id = 'c0000000-0000-4000-8000-000000000001'::uuid AND role = 'student'
    FROM public.find_student_import_profile(' IMPORT-OWNER@example.test ')), 'Resolve the Auth owner despite edited or stale profile emails';
  ASSERT (SELECT user_id = 'c0000000-0000-4000-8000-000000000002'::uuid
    FROM public.find_student_import_profile('import-other@example.test')), 'Resolve the same account under its real Auth email';
  ASSERT NOT EXISTS (SELECT 1 FROM public.find_student_import_profile('outdated-profile@example.test')), 'A profile email alone must not identify an Auth account';
END $$;
RESET ROLE;

UPDATE public.profiles SET email = 'not-yet-registered@example.test'
WHERE user_id = 'c0000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.find_student_import_profile('not-yet-registered@example.test')), 'A forged profile must not claim a new student email';
END $$;
RESET ROLE;
ROLLBACK;

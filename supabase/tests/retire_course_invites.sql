-- Run only in an isolated database with all migrations before retirement applied.
BEGIN;

-- Keep real course enrollment rows across retirement, including the academic code.
INSERT INTO auth.users (id, email)
VALUES ('10400000-0000-0000-0000-000000000001', 'retirement-test@example.invalid');
INSERT INTO public.courses (id, name, code)
VALUES ('10400000-0000-0000-0000-000000000002', 'Retirement regression', 'KEEP104');
INSERT INTO public.enrollments (user_id, course_id)
VALUES ('10400000-0000-0000-0000-000000000001', '10400000-0000-0000-0000-000000000002');
INSERT INTO public.course_invites (course_id, invite_code, is_course_code)
VALUES ('10400000-0000-0000-0000-000000000002', 'RETIRED104', true);

\ir ../migrations/20261028100000_retire_course_invites.sql
-- Re-running retirement must also be safe.
\ir ../migrations/20261028100000_retire_course_invites.sql

DO $$
BEGIN
  ASSERT to_regclass('public.course_invites') IS NULL, 'Invite table still exists';
  ASSERT EXISTS (SELECT 1 FROM public.courses WHERE code = 'KEEP104'), 'Academic course code was lost';
  ASSERT EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE user_id = '10400000-0000-0000-0000-000000000001'
      AND course_id = '10400000-0000-0000-0000-000000000002'
  ), 'Existing enrollment was lost';
  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'courses' AND policyname = 'Password setup required'
  ), 'Password setup policy on retained tables was lost';
  ASSERT to_regprocedure('public.require_password_setup()') IS NOT NULL, 'Password setup guard was lost';
END;
$$;

ROLLBACK;

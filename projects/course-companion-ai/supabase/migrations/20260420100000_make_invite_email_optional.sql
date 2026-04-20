ALTER TABLE public.course_invites
  DROP CONSTRAINT IF EXISTS course_invites_email_check,
  ALTER COLUMN invited_email DROP NOT NULL;

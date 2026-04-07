-- Allow course-level codes (no specific email target)
ALTER TABLE public.course_invites
  ALTER COLUMN invited_email DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS course_invites_email_check,
  ADD COLUMN IF NOT EXISTS is_course_code BOOLEAN NOT NULL DEFAULT FALSE;

-- Add constraint that allows NULL or valid email
ALTER TABLE public.course_invites
  ADD CONSTRAINT course_invites_email_check
  CHECK (invited_email IS NULL OR position('@' in invited_email) > 1);

-- Invite codes for enrolling specific email addresses into a course.
CREATE TABLE IF NOT EXISTS public.course_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  redeemed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  CONSTRAINT course_invites_email_check CHECK (position('@' in invited_email) > 1)
);

CREATE INDEX IF NOT EXISTS idx_course_invites_course ON public.course_invites(course_id);
CREATE INDEX IF NOT EXISTS idx_course_invites_email ON public.course_invites(invited_email);
CREATE INDEX IF NOT EXISTS idx_course_invites_code ON public.course_invites(invite_code);

ALTER TABLE public.course_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view course invites" ON public.course_invites;
CREATE POLICY "Staff can view course invites"
ON public.course_invites FOR SELECT
TO authenticated
USING (public.is_course_lecturer(auth.uid(), course_id));

DROP POLICY IF EXISTS "Staff can create course invites" ON public.course_invites;
CREATE POLICY "Staff can create course invites"
ON public.course_invites FOR INSERT
TO authenticated
WITH CHECK (public.is_course_lecturer(auth.uid(), course_id));

DROP POLICY IF EXISTS "Staff can update course invites" ON public.course_invites;
CREATE POLICY "Staff can update course invites"
ON public.course_invites FOR UPDATE
TO authenticated
USING (public.is_course_lecturer(auth.uid(), course_id));

DROP POLICY IF EXISTS "Staff can delete course invites" ON public.course_invites;
CREATE POLICY "Staff can delete course invites"
ON public.course_invites FOR DELETE
TO authenticated
USING (public.is_course_lecturer(auth.uid(), course_id));

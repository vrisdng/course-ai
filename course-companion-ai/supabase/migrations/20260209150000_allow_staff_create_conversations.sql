-- Align conversation creation policy with chat access checks.
-- Students can create conversations for enrolled courses.
-- Staff/admin can create conversations for courses they manage.
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;

CREATE POLICY "Users can create conversations"
ON public.conversations FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    public.is_enrolled(auth.uid(), course_id)
    OR public.is_course_lecturer(auth.uid(), course_id)
  )
);

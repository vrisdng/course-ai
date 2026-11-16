-- Per-student question counts for a course's Students page.
--
-- Lecturers see how many questions each student asked and when they last
-- asked, but never what they asked: this function returns counts and a
-- timestamp only, no question text.
--
-- A question counts when its turn completed (outcome = 'success' and
-- error_code IS NULL), the same rule as the other analytics RPCs. Questions
-- from chats the student later deleted still count: query_events keeps them
-- (user_message_id is set to NULL on delete).

CREATE OR REPLACE FUNCTION public.get_course_student_question_counts(
  in_course_id uuid
)
RETURNS TABLE (
  user_id uuid,
  question_count bigint,
  last_question_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    qe.user_id,
    COUNT(*)::bigint,
    max(qe.created_at)
  FROM public.query_events qe
  WHERE qe.course_id = in_course_id
    AND qe.user_id IS NOT NULL
    AND qe.outcome = 'success'
    AND qe.error_code IS NULL
  GROUP BY qe.user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_student_question_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_student_question_counts(uuid) TO authenticated;

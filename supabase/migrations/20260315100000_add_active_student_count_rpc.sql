-- Adds a helper RPC to count distinct active students in a course
-- (students who have at least one query_event in the given time window).

CREATE OR REPLACE FUNCTION public.get_course_active_student_count(
  in_course_id UUID,
  in_start_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result BIGINT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(DISTINCT user_id) INTO result
  FROM public.query_events
  WHERE course_id = in_course_id
    AND (in_start_at IS NULL OR created_at >= in_start_at);

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_active_student_count(UUID, TIMESTAMPTZ) TO authenticated;

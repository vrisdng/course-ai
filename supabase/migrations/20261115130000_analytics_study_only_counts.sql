-- Make the Files counts and the page summary follow the "Hide greetings and
-- logistics" toggle, so they match the question list they open.
--
--   * get_course_cited_files and get_course_question_overview take
--     in_study_only, with the same rule as get_course_questions and
--     get_course_question_buckets: drop questions labelled as not study
--     questions (is_study_question IS FALSE); unlabelled ones stay.
--   * get_course_question_overview adds materials_judged_count, the questions
--     whose answered_from_materials label is set, so "% answered from
--     materials" no longer counts questions the model gave no answer for.
--     non_study_count still counts the whole window, so the page can say how
--     many were hidden.

-- ── Cited files ──────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_course_cited_files(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.get_course_cited_files(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_study_only boolean DEFAULT false
)
RETURNS TABLE (
  file_name text,
  file_type text,
  material_ids uuid[],
  question_count bigint,
  student_count bigint
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
    m.file_name,
    min(m.file_type::text),
    array_agg(DISTINCT m.id),
    COUNT(DISTINCT q.id)::bigint,
    COUNT(DISTINCT q.user_id)::bigint
  FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at) q
  JOIN public.citations c ON c.message_id = q.assistant_message_id
  JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
  WHERE NOT COALESCE(in_study_only, false) OR q.is_study_question IS NOT FALSE
  GROUP BY m.file_name
  ORDER BY 4 DESC, 1 ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_cited_files(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_cited_files(uuid, timestamptz, timestamptz, boolean) TO authenticated;

-- ── Overview ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_course_question_overview(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.get_course_question_overview(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_study_only boolean DEFAULT false
)
RETURNS TABLE (
  question_count bigint,
  student_count bigint,
  labeled_count bigint,
  answered_from_materials_count bigint,
  -- Questions with an answered_from_materials label (the % denominator).
  materials_judged_count bigint,
  needs_attention_count bigint,
  -- Questions labelled as not study questions, across the whole window.
  non_study_count bigint,
  cited_question_count bigint,
  document_question_count bigint,
  video_question_count bigint
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
  WITH all_q AS (
    SELECT * FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at)
  ),
  q AS (
    SELECT * FROM all_q
    WHERE NOT COALESCE(in_study_only, false) OR all_q.is_study_question IS NOT FALSE
  ),
  kinds AS (
    SELECT
      q.id,
      bool_or(m.file_type <> 'video') AS cites_document,
      bool_or(m.file_type = 'video') AS cites_video
    FROM q
    JOIN public.citations c ON c.message_id = q.assistant_message_id
    JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
    GROUP BY q.id
  )
  SELECT
    (SELECT COUNT(*) FROM q)::bigint,
    (SELECT COUNT(DISTINCT q.user_id) FROM q)::bigint,
    (SELECT COUNT(*) FILTER (WHERE q.is_labeled) FROM q)::bigint,
    (SELECT COUNT(*) FILTER (WHERE q.answered_from_materials) FROM q)::bigint,
    (SELECT COUNT(*) FILTER (WHERE q.answered_from_materials IS NOT NULL) FROM q)::bigint,
    (SELECT COUNT(*) FILTER (WHERE q.needs_attention) FROM q)::bigint,
    (SELECT COUNT(*) FILTER (WHERE all_q.is_study_question IS FALSE) FROM all_q)::bigint,
    (SELECT COUNT(*) FROM kinds)::bigint,
    (SELECT COUNT(*) FILTER (WHERE kinds.cites_document) FROM kinds)::bigint,
    (SELECT COUNT(*) FILTER (WHERE kinds.cites_video) FROM kinds)::bigint;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_question_overview(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_question_overview(uuid, timestamptz, timestamptz, boolean) TO authenticated;

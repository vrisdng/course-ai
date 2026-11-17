-- Question detail for the analytics page, and two changes to
-- get_course_questions:
--   * in_material_ids (an array) replaces in_material_id, so a file that was
--     uploaded more than once can be filtered as one file;
--   * in_study_only hides questions labelled as not study questions
--     (greetings, logistics).
-- Sources are now merged by file name, so page 2 of two copies of the same
-- file shows once. Adds get_course_cited_files, the cited files of a course
-- with copies merged, and get_course_question_detail. The overview gains
-- non_study_count, and get_course_question_buckets gains in_study_only, so
-- counts can match the list with in_study_only.

DROP FUNCTION IF EXISTS public.get_course_questions(
  uuid, timestamptz, timestamptz, text, jsonb, jsonb, uuid, text, text, boolean, integer, integer);

-- The distinct sources an answer cited, merging copies of a file by name.
-- Internal: called from the SECURITY DEFINER functions below.
CREATE OR REPLACE FUNCTION public.analytics_answer_sources(
  in_course_id uuid,
  in_message_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'material_id', s.material_id,
    'file_name', s.file_name,
    'file_type', s.file_type,
    'page_number', s.page_number,
    'start_ms', s.start_ms,
    'end_ms', s.end_ms
  ) ORDER BY s.file_name, s.page_number NULLS LAST, s.start_ms NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      (array_agg(c.material_id ORDER BY m.created_at DESC))[1] AS material_id,
      m.file_name,
      min(m.file_type::text) AS file_type,
      c.page_number,
      c.start_ms,
      c.end_ms
    FROM public.citations c
    JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
    WHERE c.message_id = in_message_id
    GROUP BY m.file_name, c.page_number, c.start_ms, c.end_ms
  ) s;
$$;

REVOKE EXECUTE ON FUNCTION public.analytics_answer_sources(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Question list ────────────────────────────────────────────────────────

-- As in migration 20261025090000, with in_material_ids and in_study_only.
CREATE OR REPLACE FUNCTION public.get_course_questions(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_topic_text text DEFAULT NULL,
  in_topic_places jsonb DEFAULT NULL,
  in_places jsonb DEFAULT NULL,
  in_material_ids uuid[] DEFAULT NULL,
  in_source_kind text DEFAULT NULL,
  in_category text DEFAULT NULL,
  in_needs_attention boolean DEFAULT false,
  in_study_only boolean DEFAULT false,
  in_limit integer DEFAULT 25,
  in_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_limit integer := LEAST(100, GREATEST(1, COALESCE(in_limit, 25)));
  row_offset integer := GREATEST(0, COALESCE(in_offset, 0));
  topic_text text := NULLIF(btrim(COALESCE(in_topic_text, '')), '');
  topic_like text;
  topic_query tsquery;
  has_topic boolean;
  result jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF in_source_kind IS NOT NULL AND in_source_kind NOT IN ('document', 'video') THEN
    RAISE EXCEPTION 'in_source_kind must be document or video' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(topic_text) > 200 THEN
    RAISE EXCEPTION 'The topic is too long' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (in_topic_places IS NOT NULL AND jsonb_typeof(in_topic_places) <> 'array')
    OR (in_places IS NOT NULL AND jsonb_typeof(in_places) <> 'array') THEN
    RAISE EXCEPTION 'Places must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(COALESCE(in_topic_places, '[]'::jsonb)) > 200
    OR jsonb_array_length(COALESCE(in_places, '[]'::jsonb)) > 200 THEN
    RAISE EXCEPTION 'At most 200 places can be matched at once' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  has_topic := topic_text IS NOT NULL OR in_topic_places IS NOT NULL;
  IF topic_text IS NOT NULL THEN
    topic_query := phraseto_tsquery('english', topic_text);
    topic_like := '%' || replace(replace(replace(lower(topic_text), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH cites AS (
    SELECT c.message_id, c.material_id, c.page_number, c.start_ms, c.end_ms, m.file_type::text AS file_type
    FROM public.citations c
    JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
  ),
  filtered AS (
    SELECT q.*
    FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at) q
    WHERE (in_category IS NULL OR q.category = in_category)
      AND (NOT COALESCE(in_needs_attention, false) OR q.needs_attention)
      AND (NOT COALESCE(in_study_only, false) OR q.is_study_question IS NOT FALSE)
      AND (in_material_ids IS NULL OR EXISTS (
        SELECT 1 FROM cites c WHERE c.message_id = q.assistant_message_id AND c.material_id = ANY (in_material_ids)))
      AND (in_source_kind IS NULL OR EXISTS (
        SELECT 1 FROM cites c WHERE c.message_id = q.assistant_message_id
          AND (c.file_type = 'video') = (in_source_kind = 'video')))
      AND (in_places IS NULL OR EXISTS (
        SELECT 1 FROM cites c WHERE c.message_id = q.assistant_message_id
          AND public.analytics_citation_at_places(c.material_id, c.page_number, c.start_ms, c.end_ms, in_places)))
      AND (NOT has_topic
        OR (topic_text IS NOT NULL AND (
          (numnode(topic_query) > 0 AND to_tsvector('english', q.query_text) @@ topic_query)
          OR lower(q.query_text) LIKE topic_like))
        OR (in_topic_places IS NOT NULL AND EXISTS (
          SELECT 1 FROM cites c WHERE c.message_id = q.assistant_message_id
            AND public.analytics_citation_at_places(c.material_id, c.page_number, c.start_ms, c.end_ms, in_topic_places))))
  ),
  page AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id LIMIT row_limit OFFSET row_offset
  )
  SELECT jsonb_build_object(
    'total_count', (SELECT COUNT(*) FROM filtered),
    'student_count', (SELECT COUNT(DISTINCT user_id) FROM filtered),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'query_text', p.query_text,
        'created_at', p.created_at,
        'category', p.category,
        'is_study_question', p.is_study_question,
        'answered_from_materials', p.answered_from_materials,
        'needs_attention', p.needs_attention,
        'sources', public.analytics_answer_sources(in_course_id, p.assistant_message_id)
      ) ORDER BY p.created_at DESC, p.id)
      FROM page p
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- ── One question ─────────────────────────────────────────────────────────

-- The question, the answer it got, what the answer cited, and other counted
-- questions in the window whose answers cited the same pages or video
-- moments (copies of a file count as the same file). NULL when the question
-- isn't a counted question of this course in the window.
CREATE OR REPLACE FUNCTION public.get_course_question_detail(
  in_course_id uuid,
  in_question_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_related_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  related_limit integer := LEAST(50, GREATEST(0, COALESCE(in_related_limit, 10)));
  question record;
  result jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO question
  FROM public.analytics_counted_questions(in_course_id, NULL, NULL) q
  WHERE q.id = in_question_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH cites AS (
    SELECT c.message_id, m.file_name, c.page_number, c.start_ms, COALESCE(c.end_ms, c.start_ms) AS end_ms
    FROM public.citations c
    JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
  ),
  own AS (
    SELECT * FROM cites WHERE cites.message_id = question.assistant_message_id
  ),
  related AS (
    SELECT q.id, q.query_text, q.created_at, q.needs_attention
    FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at) q
    WHERE q.id <> question.id
      AND EXISTS (
        SELECT 1 FROM cites c JOIN own o ON o.file_name = c.file_name
        WHERE c.message_id = q.assistant_message_id
          AND (
            (o.start_ms IS NULL AND c.start_ms IS NULL AND o.page_number IS NOT DISTINCT FROM c.page_number)
            OR (o.start_ms IS NOT NULL AND c.start_ms IS NOT NULL AND c.start_ms <= o.end_ms AND c.end_ms >= o.start_ms)
          )
      )
  )
  SELECT jsonb_build_object(
    'id', question.id,
    'query_text', question.query_text,
    'created_at', question.created_at,
    'category', question.category,
    'is_study_question', question.is_study_question,
    'answered_from_materials', question.answered_from_materials,
    'needs_attention', question.needs_attention,
    'answer_text', (SELECT msg.content FROM public.messages msg WHERE msg.id = question.assistant_message_id),
    'sources', public.analytics_answer_sources(in_course_id, question.assistant_message_id),
    'related_count', (SELECT COUNT(*) FROM related),
    'related', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'query_text', r.query_text, 'created_at', r.created_at, 'needs_attention', r.needs_attention
      ) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM related ORDER BY created_at DESC LIMIT related_limit) r
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- ── Overview ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_course_question_overview(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.get_course_question_overview(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  question_count bigint,
  student_count bigint,
  labeled_count bigint,
  answered_from_materials_count bigint,
  needs_attention_count bigint,
  -- Questions labelled as not study questions (greetings, logistics).
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
  WITH q AS (
    SELECT * FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at)
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
    (SELECT COUNT(*) FILTER (WHERE q.needs_attention) FROM q)::bigint,
    (SELECT COUNT(*) FILTER (WHERE q.is_study_question IS FALSE) FROM q)::bigint,
    (SELECT COUNT(*) FROM kinds)::bigint,
    (SELECT COUNT(*) FILTER (WHERE kinds.cites_document) FROM kinds)::bigint,
    (SELECT COUNT(*) FILTER (WHERE kinds.cites_video) FROM kinds)::bigint;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_question_overview(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_question_overview(uuid, timestamptz, timestamptz) TO authenticated;

-- ── Question buckets ─────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_course_question_buckets(uuid, timestamptz, timestamptz);

-- As in migration 20261024120000, with in_study_only.
CREATE FUNCTION public.get_course_question_buckets(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_study_only boolean DEFAULT false
)
RETURNS TABLE (
  category text,
  question_count bigint,
  labeled_count bigint,
  study_question_count bigint,
  answered_from_materials_count bigint
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
    q.category,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE q.is_labeled)::bigint,
    COUNT(*) FILTER (WHERE q.is_study_question)::bigint,
    COUNT(*) FILTER (WHERE q.answered_from_materials)::bigint
  FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at) q
  WHERE NOT COALESCE(in_study_only, false) OR q.is_study_question IS NOT FALSE
  GROUP BY 1
  ORDER BY 2 DESC, 1 ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_question_buckets(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_question_buckets(uuid, timestamptz, timestamptz, boolean) TO authenticated;

-- ── Cited files ──────────────────────────────────────────────────────────

-- Files that answers cited, with copies of a file (same name) merged:
-- question_count counts each question once across copies.
CREATE OR REPLACE FUNCTION public.get_course_cited_files(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL
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
  GROUP BY m.file_name
  ORDER BY 4 DESC, 1 ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_cited_files(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_cited_files(uuid, timestamptz, timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_course_questions(uuid, timestamptz, timestamptz, text, jsonb, jsonb, uuid[], text, text, boolean, boolean, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_course_question_detail(uuid, uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_questions(uuid, timestamptz, timestamptz, text, jsonb, jsonb, uuid[], text, text, boolean, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_question_detail(uuid, uuid, timestamptz, timestamptz, integer) TO authenticated;

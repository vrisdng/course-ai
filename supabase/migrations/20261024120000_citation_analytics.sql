-- Citation-based course analytics.
--
-- Instead of topics, analytics asks "which materials, pages and video
-- moments did answers cite?" Citations snapshot material_id, page_number and
-- start_ms/end_ms (migration 20261009180000), so counts survive a material
-- being re-processed, which recreates its chunks and nulls citations.chunk_id.
-- Every function here therefore joins citations by material_id, never by
-- chunk_id.
--
-- A question counts when its turn completed: outcome = 'success' and
-- error_code IS NULL, as in the other analytics RPCs. Questions are linked to
-- their answers by query_events.assistant_message_id = citations.message_id.
--
-- Also adds per-question labels from OpenAI's Decisions API (written by the
-- course-analytics edge function). query_category keeps the rule-based label
-- as the fallback for questions not labelled yet.

ALTER TABLE public.query_events
  ADD COLUMN IF NOT EXISTS ai_category text,
  ADD COLUMN IF NOT EXISTS ai_category_confidence real
    CHECK (ai_category_confidence IS NULL OR ai_category_confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS ai_is_study_question boolean,
  ADD COLUMN IF NOT EXISTS ai_answered_from_materials boolean,
  -- Set once a labelling attempt finished, even if the model refused a
  -- question (that label stays NULL), so a question is never re-sent.
  ADD COLUMN IF NOT EXISTS ai_labeled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_label_model text;

CREATE INDEX IF NOT EXISTS idx_query_events_unlabeled
  ON public.query_events (course_id, created_at)
  WHERE ai_labeled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_query_events_assistant_message
  ON public.query_events (assistant_message_id);

CREATE INDEX IF NOT EXISTS idx_citations_message
  ON public.citations (message_id);

-- ── Cited materials ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_course_cited_materials(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  material_id uuid,
  file_name text,
  file_type text,
  question_count bigint,
  student_count bigint,
  citation_count bigint,
  last_cited_at timestamptz
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
    m.id,
    m.file_name,
    m.file_type::text,
    COUNT(DISTINCT qe.id)::bigint,
    COUNT(DISTINCT qe.user_id)::bigint,
    COUNT(c.id)::bigint,
    MAX(qe.created_at)
  FROM public.query_events qe
  JOIN public.citations c ON c.message_id = qe.assistant_message_id
  JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
  WHERE qe.course_id = in_course_id
    AND qe.outcome = 'success' AND qe.error_code IS NULL
    AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
    AND (in_end_at IS NULL OR qe.created_at <= in_end_at)
  GROUP BY m.id, m.file_name, m.file_type
  ORDER BY 4 DESC, 6 DESC, m.file_name ASC;
END;
$$;

-- ── Cited places (pages and video moments) ───────────────────────────────

-- A place is a document page, or a fixed-size time bucket of a video
-- (in_video_bucket_ms, 5 minutes by default). Documents without page
-- numbers form a single place with page_number NULL.
CREATE OR REPLACE FUNCTION public.get_course_cited_places(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_material_id uuid DEFAULT NULL,
  in_video_bucket_ms integer DEFAULT 300000,
  in_limit integer DEFAULT 50
)
RETURNS TABLE (
  material_id uuid,
  file_name text,
  file_type text,
  page_number integer,
  start_ms bigint,
  end_ms bigint,
  question_count bigint,
  citation_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket_ms bigint := GREATEST(1000, COALESCE(in_video_bucket_ms, 300000));
  row_limit integer := LEAST(200, GREATEST(1, COALESCE(in_limit, 50)));
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH cited AS (
    SELECT
      qe.id AS question_id,
      c.id AS citation_id,
      m.id AS place_material_id,
      m.file_name AS place_file_name,
      m.file_type::text AS place_file_type,
      CASE WHEN c.start_ms IS NULL THEN c.page_number END AS place_page,
      CASE WHEN c.start_ms IS NOT NULL THEN (c.start_ms / bucket_ms) * bucket_ms END AS place_start
    FROM public.query_events qe
    JOIN public.citations c ON c.message_id = qe.assistant_message_id
    JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
    WHERE qe.course_id = in_course_id
      AND qe.outcome = 'success' AND qe.error_code IS NULL
      AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
      AND (in_end_at IS NULL OR qe.created_at <= in_end_at)
      AND (in_material_id IS NULL OR m.id = in_material_id)
  )
  SELECT
    place_material_id,
    place_file_name,
    place_file_type,
    place_page,
    place_start,
    place_start + bucket_ms,
    COUNT(DISTINCT question_id)::bigint,
    COUNT(citation_id)::bigint
  FROM cited
  GROUP BY place_material_id, place_file_name, place_file_type, place_page, place_start
  ORDER BY 7 DESC, 8 DESC, place_file_name ASC, place_page ASC NULLS LAST, place_start ASC NULLS LAST
  LIMIT row_limit;
END;
$$;

-- ── Questions whose answers cited chosen places ──────────────────────────

-- in_places is a JSON array of places, each
--   {"material_id": uuid, "page_number": int|null}            (document), or
--   {"material_id": uuid, "start_ms": int, "end_ms": int}      (video).
-- A video citation matches when its time range overlaps the place's. A
-- document place matches citations of that material on the same page (or,
-- for page_number null, citations without a page and without a time).
-- Returns {"question_count", "student_count", "questions": [...]}: the counts
-- are exact; the question list holds the newest in_question_limit.
CREATE OR REPLACE FUNCTION public.get_course_questions_at_places(
  in_course_id uuid,
  in_start_at timestamptz,
  in_end_at timestamptz,
  in_places jsonb,
  in_question_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  question_limit integer := LEAST(200, GREATEST(0, COALESCE(in_question_limit, 50)));
  result jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF in_places IS NOT NULL AND jsonb_typeof(in_places) <> 'array' THEN
    RAISE EXCEPTION 'in_places must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(COALESCE(in_places, '[]'::jsonb)) > 200 THEN
    RAISE EXCEPTION 'At most 200 places can be counted at once' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH places AS (
    SELECT
      (place->>'material_id')::uuid AS material_id,
      (place->>'page_number')::integer AS page_number,
      (place->>'start_ms')::bigint AS start_ms,
      (place->>'end_ms')::bigint AS end_ms
    FROM jsonb_array_elements(COALESCE(in_places, '[]'::jsonb)) AS place
  ),
  hits AS (
    SELECT DISTINCT
      qe.id,
      qe.user_id,
      qe.query_text,
      qe.created_at,
      COALESCE(qe.ai_category, qe.query_category) AS category
    FROM public.query_events qe
    JOIN public.citations c ON c.message_id = qe.assistant_message_id
    JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
    JOIN places p ON p.material_id = c.material_id AND (
      (p.start_ms IS NOT NULL AND p.end_ms IS NOT NULL
        AND c.start_ms IS NOT NULL
        AND c.start_ms < p.end_ms
        AND COALESCE(c.end_ms, c.start_ms) >= p.start_ms)
      OR (p.start_ms IS NULL AND c.start_ms IS NULL
        AND p.page_number IS NOT DISTINCT FROM c.page_number)
    )
    WHERE qe.course_id = in_course_id
      AND qe.outcome = 'success' AND qe.error_code IS NULL
      AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
      AND (in_end_at IS NULL OR qe.created_at <= in_end_at)
  )
  SELECT jsonb_build_object(
    'question_count', (SELECT COUNT(*) FROM hits),
    'student_count', (SELECT COUNT(DISTINCT user_id) FROM hits),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', newest.id,
        'query_text', newest.query_text,
        'created_at', newest.created_at,
        'category', newest.category
      ) ORDER BY newest.created_at DESC)
      FROM (SELECT * FROM hits ORDER BY created_at DESC LIMIT question_limit) AS newest
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- ── Question buckets ─────────────────────────────────────────────────────

-- One row per category: the Decisions API label when present, otherwise the
-- rule-based query_category. labeled_count says how many carry an AI label.
CREATE OR REPLACE FUNCTION public.get_course_question_buckets(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL
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
    COALESCE(qe.ai_category, qe.query_category, 'other'),
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE qe.ai_labeled_at IS NOT NULL)::bigint,
    COUNT(*) FILTER (WHERE qe.ai_is_study_question)::bigint,
    COUNT(*) FILTER (WHERE qe.ai_answered_from_materials)::bigint
  FROM public.query_events qe
  WHERE qe.course_id = in_course_id
    AND qe.outcome = 'success' AND qe.error_code IS NULL
    AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
    AND (in_end_at IS NULL OR qe.created_at <= in_end_at)
  GROUP BY 1
  ORDER BY 2 DESC, 1 ASC;
END;
$$;

-- ── Admin chunk search for keyword analytics ─────────────────────────────

-- Unlike match_chunks_openai (the student search), this searches every
-- material of the course regardless of academic term or access scope, and
-- never student documents. Admins only.
CREATE OR REPLACE FUNCTION public.match_course_chunks_for_analytics(
  query_embedding extensions.vector(3072),
  in_course_id uuid,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 20
)
RETURNS TABLE (
  chunk_id uuid,
  material_id uuid,
  file_name text,
  file_type text,
  page_number integer,
  start_ms bigint,
  end_ms bigint,
  snippet text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  row_limit integer := LEAST(100, GREATEST(1, COALESCE(match_count, 20)));
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    m.id,
    m.file_name,
    m.file_type::text,
    c.page_number,
    c.start_ms,
    c.end_ms,
    left(c.chunk_text, 240),
    1 - (c.embedding_openai <=> query_embedding)
  FROM public.chunks c
  JOIN public.materials m ON m.id = c.material_id
  WHERE m.course_id = in_course_id
    AND c.embedding_openai IS NOT NULL
    AND 1 - (c.embedding_openai <=> query_embedding) > match_threshold
  ORDER BY c.embedding_openai <=> query_embedding
  LIMIT row_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_cited_materials(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_course_cited_places(uuid, timestamptz, timestamptz, uuid, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_course_questions_at_places(uuid, timestamptz, timestamptz, jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_course_question_buckets(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.match_course_chunks_for_analytics(extensions.vector, uuid, double precision, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_course_cited_materials(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_cited_places(uuid, timestamptz, timestamptz, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_questions_at_places(uuid, timestamptz, timestamptz, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_question_buckets(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_course_chunks_for_analytics(extensions.vector, uuid, double precision, integer) TO authenticated;

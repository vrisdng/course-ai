-- Question-first course analytics.
--
-- The analytics page leads with the questions students asked, filtered by
-- topic, cited file, page or video moment, source kind, question type, or
-- "needs attention". Citations from migration 20261024120000 become filters
-- and tags rather than the headline. Adds:
--   get_course_question_overview  the page's headline numbers
--   get_course_questions          the filterable, paged question list
--   get_course_question_terms     common words and phrases in questions
-- and drops get_course_questions_at_places, which get_course_questions
-- replaces.
--
-- A question needs attention when it is a study question (or not labelled
-- yet) and its answer didn't come from the materials: the Decisions API
-- label when there is one, otherwise "the answer cited nothing".

DROP FUNCTION IF EXISTS public.get_course_questions_at_places(uuid, timestamptz, timestamptz, jsonb, integer);

-- ── Shared helpers (not callable by clients) ─────────────────────────────

-- The counted questions of a course in a window, with their derived fields.
-- Called only from the SECURITY DEFINER functions below, which check
-- is_admin first.
CREATE OR REPLACE FUNCTION public.analytics_counted_questions(
  in_course_id uuid,
  in_start_at timestamptz,
  in_end_at timestamptz
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  assistant_message_id uuid,
  query_text text,
  created_at timestamptz,
  category text,
  is_labeled boolean,
  is_study_question boolean,
  answered_from_materials boolean,
  needs_attention boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    qe.id,
    qe.user_id,
    qe.assistant_message_id,
    qe.query_text,
    qe.created_at,
    COALESCE(qe.ai_category, qe.query_category, 'other'),
    qe.ai_labeled_at IS NOT NULL,
    qe.ai_is_study_question,
    qe.ai_answered_from_materials,
    qe.ai_is_study_question IS NOT FALSE AND CASE
      WHEN qe.ai_answered_from_materials IS NOT NULL THEN NOT qe.ai_answered_from_materials
      ELSE NOT EXISTS (
        SELECT 1 FROM public.citations c
        JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
        WHERE c.message_id = qe.assistant_message_id
      )
    END
  FROM public.query_events qe
  WHERE qe.course_id = in_course_id
    AND qe.outcome = 'success' AND qe.error_code IS NULL
    AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
    AND (in_end_at IS NULL OR qe.created_at <= in_end_at);
$$;

-- Whether a citation falls on any of the places, a JSON array as in
-- get_course_questions' in_places. Video citations match by overlapping
-- time; document citations by page (page_number null matches citations
-- without a page or time).
CREATE OR REPLACE FUNCTION public.analytics_citation_at_places(
  in_material_id uuid,
  in_page_number integer,
  in_start_ms bigint,
  in_end_ms bigint,
  in_places jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(in_places, '[]'::jsonb)) AS place
    WHERE (place->>'material_id')::uuid = in_material_id
      AND (
        (place->>'start_ms' IS NOT NULL AND place->>'end_ms' IS NOT NULL
          AND in_start_ms IS NOT NULL
          AND in_start_ms < (place->>'end_ms')::bigint
          AND COALESCE(in_end_ms, in_start_ms) >= (place->>'start_ms')::bigint)
        OR (place->>'start_ms' IS NULL AND in_start_ms IS NULL
          AND (place->>'page_number')::integer IS NOT DISTINCT FROM in_page_number)
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.analytics_counted_questions(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.analytics_citation_at_places(uuid, integer, bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated;

-- ── Overview ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_course_question_overview(
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
  -- Questions whose answers cited any course material, a document, a video.
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
    (SELECT COUNT(*) FROM kinds)::bigint,
    (SELECT COUNT(*) FILTER (WHERE kinds.cites_document) FROM kinds)::bigint,
    (SELECT COUNT(*) FILTER (WHERE kinds.cites_video) FROM kinds)::bigint;
END;
$$;

-- ── Question list ────────────────────────────────────────────────────────

-- All filters combine (AND):
--   in_topic_text / in_topic_places  a topic: the question's text contains
--       the words (stemmed, in order), OR its answer cited one of the topic
--       places (pages and moments the topic was found in by the
--       course-analytics function). Either may be given alone.
--   in_places        the answer cited one of these places
--   in_material_id   the answer cited this file
--   in_source_kind   'document' or 'video': the answer cited that kind
--   in_category      the question's type
--   in_needs_attention  only questions needing attention
-- Returns {"total_count", "student_count", "questions": [...]} with exact
-- counts and the page of questions at in_offset, newest first. Student ids
-- are never returned.
CREATE OR REPLACE FUNCTION public.get_course_questions(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_topic_text text DEFAULT NULL,
  in_topic_places jsonb DEFAULT NULL,
  in_places jsonb DEFAULT NULL,
  in_material_id uuid DEFAULT NULL,
  in_source_kind text DEFAULT NULL,
  in_category text DEFAULT NULL,
  in_needs_attention boolean DEFAULT false,
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
    SELECT c.message_id, c.material_id, c.page_number, c.start_ms, c.end_ms, m.file_name, m.file_type::text AS file_type
    FROM public.citations c
    JOIN public.materials m ON m.id = c.material_id AND m.course_id = in_course_id
  ),
  filtered AS (
    SELECT q.*
    FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at) q
    WHERE (in_category IS NULL OR q.category = in_category)
      AND (NOT COALESCE(in_needs_attention, false) OR q.needs_attention)
      AND (in_material_id IS NULL OR EXISTS (
        SELECT 1 FROM cites c WHERE c.message_id = q.assistant_message_id AND c.material_id = in_material_id))
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
        'sources', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'material_id', s.material_id,
            'file_name', s.file_name,
            'file_type', s.file_type,
            'page_number', s.page_number,
            'start_ms', s.start_ms,
            'end_ms', s.end_ms
          ) ORDER BY s.file_name, s.page_number NULLS LAST, s.start_ms NULLS LAST)
          FROM (
            SELECT DISTINCT c.material_id, c.file_name, c.file_type, c.page_number, c.start_ms, c.end_ms
            FROM cites c WHERE c.message_id = p.assistant_message_id
          ) s
        ), '[]'::jsonb)
      ) ORDER BY p.created_at DESC, p.id)
      FROM page p
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- ── Common terms ─────────────────────────────────────────────────────────

-- Words and adjacent two-word phrases from study questions (and questions
-- not labelled yet), counted once per question. A term is kept when every
-- word in it also appears in this course's materials, which drops chatter
-- ("thanks", "midterm"); English stop words and a few study filler words
-- ("explain", "example") are dropped too. term_key is the stemmed form; term
-- is the wording students used most. Ranked by questions, most first.
-- Costs one text-search pass over the course's chunks per call.
CREATE OR REPLACE FUNCTION public.get_course_question_terms(
  in_course_id uuid,
  in_start_at timestamptz DEFAULT NULL,
  in_end_at timestamptz DEFAULT NULL,
  in_min_questions integer DEFAULT 2,
  in_limit integer DEFAULT 60
)
RETURNS TABLE (
  term_key text,
  term text,
  word_count integer,
  question_count bigint,
  student_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  min_questions integer := GREATEST(1, COALESCE(in_min_questions, 2));
  row_limit integer := LEAST(200, GREATEST(1, COALESCE(in_limit, 60)));
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH filler AS (
    SELECT unnest(tsvector_to_array(to_tsvector('english',
      'explain explanation example examples difference differences question questions answer answers '
      || 'lecture lectures slide slides page pages video videos chapter week lesson topic course notes note '
      || 'mean meaning means work works use used using help understand tell give know need want like '
      || 'also would could get make does thing things way please thank thanks hello okay can will just '
      || 'really still show find describe define definition simple simply better good'))) AS lexeme
  ),
  q AS (
    SELECT cq.id, cq.user_id, cq.query_text
    FROM public.analytics_counted_questions(in_course_id, in_start_at, in_end_at) cq
    WHERE cq.is_study_question IS NOT FALSE
  ),
  words AS (
    SELECT q.id, q.user_id, w.word, w.pos,
      (tsvector_to_array(to_tsvector('english', w.word)))[1] AS lexeme
    FROM q, regexp_split_to_table(lower(q.query_text), '[^[:alnum:]]+') WITH ORDINALITY AS w(word, pos)
    WHERE length(w.word) >= 3 AND w.word !~ '^[0-9]+$'
  ),
  kept AS (
    SELECT * FROM words
    WHERE words.lexeme IS NOT NULL AND words.lexeme NOT IN (SELECT filler.lexeme FROM filler)
  ),
  grams AS (
    SELECT k.lexeme AS key, k.word AS surface, 1 AS n, k.id, k.user_id FROM kept k
    UNION ALL
    SELECT a.lexeme || ' ' || b.lexeme, a.word || ' ' || b.word, 2, a.id, a.user_id
    FROM kept a JOIN kept b ON b.id = a.id AND b.pos = a.pos + 1
  ),
  candidates AS (
    SELECT
      g.key,
      mode() WITHIN GROUP (ORDER BY g.surface) AS surface,
      g.n,
      COUNT(DISTINCT g.id) AS questions,
      COUNT(DISTINCT g.user_id) AS students
    FROM grams g
    GROUP BY g.key, g.n
    HAVING COUNT(DISTINCT g.id) >= min_questions
    ORDER BY 4 DESC, g.key
    LIMIT 400
  ),
  needed AS (
    SELECT DISTINCT unnest(string_to_array(c.key, ' ')) AS lexeme FROM candidates c
  ),
  vocab AS (
    SELECT DISTINCT lex AS lexeme
    FROM public.chunks ch
    JOIN public.materials m ON m.id = ch.material_id AND m.course_id = in_course_id,
      unnest(tsvector_to_array(to_tsvector('english', ch.chunk_text))) AS lex
    WHERE lex IN (SELECT needed.lexeme FROM needed)
  )
  SELECT c.key, c.surface, c.n, c.questions::bigint, c.students::bigint
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM unnest(string_to_array(c.key, ' ')) AS part(lexeme)
    WHERE part.lexeme NOT IN (SELECT vocab.lexeme FROM vocab)
  )
  ORDER BY c.questions DESC, c.n DESC, c.surface ASC
  LIMIT row_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_question_overview(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_course_questions(uuid, timestamptz, timestamptz, text, jsonb, jsonb, uuid, text, text, boolean, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_course_question_terms(uuid, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_course_question_overview(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_questions(uuid, timestamptz, timestamptz, text, jsonb, jsonb, uuid, text, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_question_terms(uuid, timestamptz, timestamptz, integer, integer) TO authenticated;

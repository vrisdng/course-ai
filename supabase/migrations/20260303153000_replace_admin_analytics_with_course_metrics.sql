CREATE OR REPLACE FUNCTION public.get_course_document_reference_stats(
  in_course_id UUID,
  in_start_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  material_id UUID,
  file_name TEXT,
  file_type public.document_type,
  unique_student_count BIGINT,
  reference_count BIGINT,
  question_count BIGINT,
  last_referenced_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    m.id AS material_id,
    m.file_name,
    m.file_type,
    COUNT(DISTINCT qe.user_id)::BIGINT AS unique_student_count,
    COUNT(c.id) FILTER (WHERE qe.id IS NOT NULL)::BIGINT AS reference_count,
    COUNT(DISTINCT qe.id)::BIGINT AS question_count,
    MAX(qe.created_at) AS last_referenced_at
  FROM public.materials m
  LEFT JOIN public.chunks ch
    ON ch.material_id = m.id
  LEFT JOIN public.citations c
    ON c.chunk_id = ch.id
  LEFT JOIN public.query_events qe
    ON qe.assistant_message_id = c.message_id
    AND qe.course_id = in_course_id
    AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
  WHERE m.course_id = in_course_id
  GROUP BY m.id, m.file_name, m.file_type
  ORDER BY reference_count DESC, unique_student_count DESC, m.file_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_course_top_questions(
  in_course_id UUID,
  in_start_at TIMESTAMPTZ DEFAULT NULL,
  in_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  question TEXT,
  frequency BIGINT,
  unique_student_count BIGINT,
  last_asked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH normalized_queries AS (
    SELECT
      trim(regexp_replace(qe.query_text, '\s+', ' ', 'g')) AS normalized_query,
      qe.query_text,
      qe.user_id,
      qe.created_at
    FROM public.query_events qe
    WHERE qe.course_id = in_course_id
      AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
  )
  SELECT
    (array_agg(nq.query_text ORDER BY nq.created_at DESC))[1] AS question,
    COUNT(*)::BIGINT AS frequency,
    COUNT(DISTINCT nq.user_id)::BIGINT AS unique_student_count,
    MAX(nq.created_at) AS last_asked_at
  FROM normalized_queries nq
  GROUP BY nq.normalized_query
  ORDER BY frequency DESC, last_asked_at DESC
  LIMIT LEAST(GREATEST(in_limit, 1), 10);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_course_keyword_stats(
  in_course_id UUID,
  in_start_at TIMESTAMPTZ DEFAULT NULL,
  in_limit INTEGER DEFAULT 12
)
RETURNS TABLE (
  keyword TEXT,
  frequency BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stopwords TEXT[] := ARRAY[
    'a','about','after','all','also','an','and','any','are','been','before','being','between','both',
    'but','can','could','did','does','doing','down','during','each','for','from','had','has','have',
    'how','into','its','just','more','most','not','now','our','out','over','same','should','some',
    'than','that','the','their','them','then','there','these','they','this','those','through','under',
    'using','very','want','was','what','when','where','which','while','who','why','with','would','your',
    'document','documents','course','courses','refer','reference','referenced','student','students',
    'tell','give','show','explain','please'
  ];
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH filtered_queries AS (
    SELECT lower(trim(regexp_replace(qe.query_text, '\s+', ' ', 'g'))) AS normalized_query
    FROM public.query_events qe
    WHERE qe.course_id = in_course_id
      AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
  ),
  tokens AS (
    SELECT token
    FROM filtered_queries fq,
    LATERAL regexp_split_to_table(fq.normalized_query, '[^a-z0-9]+') AS token
    WHERE char_length(token) >= 3
      AND token !~ '^[0-9]+$'
      AND NOT (token = ANY(stopwords))
  )
  SELECT
    token AS keyword,
    COUNT(*)::BIGINT AS frequency
  FROM tokens
  GROUP BY token
  ORDER BY frequency DESC, keyword ASC
  LIMIT LEAST(GREATEST(in_limit, 1), 20);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_document_reference_stats(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_top_questions(UUID, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_keyword_stats(UUID, TIMESTAMPTZ, INTEGER) TO authenticated;

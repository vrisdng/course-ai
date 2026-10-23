-- One best-effort terminal record per authenticated, valid student-chat request.
ALTER TABLE public.query_events
  ADD COLUMN request_id UUID UNIQUE,
  ADD COLUMN pipeline_version TEXT,
  ADD COLUMN model_id TEXT,
  ADD COLUMN model_tier TEXT CHECK (model_tier IN ('fast', 'smart', 'pro')),
  ADD COLUMN skip_rag BOOLEAN,
  ADD COLUMN search_count INTEGER CHECK (search_count >= 0),
  ADD COLUMN tool_call_count INTEGER CHECK (tool_call_count >= 0),
  ADD COLUMN embedding_ms INTEGER CHECK (embedding_ms >= 0),
  ADD COLUMN retrieval_ms INTEGER CHECK (retrieval_ms >= 0),
  ADD COLUMN generation_ms INTEGER CHECK (generation_ms >= 0),
  ADD COLUMN first_token_ms INTEGER CHECK (first_token_ms >= 0),
  ADD COLUMN prompt_tokens BIGINT CHECK (prompt_tokens >= 0),
  ADD COLUMN completion_tokens BIGINT CHECK (completion_tokens >= 0),
  -- Historical events were only written after successful generation and message saves.
  ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'error', 'aborted')),
  ADD COLUMN error_code TEXT;

CREATE INDEX idx_query_events_course_created_at ON public.query_events(course_id, created_at DESC);
CREATE INDEX idx_query_events_outcome_created_at ON public.query_events(outcome, created_at DESC);

-- UTC daily buckets support date-window queries without averaging precomputed percentiles.
-- Successful-answer latency ends at final SSE delivery; aborted turns are excluded from error rate.
CREATE VIEW public.analytics_course_chat_health
WITH (security_invoker = true) AS
SELECT
  course_id,
  academic_term_id,
  (created_at AT TIME ZONE 'UTC')::date AS day,
  COUNT(*)::BIGINT AS request_count,
  COUNT(*) FILTER (WHERE outcome = 'success')::BIGINT AS success_count,
  COUNT(*) FILTER (WHERE outcome = 'error')::BIGINT AS error_count,
  COUNT(*) FILTER (WHERE outcome = 'aborted')::BIGINT AS aborted_count,
  AVG(latency_ms) FILTER (WHERE outcome = 'success') AS avg_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = 'success') AS p95_latency_ms,
  COUNT(*) FILTER (WHERE outcome = 'error')::numeric /
    NULLIF(COUNT(*) FILTER (WHERE outcome <> 'aborted'), 0) AS error_rate,
  SUM(prompt_tokens) AS prompt_tokens,
  SUM(completion_tokens) AS completion_tokens,
  COUNT(*) FILTER (WHERE prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL)::BIGINT AS known_usage_count,
  COUNT(*) FILTER (WHERE error_code = 'message_persistence_failed')::BIGINT AS persistence_error_count
FROM public.query_events
WHERE request_id IS NOT NULL
GROUP BY course_id, academic_term_id, (created_at AT TIME ZONE 'UTC')::date;

REVOKE ALL ON public.analytics_course_chat_health FROM PUBLIC, anon;
GRANT SELECT ON public.analytics_course_chat_health TO authenticated, service_role;

-- Preserve completed-turn semantics for current and legacy analytics RPC overloads.
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
    AND qe.outcome = 'success' AND qe.error_code IS NULL
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
    AND qe.outcome = 'success' AND qe.error_code IS NULL
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
    AND qe.outcome = 'success' AND qe.error_code IS NULL
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

CREATE OR REPLACE FUNCTION public.get_course_document_reference_stats(
  in_course_id UUID,
  in_start_at TIMESTAMPTZ DEFAULT NULL,
  in_end_at TIMESTAMPTZ DEFAULT NULL
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
    AND qe.outcome = 'success' AND qe.error_code IS NULL
    AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
    AND (in_end_at IS NULL OR qe.created_at <= in_end_at)
  WHERE m.course_id = in_course_id
  GROUP BY m.id, m.file_name, m.file_type
  ORDER BY reference_count DESC, unique_student_count DESC, m.file_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_course_top_questions(
  in_course_id UUID,
  in_start_at TIMESTAMPTZ DEFAULT NULL,
  in_end_at TIMESTAMPTZ DEFAULT NULL,
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
    AND qe.outcome = 'success' AND qe.error_code IS NULL
      AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
      AND (in_end_at IS NULL OR qe.created_at <= in_end_at)
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
  in_end_at TIMESTAMPTZ DEFAULT NULL,
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
    AND qe.outcome = 'success' AND qe.error_code IS NULL
      AND (in_start_at IS NULL OR qe.created_at >= in_start_at)
      AND (in_end_at IS NULL OR qe.created_at <= in_end_at)
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

CREATE OR REPLACE FUNCTION public.get_course_active_student_count(
  in_course_id UUID,
  in_start_at TIMESTAMPTZ DEFAULT NULL,
  in_end_at TIMESTAMPTZ DEFAULT NULL
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
    AND outcome = 'success' AND error_code IS NULL
    AND (in_start_at IS NULL OR created_at >= in_start_at)
    AND (in_end_at IS NULL OR created_at <= in_end_at);

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_document_reference_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_top_questions(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_keyword_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_active_student_count(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

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
    AND outcome = 'success' AND error_code IS NULL
    AND (in_start_at IS NULL OR created_at >= in_start_at);

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_course_active_student_count(UUID, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE VIEW public.analytics_query_category_stats
WITH (security_invoker = true) AS
SELECT
  query_category,
  COUNT(*)::BIGINT AS query_count,
  SUM(CASE WHEN citation_hit THEN 1 ELSE 0 END)::BIGINT AS citation_hit_count,
  ROUND(AVG(CASE WHEN citation_hit THEN 1.0 ELSE 0.0 END)::numeric, 4) AS citation_hit_rate,
  SUM(CASE WHEN unresolved THEN 1 ELSE 0 END)::BIGINT AS unresolved_count
FROM public.query_events
WHERE outcome = 'success' AND error_code IS NULL
GROUP BY query_category;

CREATE OR REPLACE VIEW public.analytics_recent_unresolved_queries
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  course_id,
  academic_term_id,
  query_category,
  unresolved_reason,
  query_text
FROM public.query_events
WHERE unresolved = true AND outcome = 'success' AND error_code IS NULL
ORDER BY created_at DESC;

GRANT SELECT ON public.analytics_query_category_stats TO authenticated;
GRANT SELECT ON public.analytics_recent_unresolved_queries TO authenticated;

-- Embeddings move from gemini-embedding-001 (vector(1536) in chunks.embedding)
-- to OpenAI text-embedding-3-large (3072 dims). Vectors from different models
-- are not comparable, so the new vectors live in their own column and are
-- searched by their own function while the backfill runs. Ingestion and
-- rag-chat switch over together once every chunk has embedding_openai; a
-- follow-up migration drops chunks.embedding, its ivfflat index and the old
-- match_chunks overloads.
--
-- No ANN index: pgvector only indexes vector columns up to 2000 dims (3072
-- would need an expression index on halfvec), and match_chunks_openai filters
-- by course/term/access after scoring, which an approximate index would
-- truncate. An exact scan is fine at the current table size.

ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS embedding_openai extensions.vector(3072);

-- Same scoping rules as match_chunks (20260803095500), with one change: the
-- caller's identity comes from the JWT (auth.uid()) when there is one, so an
-- authenticated caller cannot pass another user's id. Service-role callers
-- (no JWT user) still pass user_id explicitly. Not executable by anon.
CREATE OR REPLACE FUNCTION public.match_chunks_openai(
  query_embedding extensions.vector(3072),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 5,
  user_id uuid DEFAULT NULL,
  course_id_filter uuid DEFAULT NULL,
  selected_material_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  chunk_text text,
  material_id uuid,
  student_document_id uuid,
  page_number int,
  start_ms bigint,
  end_ms bigint,
  relevance_score float,
  material_name text,
  material_type text,
  document_name text,
  document_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  active_term_id uuid;
  caller_id uuid;
BEGIN
  caller_id := COALESCE(auth.uid(), match_chunks_openai.user_id);
  active_term_id := public.get_active_academic_term_id();

  RETURN QUERY
  SELECT
    c.id,
    c.chunk_text,
    c.material_id,
    c.student_document_id,
    c.page_number,
    c.start_ms,
    c.end_ms,
    1 - (c.embedding_openai <=> query_embedding) AS relevance_score,
    m.file_name AS material_name,
    m.file_type::text AS material_type,
    sd.file_name AS document_name,
    sd.file_type::text AS document_type
  FROM public.chunks c
  LEFT JOIN public.materials m ON c.material_id = m.id
  LEFT JOIN public.student_documents sd ON c.student_document_id = sd.id
  WHERE
    c.embedding_openai IS NOT NULL
    AND 1 - (c.embedding_openai <=> query_embedding) > match_threshold
    AND (
      (
        c.material_id IS NOT NULL
        -- Explicit material IDs define their own scope. The active-term
        -- restriction applies only when searching all course materials.
        AND (
          selected_material_ids IS NOT NULL
          OR (active_term_id IS NOT NULL AND m.academic_term_id = active_term_id)
        )
        AND (course_id_filter IS NULL OR m.course_id = course_id_filter)
        AND (selected_material_ids IS NULL OR m.id = ANY(selected_material_ids))
        AND (
          m.access_scope = 'public'
          OR (
            m.access_scope = 'course'
            AND (
              public.is_enrolled(caller_id, m.course_id)
              OR public.is_course_lecturer(caller_id, m.course_id)
            )
          )
          OR (
            m.access_scope = 'private'
            AND EXISTS (
              SELECT 1
              FROM public.profiles p
              WHERE p.id = m.uploaded_by
                AND p.user_id = caller_id
            )
          )
        )
      )
      OR (
        selected_material_ids IS NULL
        AND c.student_document_id IS NOT NULL
        AND sd.user_id = caller_id
      )
    )
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;

REVOKE ALL ON FUNCTION public.match_chunks_openai(extensions.vector, float, int, uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_chunks_openai(extensions.vector, float, int, uuid, uuid, uuid[]) TO authenticated, service_role;

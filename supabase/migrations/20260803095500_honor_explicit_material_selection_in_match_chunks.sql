CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.5,
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
BEGIN
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
    1 - (c.embedding <=> query_embedding) AS relevance_score,
    m.file_name AS material_name,
    m.file_type::text AS material_type,
    sd.file_name AS document_name,
    sd.file_type::text AS document_type
  FROM public.chunks c
  LEFT JOIN public.materials m ON c.material_id = m.id
  LEFT JOIN public.student_documents sd ON c.student_document_id = sd.id
  WHERE
    c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
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
              public.is_enrolled(match_chunks.user_id, m.course_id)
              OR public.is_course_lecturer(match_chunks.user_id, m.course_id)
            )
          )
          OR (
            m.access_scope = 'private'
            AND EXISTS (
              SELECT 1
              FROM public.profiles p
              WHERE p.id = m.uploaded_by
                AND p.user_id = match_chunks.user_id
            )
          )
        )
      )
      OR (
        selected_material_ids IS NULL
        AND c.student_document_id IS NOT NULL
        AND sd.user_id = match_chunks.user_id
      )
    )
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;

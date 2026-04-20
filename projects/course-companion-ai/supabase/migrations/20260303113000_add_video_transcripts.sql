DO $$
BEGIN
  ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'video';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS duration_ms bigint,
  ADD COLUMN IF NOT EXISTS transcription_provider text,
  ADD COLUMN IF NOT EXISTS transcription_language text,
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS start_ms bigint,
  ADD COLUMN IF NOT EXISTS end_ms bigint;

CREATE TABLE IF NOT EXISTS public.material_transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  segment_index integer NOT NULL,
  start_ms bigint NOT NULL,
  end_ms bigint NOT NULL,
  text text NOT NULL,
  confidence numeric NULL,
  speaker_label text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS material_transcript_segments_material_id_segment_index_key
  ON public.material_transcript_segments(material_id, segment_index);

CREATE INDEX IF NOT EXISTS material_transcript_segments_material_id_start_ms_idx
  ON public.material_transcript_segments(material_id, start_ms);

ALTER TABLE public.material_transcript_segments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'material_transcript_segments'
      AND policyname = 'Users can view transcript segments for accessible materials'
  ) THEN
    CREATE POLICY "Users can view transcript segments for accessible materials"
      ON public.material_transcript_segments
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.materials m
          LEFT JOIN public.profiles p ON p.id = m.uploaded_by
          WHERE m.id = material_transcript_segments.material_id
            AND (
              m.access_scope = 'public'
              OR (
                m.access_scope = 'course'
                AND (
                  public.is_enrolled(auth.uid(), m.course_id)
                  OR public.is_course_lecturer(auth.uid(), m.course_id)
                )
              )
              OR (
                m.access_scope = 'private'
                AND p.user_id = auth.uid()
              )
            )
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.material_transcript_segments TO authenticated;

DROP FUNCTION IF EXISTS public.match_chunks(vector(1536), float, int, uuid, uuid);

CREATE FUNCTION public.match_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5,
  user_id uuid DEFAULT NULL,
  course_id_filter uuid DEFAULT NULL
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
        AND active_term_id IS NOT NULL
        AND m.academic_term_id = active_term_id
        AND (course_id_filter IS NULL OR m.course_id = course_id_filter)
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
        c.student_document_id IS NOT NULL
        AND sd.user_id = match_chunks.user_id
      )
    )
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;

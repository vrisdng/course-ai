-- Add explicit material access scope and enforce it across RLS + retrieval.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'material_access_scope'
  ) THEN
    CREATE TYPE public.material_access_scope AS ENUM ('course', 'public', 'private');
  END IF;
END
$$;

ALTER TABLE public.materials
ADD COLUMN IF NOT EXISTS access_scope public.material_access_scope;

UPDATE public.materials
SET access_scope = CASE
  WHEN is_public IS TRUE THEN 'public'::public.material_access_scope
  ELSE 'course'::public.material_access_scope
END
WHERE access_scope IS NULL;

ALTER TABLE public.materials
ALTER COLUMN access_scope SET DEFAULT 'course'::public.material_access_scope;

ALTER TABLE public.materials
ALTER COLUMN access_scope SET NOT NULL;

-- Keep legacy column aligned for compatibility.
UPDATE public.materials
SET is_public = (access_scope = 'public');

DROP POLICY IF EXISTS "Users can view materials when allowed" ON public.materials;
DROP POLICY IF EXISTS "Enrolled users and lecturers can view materials" ON public.materials;
DROP POLICY IF EXISTS "Enrolled users and staff can view materials" ON public.materials;
DROP POLICY IF EXISTS "Users can view materials by access scope" ON public.materials;

CREATE POLICY "Users can view materials by access scope"
ON public.materials FOR SELECT
TO authenticated
USING (
  access_scope = 'public'
  OR (
    access_scope = 'course'
    AND (
      public.is_enrolled(auth.uid(), course_id)
      OR public.is_course_lecturer(auth.uid(), course_id)
    )
  )
  OR (
    access_scope = 'private'
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = uploaded_by
        AND p.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Users can view course chunks" ON public.chunks;
DROP POLICY IF EXISTS "Users can view chunks by access scope" ON public.chunks;

CREATE POLICY "Users can view chunks by access scope"
ON public.chunks FOR SELECT
TO authenticated
USING (
  (
    material_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.materials m
      WHERE m.id = material_id
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
            AND EXISTS (
              SELECT 1
              FROM public.profiles p
              WHERE p.id = m.uploaded_by
                AND p.user_id = auth.uid()
            )
          )
        )
    )
  )
  OR (
    student_document_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.student_documents sd
      WHERE sd.id = student_document_id
        AND sd.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Enrolled users and staff can view course materials" ON storage.objects;
DROP POLICY IF EXISTS "Users can view course materials by access scope" ON storage.objects;

CREATE POLICY "Users can view course materials by access scope"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'course-materials'
  AND EXISTS (
    SELECT 1
    FROM public.materials m
    WHERE m.file_path = name
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
          AND EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = m.uploaded_by
              AND p.user_id = auth.uid()
          )
        )
      )
  )
);

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding extensions.vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5,
  user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  chunk_text text,
  material_id uuid,
  student_document_id uuid,
  page_number int,
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
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.chunk_text,
    c.material_id,
    c.student_document_id,
    c.page_number,
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

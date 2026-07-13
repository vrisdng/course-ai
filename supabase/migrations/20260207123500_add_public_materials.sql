-- Add public flag to materials
ALTER TABLE public.materials
ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- Update materials select policy to allow public materials
DROP POLICY IF EXISTS "Enrolled users and lecturers can view materials" ON public.materials;
CREATE POLICY "Users can view materials when allowed"
ON public.materials FOR SELECT
TO authenticated
USING (
  is_public OR
  public.is_enrolled(auth.uid(), course_id) OR
  public.is_course_lecturer(auth.uid(), course_id)
);

-- Update chunks select policy to allow public materials
DROP POLICY IF EXISTS "Users can view course chunks" ON public.chunks;
CREATE POLICY "Users can view course chunks"
ON public.chunks FOR SELECT
TO authenticated
USING (
  (material_id IS NOT NULL AND (
    public.is_enrolled(auth.uid(), public.get_material_course_id(material_id)) OR
    public.is_course_lecturer(auth.uid(), public.get_material_course_id(material_id)) OR
    EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_id AND m.is_public
    )
  )) OR
  (student_document_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.student_documents sd
    WHERE sd.id = student_document_id AND sd.user_id = auth.uid()
  ))
);

-- Update storage policy to allow public materials
DROP POLICY IF EXISTS "Enrolled users can view course materials" ON storage.objects;
CREATE POLICY "Users can view course materials when allowed"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'course-materials'
  AND EXISTS (
    SELECT 1 FROM public.materials m
    WHERE m.file_path = name
      AND (
        m.is_public OR
        public.is_enrolled(auth.uid(), m.course_id) OR
        public.is_course_lecturer(auth.uid(), m.course_id)
      )
  )
);

-- Update match_chunks to include public materials
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
    1 - (c.embedding <=> query_embedding) as relevance_score,
    m.file_name as material_name,
    m.file_type::text as material_type,
    sd.file_name as document_name,
    sd.file_type::text as document_type
  FROM public.chunks c
  LEFT JOIN public.materials m ON c.material_id = m.id
  LEFT JOIN public.student_documents sd ON c.student_document_id = sd.id
  WHERE 
    c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
    AND (
      -- User can access course materials they're enrolled in
      (c.material_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.user_id = match_chunks.user_id AND e.course_id = m.course_id
      ))
      OR
      -- User can access course materials if they're staff (lecturer/admin)
      (c.material_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.courses co ON co.created_by = p.id
        WHERE p.user_id = match_chunks.user_id
          AND co.id = m.course_id
          AND p.role IN ('lecturer', 'admin')
      ))
      OR
      -- Public materials are accessible to all accounts
      (c.material_id IS NOT NULL AND m.is_public IS TRUE)
      OR
      -- User can access their own private documents
      (c.student_document_id IS NOT NULL AND sd.user_id = match_chunks.user_id)
      OR
      -- Admins can access all course materials
      (c.material_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = match_chunks.user_id AND p.role = 'admin'
      ))
    )
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;

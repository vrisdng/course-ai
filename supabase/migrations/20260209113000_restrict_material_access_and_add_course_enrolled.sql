-- Add course enrollment snapshot to profiles for quick access checks in app/auth context.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS course_enrolled UUID[] NOT NULL DEFAULT '{}'::UUID[];

-- Backfill existing profiles from enrollments.
UPDATE public.profiles p
SET course_enrolled = COALESCE(
  (
    SELECT array_agg(e.course_id ORDER BY e.enrolled_at)
    FROM public.enrollments e
    WHERE e.user_id = p.user_id
  ),
  '{}'::UUID[]
);

CREATE OR REPLACE FUNCTION public.sync_profile_course_enrolled(target_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles p
  SET course_enrolled = COALESCE(
    (
      SELECT array_agg(e.course_id ORDER BY e.enrolled_at)
      FROM public.enrollments e
      WHERE e.user_id = target_user_id
    ),
    '{}'::UUID[]
  )
  WHERE p.user_id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_enrollment_profile_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_profile_course_enrolled(NEW.user_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.sync_profile_course_enrolled(OLD.user_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_profile_course_enrolled(NEW.user_id);
  IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.sync_profile_course_enrolled(OLD.user_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_course_enrolled_on_enrollments ON public.enrollments;
CREATE TRIGGER sync_profile_course_enrolled_on_enrollments
AFTER INSERT OR UPDATE OR DELETE ON public.enrollments
FOR EACH ROW
EXECUTE FUNCTION public.handle_enrollment_profile_sync();

-- Keep authorization checks on the canonical enrollments table.
CREATE OR REPLACE FUNCTION public.is_enrolled(check_user_id UUID, check_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.enrollments e
    WHERE e.user_id = check_user_id
    AND e.course_id = check_course_id
  );
END;
$$;

-- Remove any previously public materials so access is always course-enrollment based.
UPDATE public.materials
SET is_public = false
WHERE is_public IS TRUE;

DROP POLICY IF EXISTS "Users can view materials when allowed" ON public.materials;
DROP POLICY IF EXISTS "Enrolled users and lecturers can view materials" ON public.materials;
DROP POLICY IF EXISTS "Enrolled users and staff can view materials" ON public.materials;
CREATE POLICY "Enrolled users and staff can view materials"
ON public.materials FOR SELECT
TO authenticated
USING (
  public.is_enrolled(auth.uid(), course_id) OR
  public.is_course_lecturer(auth.uid(), course_id)
);

DROP POLICY IF EXISTS "Users can view course chunks" ON public.chunks;
CREATE POLICY "Users can view course chunks"
ON public.chunks FOR SELECT
TO authenticated
USING (
  (material_id IS NOT NULL AND (
    public.is_enrolled(auth.uid(), public.get_material_course_id(material_id)) OR
    public.is_course_lecturer(auth.uid(), public.get_material_course_id(material_id))
  )) OR
  (student_document_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.student_documents sd
    WHERE sd.id = student_document_id AND sd.user_id = auth.uid()
  ))
);

DROP POLICY IF EXISTS "Users can view course materials when allowed" ON storage.objects;
DROP POLICY IF EXISTS "Enrolled users can view course materials" ON storage.objects;
DROP POLICY IF EXISTS "Enrolled users and staff can view course materials" ON storage.objects;
CREATE POLICY "Enrolled users and staff can view course materials"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'course-materials'
  AND EXISTS (
    SELECT 1
    FROM public.materials m
    WHERE m.file_path = name
      AND (
        public.is_enrolled(auth.uid(), m.course_id) OR
        public.is_course_lecturer(auth.uid(), m.course_id)
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
      (c.material_id IS NOT NULL AND (
        public.is_enrolled(match_chunks.user_id, m.course_id) OR
        public.is_course_lecturer(match_chunks.user_id, m.course_id)
      ))
      OR
      (c.student_document_id IS NOT NULL AND sd.user_id = match_chunks.user_id)
    )
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;

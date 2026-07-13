-- Create a function for vector similarity search with proper access control
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
      -- User can access course materials if they're the lecturer
      (c.material_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.courses co ON co.created_by = p.id
        WHERE p.user_id = match_chunks.user_id AND co.id = m.course_id AND p.role = 'lecturer'
      ))
      OR
      -- User can access their own private documents
      (c.student_document_id IS NOT NULL AND sd.user_id = match_chunks.user_id)
    )
  ORDER BY relevance_score DESC
  LIMIT match_count;
END;
$$;
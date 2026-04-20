-- Add semester-versioned academic terms for course materials and restrict retrieval to the active term.

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = check_user_id
      AND role = 'admin'
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.academic_terms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  semester INTEGER NOT NULL CHECK (semester IN (1, 2)),
  academic_year_start INTEGER NOT NULL CHECK (academic_year_start >= 2000),
  academic_year_end INTEGER NOT NULL CHECK (academic_year_end = academic_year_start + 1),
  sort_key INTEGER GENERATED ALWAYS AS (academic_year_start * 10 + semester) STORED,
  is_active BOOLEAN NOT NULL DEFAULT false,
  starts_on DATE,
  ends_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_academic_terms_updated_at ON public.academic_terms;

CREATE TRIGGER update_academic_terms_updated_at
BEFORE UPDATE ON public.academic_terms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.academic_terms (label, semester, academic_year_start, academic_year_end, is_active)
VALUES ('Semester 2 AY25/26', 2, 2025, 2026, true)
ON CONFLICT (label) DO UPDATE
SET
  semester = EXCLUDED.semester,
  academic_year_start = EXCLUDED.academic_year_start,
  academic_year_end = EXCLUDED.academic_year_end;

INSERT INTO public.academic_terms (label, semester, academic_year_start, academic_year_end, is_active)
VALUES ('Semester 1 AY26/27', 1, 2026, 2027, false)
ON CONFLICT (label) DO NOTHING;

UPDATE public.academic_terms
SET is_active = (label = 'Semester 2 AY25/26');

CREATE UNIQUE INDEX IF NOT EXISTS academic_terms_single_active_idx
ON public.academic_terms (is_active)
WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_academic_terms_sort_key
ON public.academic_terms (sort_key DESC);

CREATE OR REPLACE FUNCTION public.get_active_academic_term_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_term_id UUID;
BEGIN
  SELECT id
  INTO active_term_id
  FROM public.academic_terms
  WHERE is_active = true
  ORDER BY sort_key DESC
  LIMIT 1;

  RETURN active_term_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_active_academic_term(target_term_id UUID)
RETURNS public.academic_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_term public.academic_terms;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can set the active academic term';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.academic_terms WHERE id = target_term_id
  ) THEN
    RAISE EXCEPTION 'Academic term not found';
  END IF;

  UPDATE public.academic_terms
  SET
    is_active = (id = target_term_id),
    updated_at = now()
  WHERE is_active = true OR id = target_term_id;

  SELECT *
  INTO updated_term
  FROM public.academic_terms
  WHERE id = target_term_id;

  RETURN updated_term;
END;
$$;

ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view academic terms" ON public.academic_terms;
DROP POLICY IF EXISTS "Admins can insert academic terms" ON public.academic_terms;
DROP POLICY IF EXISTS "Admins can update academic terms" ON public.academic_terms;
DROP POLICY IF EXISTS "Admins can delete academic terms" ON public.academic_terms;

CREATE POLICY "Authenticated users can view academic terms"
ON public.academic_terms FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert academic terms"
ON public.academic_terms FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update academic terms"
ON public.academic_terms FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete academic terms"
ON public.academic_terms FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_terms TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_academic_term_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_academic_term(UUID) TO authenticated;

ALTER TABLE public.materials
ADD COLUMN IF NOT EXISTS academic_term_id UUID REFERENCES public.academic_terms(id) ON DELETE RESTRICT;

WITH baseline_term AS (
  SELECT id
  FROM public.academic_terms
  WHERE label = 'Semester 2 AY25/26'
  LIMIT 1
)
UPDATE public.materials m
SET academic_term_id = baseline_term.id
FROM baseline_term
WHERE m.academic_term_id IS NULL;

ALTER TABLE public.materials
ALTER COLUMN academic_term_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_materials_course_term
ON public.materials(course_id, academic_term_id);

CREATE INDEX IF NOT EXISTS idx_materials_term
ON public.materials(academic_term_id);

CREATE OR REPLACE FUNCTION public.assign_material_academic_term()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  active_term_id UUID;
BEGIN
  IF NEW.academic_term_id IS NULL THEN
    active_term_id := public.get_active_academic_term_id();

    IF active_term_id IS NULL THEN
      RAISE EXCEPTION 'No active academic term configured for material upload';
    END IF;

    NEW.academic_term_id := active_term_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_material_academic_term ON public.materials;

CREATE TRIGGER set_material_academic_term
BEFORE INSERT ON public.materials
FOR EACH ROW EXECUTE FUNCTION public.assign_material_academic_term();

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding extensions.vector(1536),
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

CREATE OR REPLACE FUNCTION public.list_accessible_courses()
RETURNS TABLE (
  id uuid,
  name text,
  code text,
  access_role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH viewer AS (
    SELECT p.id, p.role, p.user_id
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
  ),
  accessible AS (
    SELECT c.id, c.name, c.code, 'admin'::text AS access_role, 1 AS priority
    FROM public.courses c
    JOIN viewer v ON v.role = 'admin'

    UNION ALL

    SELECT c.id, c.name, c.code, 'lecturer'::text AS access_role, 2 AS priority
    FROM public.courses c
    JOIN viewer v ON v.role = 'lecturer' AND c.created_by = v.id

    UNION ALL

    SELECT c.id, c.name, c.code, 'student'::text AS access_role, 3 AS priority
    FROM public.courses c
    JOIN public.enrollments e ON e.course_id = c.id
    JOIN viewer v ON e.user_id = v.user_id
  )
  SELECT
    accessible.id,
    accessible.name,
    accessible.code,
    (ARRAY_AGG(accessible.access_role ORDER BY accessible.priority))[1] AS access_role
  FROM accessible
  GROUP BY accessible.id, accessible.name, accessible.code
  ORDER BY accessible.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_accessible_courses() TO authenticated;

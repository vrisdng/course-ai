UPDATE public.profiles
SET role = 'admin'
WHERE role::text = 'lecturer';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'lecturer'
  ) THEN
    ALTER TYPE public.user_role RENAME TO user_role_old;
    CREATE TYPE public.user_role AS ENUM ('student', 'admin');

    ALTER TABLE public.profiles
      ALTER COLUMN role DROP DEFAULT,
      ALTER COLUMN role TYPE public.user_role
      USING (
        CASE
          WHEN role::text = 'lecturer' THEN 'admin'
          ELSE role::text
        END
      )::public.user_role,
      ALTER COLUMN role SET DEFAULT 'student';

    DROP TYPE public.user_role_old;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_lecturer(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(check_user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_course_lecturer(check_user_id UUID, check_course_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(check_user_id);
$$;

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
    SELECT p.user_id, p.role
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
  ),
  accessible AS (
    SELECT c.id, c.name, c.code, 'admin'::text AS access_role, 1 AS priority
    FROM public.courses c
    JOIN viewer v ON v.role = 'admin'

    UNION ALL

    SELECT c.id, c.name, c.code, 'student'::text AS access_role, 2 AS priority
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

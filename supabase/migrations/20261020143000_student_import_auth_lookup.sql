-- Profile emails are editable; only Auth determines which account owns an email.
CREATE FUNCTION public.find_student_import_profile(p_email text)
RETURNS TABLE (user_id uuid, role public.user_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id, p.role
  FROM auth.users u
  JOIN public.profiles p ON p.user_id = u.id
  WHERE lower(u.email) = lower(btrim(p_email));
$$;
REVOKE ALL ON FUNCTION public.find_student_import_profile(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_student_import_profile(text) TO service_role;

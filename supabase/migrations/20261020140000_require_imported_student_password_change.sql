-- Read current server-owned state, rather than trusting possibly stale JWT metadata.
CREATE FUNCTION public.password_setup_complete()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND raw_app_meta_data->'must_change_password' = 'true'::jsonb
  );
$$;
REVOKE ALL ON FUNCTION public.password_setup_complete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_setup_complete() TO anon, authenticated, service_role;

CREATE FUNCTION public.require_password_setup()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.password_setup_complete() THEN
    RAISE EXCEPTION 'Choose a new password before accessing the app' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.require_password_setup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_password_setup() TO anon, authenticated, service_role;

-- Covers Data API RPCs too, including SECURITY DEFINER functions which bypass RLS.
DO $$
DECLARE existing_hook text;
BEGIN
  SELECT split_part(setting, '=', 2) INTO existing_hook
  FROM pg_roles, unnest(rolconfig) AS setting
  WHERE rolname = 'authenticator' AND setting LIKE 'pgrst.db_pre_request=%';
  IF coalesce(existing_hook, '') NOT IN ('', 'public.require_password_setup') THEN
    RAISE EXCEPTION 'Existing Data API pre-request hook % must be composed with require_password_setup', existing_hook;
  END IF;
END;
$$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.require_password_setup';
NOTIFY pgrst, 'reload config';

-- Restrictive policies also cover Storage and Realtime, outside the Data API.
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND c.relrowsecurity AND
      (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
  LOOP
    EXECUTE format('CREATE POLICY "Password setup required" ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.password_setup_complete())) WITH CHECK ((SELECT public.password_setup_complete()))',
      target.nspname, target.relname);
  END LOOP;
END;
$$;

-- Auth updates the hash and clears the restriction in the same transaction.
CREATE FUNCTION public.complete_imported_student_password_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.raw_app_meta_data->'must_change_password' = 'true'::jsonb
    AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
    AND coalesce(NEW.encrypted_password, '') <> ''
    AND extensions.crypt('iLoveStudying8!', NEW.encrypted_password) <> NEW.encrypted_password THEN
    NEW.raw_app_meta_data := jsonb_set(coalesce(NEW.raw_app_meta_data, '{}'::jsonb), '{must_change_password}', 'false'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_imported_student_password_change() FROM PUBLIC;
CREATE TRIGGER complete_imported_student_password_change
BEFORE UPDATE OF encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.complete_imported_student_password_change();

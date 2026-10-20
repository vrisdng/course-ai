-- Run against an isolated database after the password-setup migration.
BEGIN;
INSERT INTO auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
VALUES ('a0000000-0000-4000-8000-000000000001', 'password-setup-test@example.test',
  extensions.crypt('iLoveStudying8!', extensions.gen_salt('bf')),
  '{"must_change_password":true}', '{}');

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"must_change_password":false}}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT NOT public.password_setup_complete(), 'A stale/forged claim must not bypass the stored pending state';
  BEGIN
    PERFORM public.require_password_setup();
    RAISE EXCEPTION 'Pending accounts must not pass the Data API gate';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT count(*) = 0 FROM public.profiles), 'RLS must block profile access while pending';
  ASSERT (SELECT count(*) = 0 FROM storage.objects), 'RLS must block storage access while pending';
END $$;
RESET ROLE;

UPDATE auth.users SET raw_user_meta_data = '{"must_change_password":false}'
WHERE id = 'a0000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  ASSERT NOT public.password_setup_complete(), 'Editable user metadata must not unlock access';
END $$;

UPDATE auth.users SET encrypted_password = extensions.crypt('iLoveStudying8!', extensions.gen_salt('bf'))
WHERE id = 'a0000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  ASSERT NOT public.password_setup_complete(), 'Rehashing the initial password must not unlock access';
END $$;

UPDATE auth.users SET encrypted_password = extensions.crypt('NewPersonalPassword9!', extensions.gen_salt('bf'))
WHERE id = 'a0000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.password_setup_complete(), 'Successful password update must unlock access even with old JWT claims';
  PERFORM public.require_password_setup();
  ASSERT (SELECT count(*) > 0 FROM public.profiles), 'Normal RLS access must work after completion';
END $$;
RESET ROLE;

UPDATE auth.users SET encrypted_password = extensions.crypt('AnotherPassword9!', extensions.gen_salt('bf'))
WHERE id = 'a0000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  ASSERT public.password_setup_complete(), 'Later password changes must remain supported';
END $$;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.require_password_setup();
ROLLBACK;

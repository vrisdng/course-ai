-- Run after the telemetry migration; all fixtures and role changes roll back.
BEGIN;
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'telemetry-admin@example.test', '{}', '{}'),
  ('e1000000-0000-4000-8000-000000000002', 'telemetry-student@example.test', '{}', '{}');
UPDATE public.profiles SET role = 'admin' WHERE user_id = 'e1000000-0000-4000-8000-000000000001';
INSERT INTO public.courses (id, name) VALUES ('e1000000-0000-4000-8000-000000000003', 'Telemetry transaction test');

INSERT INTO public.query_events (user_id, course_id, query_text, request_id, outcome, error_code, latency_ms, prompt_tokens, completion_tokens) VALUES
  ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003', 'legacytelemetry', NULL, 'success', NULL, 200, NULL, NULL),
  ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003', 'successtelemetry', 'e1000000-0000-4000-8000-000000000004', 'success', NULL, 100, 10, 2),
  ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003', 'errortelemetry', 'e1000000-0000-4000-8000-000000000005', 'error', 'http_429', 30, NULL, NULL),
  ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003', 'aborttelemetry', 'e1000000-0000-4000-8000-000000000006', 'aborted', 'client_aborted', 50, NULL, NULL),
  ('e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003', 'persisttelemetry', 'e1000000-0000-4000-8000-000000000007', 'success', 'message_persistence_failed', 150, 20, 5);

DO $$ BEGIN
  BEGIN
    INSERT INTO public.query_events(user_id, query_text, request_id)
    VALUES ('e1000000-0000-4000-8000-000000000002', 'duplicate', 'e1000000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'Duplicate request IDs must be rejected';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.query_events(user_id, query_text, embedding_ms)
    VALUES ('e1000000-0000-4000-8000-000000000002', 'negative', -1);
    RAISE EXCEPTION 'Negative measurements must be rejected';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.query_events(user_id, query_text, outcome)
    VALUES ('e1000000-0000-4000-8000-000000000002', 'invalid', 'unknown');
    RAISE EXCEPTION 'Invalid outcomes must be rejected';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'get_course_active_student_count', 'get_course_top_questions',
      'get_course_keyword_stats', 'get_course_document_reference_stats'
    ) AND (pg_get_functiondef(p.oid) NOT LIKE '%outcome = ''success''%' OR pg_get_functiondef(p.oid) NOT LIKE '%error_code IS NULL%')
  ), 'Every analytics RPC overload must preserve completed-turn semantics';
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE health record; BEGIN
  SELECT * INTO STRICT health FROM public.analytics_course_chat_health WHERE course_id = 'e1000000-0000-4000-8000-000000000003';
  ASSERT health.request_count = 4 AND health.success_count = 2 AND health.error_count = 1 AND health.aborted_count = 1;
  ASSERT abs(health.error_rate - 1.0/3) < 0.000001, 'Aborts must not count as errors';
  ASSERT health.avg_latency_ms = 125 AND abs(health.p95_latency_ms - 147.5) < 0.000001;
  ASSERT health.prompt_tokens = 30 AND health.completion_tokens = 7 AND health.known_usage_count = 2;
  ASSERT health.persistence_error_count = 1;
  ASSERT (SELECT count(*) = 2 FROM public.get_course_top_questions('e1000000-0000-4000-8000-000000000003'::uuid, NULL::timestamptz, NULL::timestamptz, 10));
  ASSERT (SELECT count(*) = 2 FROM public.get_course_keyword_stats('e1000000-0000-4000-8000-000000000003'::uuid, NULL::timestamptz, NULL::timestamptz, 20));
  ASSERT public.get_course_active_student_count('e1000000-0000-4000-8000-000000000003'::uuid, NULL::timestamptz, NULL::timestamptz) = 1;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) = 0 FROM public.analytics_course_chat_health), 'Students must not read chat health';
  ASSERT (SELECT count(*) = 0 FROM public.query_events), 'Students must not read raw events';
  BEGIN
    INSERT INTO public.query_events(user_id, query_text) VALUES ('e1000000-0000-4000-8000-000000000002', 'forged');
    RAISE EXCEPTION 'Students must not write telemetry';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.analytics_course_chat_health;
    RAISE EXCEPTION 'Anonymous users must not read chat health';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;

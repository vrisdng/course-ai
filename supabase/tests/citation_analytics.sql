-- Run after migration 20261024120000; all fixtures roll back.
-- Covers the citation-based analytics RPCs: cited materials, cited places,
-- questions at chosen places, question buckets and the admin chunk search.
BEGIN;
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('ca000000-0000-4000-8000-000000000001', 'citation-admin@example.test', '{}', '{}'),
  ('ca000000-0000-4000-8000-000000000002', 'citation-student-a@example.test', '{}', '{}'),
  ('ca000000-0000-4000-8000-000000000003', 'citation-student-b@example.test', '{}', '{}');
UPDATE public.profiles SET role = 'admin' WHERE user_id = 'ca000000-0000-4000-8000-000000000001';

INSERT INTO public.academic_terms (id, academic_year_start, academic_year_end, semester, label)
VALUES ('ca000000-0000-4000-8000-000000000010', 2091, 2092, 1, 'AY2091/92 Sem 1 (citation test)');
INSERT INTO public.courses (id, name) VALUES
  ('ca000000-0000-4000-8000-000000000020', 'Citation analytics test'),
  ('ca000000-0000-4000-8000-000000000021', 'Other course');

-- A PDF and a video in the course, and a PDF in another course.
INSERT INTO public.materials (id, course_id, academic_term_id, file_name, file_path, file_type) VALUES
  ('ca000000-0000-4000-8000-000000000030', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000010', 'Recursion.pdf', 'test/recursion.pdf', 'pdf'),
  ('ca000000-0000-4000-8000-000000000031', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000010', 'Lecture 3.mp4', 'test/lecture3.mp4', 'video'),
  ('ca000000-0000-4000-8000-000000000032', 'ca000000-0000-4000-8000-000000000021', 'ca000000-0000-4000-8000-000000000010', 'Elsewhere.pdf', 'test/elsewhere.pdf', 'pdf');

-- Chunks: the query vector below is e1, so chunk 40 (e1) is an exact match,
-- chunk 41 (e1+e2) is a partial match and chunk 42 (e2) doesn't match.
-- Chunk 43 is an exact match in the other course.
CREATE TEMP TABLE test_vectors AS
SELECT
  ('[1' || repeat(',0', 3071) || ']')::extensions.vector AS e1,
  ('[1,1' || repeat(',0', 3070) || ']')::extensions.vector AS e12,
  ('[0,1' || repeat(',0', 3070) || ']')::extensions.vector AS e2;
GRANT SELECT ON test_vectors TO authenticated;
INSERT INTO public.chunks (id, material_id, chunk_index, chunk_text, page_number, start_ms, end_ms, embedding_openai)
SELECT 'ca000000-0000-4000-8000-000000000040'::uuid, 'ca000000-0000-4000-8000-000000000030'::uuid, 0, 'Recursion: a function calling itself.', 3, NULL::bigint, NULL::bigint, e1 FROM test_vectors
UNION ALL SELECT 'ca000000-0000-4000-8000-000000000041', 'ca000000-0000-4000-8000-000000000031', 0, 'Today we trace a recursive call stack.', NULL, 60000, 90000, e12 FROM test_vectors
UNION ALL SELECT 'ca000000-0000-4000-8000-000000000042', 'ca000000-0000-4000-8000-000000000030', 1, 'Sorting arrays.', 4, NULL, NULL, e2 FROM test_vectors
UNION ALL SELECT 'ca000000-0000-4000-8000-000000000043', 'ca000000-0000-4000-8000-000000000032', 0, 'Recursion elsewhere.', 1, NULL, NULL, e1 FROM test_vectors;

INSERT INTO public.conversations (id, user_id, course_id) VALUES
  ('ca000000-0000-4000-8000-000000000050', 'ca000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000020'),
  ('ca000000-0000-4000-8000-000000000051', 'ca000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000020');
INSERT INTO public.messages (id, conversation_id, role, content) VALUES
  ('ca000000-0000-4000-8000-000000000061', 'ca000000-0000-4000-8000-000000000050', 'assistant', 'Answer 1'),
  ('ca000000-0000-4000-8000-000000000062', 'ca000000-0000-4000-8000-000000000050', 'assistant', 'Answer 2'),
  ('ca000000-0000-4000-8000-000000000063', 'ca000000-0000-4000-8000-000000000051', 'assistant', 'Answer 3'),
  ('ca000000-0000-4000-8000-000000000064', 'ca000000-0000-4000-8000-000000000051', 'assistant', 'Answer 4 (failed turn)'),
  ('ca000000-0000-4000-8000-000000000065', 'ca000000-0000-4000-8000-000000000051', 'assistant', 'Answer 5 (old)'),
  ('ca000000-0000-4000-8000-000000000066', 'ca000000-0000-4000-8000-000000000051', 'assistant', 'Hello!');

-- q1, q2 (student A) and q3 (student B) count; q4 failed; q5 is outside the
-- window; q6 is a greeting with no citations.
INSERT INTO public.query_events (id, user_id, course_id, assistant_message_id, query_text, query_category, outcome, error_code, created_at, ai_category, ai_category_confidence, ai_is_study_question, ai_answered_from_materials, ai_labeled_at, ai_label_model) VALUES
  ('ca000000-0000-4000-8000-000000000071', 'ca000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000061', 'what is recursion', 'definition_concept', 'success', NULL, '2091-09-10T10:00:00Z', 'definition_concept', 0.9, true, true, now(), 'gpt-6-luna'),
  ('ca000000-0000-4000-8000-000000000072', 'ca000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000062', 'how do i trace a recursive call', 'how_to_process', 'success', NULL, '2091-09-11T10:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL),
  ('ca000000-0000-4000-8000-000000000073', 'ca000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000063', 'where is the base case in lecture 3', 'factual_lookup', 'success', NULL, '2091-09-12T10:00:00Z', 'factual_lookup', 0.7, true, true, now(), 'gpt-6-luna'),
  ('ca000000-0000-4000-8000-000000000074', 'ca000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000064', 'failed recursion question', 'other', 'error', 'http_429', '2091-09-12T11:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL),
  ('ca000000-0000-4000-8000-000000000075', 'ca000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000065', 'old recursion question', 'other', 'success', NULL, '2091-01-01T10:00:00Z', NULL, NULL, NULL, NULL, NULL, NULL),
  ('ca000000-0000-4000-8000-000000000076', 'ca000000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000020', 'ca000000-0000-4000-8000-000000000066', 'hi', 'other', 'success', NULL, '2091-09-13T10:00:00Z', 'other', 0.95, false, false, now(), 'gpt-6-luna');

-- Citations snapshot material/page/time. Citation 82 has lost its chunk (the
-- material was re-processed) and must still count.
INSERT INTO public.citations (id, message_id, chunk_id, material_id, page_number, start_ms, end_ms) VALUES
  ('ca000000-0000-4000-8000-000000000081', 'ca000000-0000-4000-8000-000000000061', 'ca000000-0000-4000-8000-000000000040', 'ca000000-0000-4000-8000-000000000030', 3, NULL, NULL),
  ('ca000000-0000-4000-8000-000000000082', 'ca000000-0000-4000-8000-000000000062', NULL, 'ca000000-0000-4000-8000-000000000030', 3, NULL, NULL),
  ('ca000000-0000-4000-8000-000000000083', 'ca000000-0000-4000-8000-000000000062', 'ca000000-0000-4000-8000-000000000041', 'ca000000-0000-4000-8000-000000000031', NULL, 65000, 80000),
  ('ca000000-0000-4000-8000-000000000084', 'ca000000-0000-4000-8000-000000000062', 'ca000000-0000-4000-8000-000000000040', 'ca000000-0000-4000-8000-000000000030', 3, NULL, NULL),
  ('ca000000-0000-4000-8000-000000000085', 'ca000000-0000-4000-8000-000000000063', 'ca000000-0000-4000-8000-000000000041', 'ca000000-0000-4000-8000-000000000031', NULL, 400000, 420000),
  ('ca000000-0000-4000-8000-000000000086', 'ca000000-0000-4000-8000-000000000064', 'ca000000-0000-4000-8000-000000000040', 'ca000000-0000-4000-8000-000000000030', 3, NULL, NULL),
  ('ca000000-0000-4000-8000-000000000087', 'ca000000-0000-4000-8000-000000000065', 'ca000000-0000-4000-8000-000000000040', 'ca000000-0000-4000-8000-000000000030', 3, NULL, NULL);

-- ── As the admin ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"ca000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  course constant uuid := 'ca000000-0000-4000-8000-000000000020';
  pdf constant uuid := 'ca000000-0000-4000-8000-000000000030';
  video constant uuid := 'ca000000-0000-4000-8000-000000000031';
  window_start constant timestamptz := '2091-09-01T00:00:00Z';
  window_end constant timestamptz := '2091-09-30T00:00:00Z';
  row record;
  result jsonb;
BEGIN
  -- Cited materials: distinct counted questions per material.
  SELECT * INTO STRICT row FROM public.get_course_cited_materials(course, window_start, window_end) WHERE material_id = pdf;
  ASSERT row.question_count = 2 AND row.student_count = 1 AND row.citation_count = 3,
    format('PDF: expected 2 questions, 1 student, 3 citations, got %s', row);
  ASSERT row.file_name = 'Recursion.pdf' AND row.file_type = 'pdf';
  SELECT * INTO STRICT row FROM public.get_course_cited_materials(course, window_start, window_end) WHERE material_id = video;
  ASSERT row.question_count = 2 AND row.student_count = 2, format('Video: got %s', row);
  ASSERT (SELECT count(*) = 2 FROM public.get_course_cited_materials(course, window_start, window_end)),
    'Only cited materials of this course are listed';
  ASSERT (SELECT material_id = pdf FROM public.get_course_cited_materials(course, NULL, NULL) LIMIT 1),
    'Without a window the old question is included and the PDF ranks first';
  ASSERT (SELECT question_count = 3 FROM public.get_course_cited_materials(course, NULL, NULL) WHERE material_id = pdf);

  -- Cited places: PDF pages, and video time buckets (5 minutes by default).
  SELECT * INTO STRICT row FROM public.get_course_cited_places(course, window_start, window_end) WHERE material_id = pdf;
  ASSERT row.page_number = 3 AND row.start_ms IS NULL AND row.question_count = 2, format('PDF page: got %s', row);
  SELECT * INTO STRICT row FROM public.get_course_cited_places(course, window_start, window_end) WHERE material_id = video AND start_ms = 0;
  ASSERT row.end_ms = 300000 AND row.page_number IS NULL AND row.question_count = 1, format('Video 0-5 min: got %s', row);
  SELECT * INTO STRICT row FROM public.get_course_cited_places(course, window_start, window_end) WHERE material_id = video AND start_ms = 300000;
  ASSERT row.question_count = 1;
  ASSERT (SELECT count(*) = 1 FROM public.get_course_cited_places(course, window_start, window_end, video, 600000)),
    'One material, 10-minute buckets: both video citations share a bucket';
  ASSERT (SELECT count(*) = 1 FROM public.get_course_cited_places(course, window_start, window_end, NULL, 300000, 1)),
    'The limit applies';

  -- Questions at chosen places.
  result := public.get_course_questions_at_places(course, window_start, window_end,
    jsonb_build_array(jsonb_build_object('material_id', pdf, 'page_number', 3)));
  ASSERT (result->>'question_count')::int = 2 AND (result->>'student_count')::int = 1, format('PDF page 3: %s', result);
  ASSERT jsonb_array_length(result->'questions') = 2;
  ASSERT result->'questions'->0->>'query_text' = 'how do i trace a recursive call', 'Newest question first';
  ASSERT result->'questions'->0->>'category' = 'how_to_process', 'Unlabelled questions fall back to the rule category';

  result := public.get_course_questions_at_places(course, window_start, window_end,
    jsonb_build_array(jsonb_build_object('material_id', video, 'start_ms', 60000, 'end_ms', 120000)));
  ASSERT (result->>'question_count')::int = 1, format('Video 1-2 min overlaps the 65-80 s citation only: %s', result);

  result := public.get_course_questions_at_places(course, window_start, window_end, jsonb_build_array(
    jsonb_build_object('material_id', pdf, 'page_number', 3),
    jsonb_build_object('material_id', video, 'start_ms', 0, 'end_ms', 600000)));
  ASSERT (result->>'question_count')::int = 3 AND (result->>'student_count')::int = 2,
    format('Two places count each question once: %s', result);

  result := public.get_course_questions_at_places(course, window_start, window_end,
    jsonb_build_array(jsonb_build_object('material_id', pdf, 'page_number', 4)));
  ASSERT (result->>'question_count')::int = 0 AND jsonb_array_length(result->'questions') = 0, 'Uncited page';

  result := public.get_course_questions_at_places(course, window_start, window_end, '[]'::jsonb);
  ASSERT (result->>'question_count')::int = 0, 'No places, no questions';

  result := public.get_course_questions_at_places(course, window_start, window_end,
    jsonb_build_array(jsonb_build_object('material_id', pdf, 'page_number', 3)), 1);
  ASSERT (result->>'question_count')::int = 2 AND jsonb_array_length(result->'questions') = 1,
    'The question list is capped but the count is exact';

  -- Question buckets: AI label when present, otherwise the rule category.
  SELECT * INTO STRICT row FROM public.get_course_question_buckets(course, window_start, window_end) WHERE category = 'definition_concept';
  ASSERT row.question_count = 1 AND row.labeled_count = 1 AND row.study_question_count = 1 AND row.answered_from_materials_count = 1;
  SELECT * INTO STRICT row FROM public.get_course_question_buckets(course, window_start, window_end) WHERE category = 'how_to_process';
  ASSERT row.question_count = 1 AND row.labeled_count = 0, 'Unlabelled question uses the rule category';
  SELECT * INTO STRICT row FROM public.get_course_question_buckets(course, window_start, window_end) WHERE category = 'other';
  ASSERT row.question_count = 1 AND row.study_question_count = 0, 'The greeting is not a study question';
  ASSERT (SELECT sum(question_count) = 4 FROM public.get_course_question_buckets(course, window_start, window_end)),
    'Failed and out-of-window questions are excluded';

  -- Admin chunk search: whole course, any term, course materials only.
  ASSERT (SELECT count(*) = 2 FROM public.match_course_chunks_for_analytics(
    (SELECT e1 FROM test_vectors), course, 0.5, 10)), 'e1 matches chunk 40 and 41 (cos 0.71), not chunk 42 or the other course';
  SELECT * INTO STRICT row FROM public.match_course_chunks_for_analytics((SELECT e1 FROM test_vectors), course, 0.5, 1);
  ASSERT row.chunk_id = 'ca000000-0000-4000-8000-000000000040' AND abs(row.similarity - 1) < 0.0001
    AND row.page_number = 3 AND row.file_name = 'Recursion.pdf' AND row.file_type = 'pdf', format('Best match: %s', row);
END $$;
RESET ROLE;

-- ── As a student ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"ca000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE course constant uuid := 'ca000000-0000-4000-8000-000000000020';
BEGIN
  BEGIN PERFORM public.get_course_cited_materials(course, NULL, NULL);
    RAISE EXCEPTION 'Students must not read cited materials';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_course_cited_places(course, NULL, NULL);
    RAISE EXCEPTION 'Students must not read cited places';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_course_questions_at_places(course, NULL, NULL, '[]'::jsonb);
    RAISE EXCEPTION 'Students must not read questions at places';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_course_question_buckets(course, NULL, NULL);
    RAISE EXCEPTION 'Students must not read question buckets';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.match_course_chunks_for_analytics((SELECT e1 FROM test_vectors), course, 0.5, 10);
    RAISE EXCEPTION 'Students must not use the admin chunk search';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

ROLLBACK;

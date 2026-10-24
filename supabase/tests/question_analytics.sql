-- Run after migrations 20261025090000 and 20261025120000; all fixtures roll back.
-- Covers the question-first analytics RPCs: the overview numbers, the
-- filterable question list, one question's detail and the common terms.
BEGIN;
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
  ('cb000000-0000-4000-8000-000000000001', 'question-admin@example.test', '{}', '{}'),
  ('cb000000-0000-4000-8000-000000000002', 'question-student-a@example.test', '{}', '{}'),
  ('cb000000-0000-4000-8000-000000000003', 'question-student-b@example.test', '{}', '{}');
UPDATE public.profiles SET role = 'admin' WHERE user_id = 'cb000000-0000-4000-8000-000000000001';

INSERT INTO public.academic_terms (id, academic_year_start, academic_year_end, semester, label)
VALUES ('cb000000-0000-4000-8000-000000000010', 2093, 2094, 1, 'AY2093/94 Sem 1 (question test)');
INSERT INTO public.courses (id, name) VALUES
  ('cb000000-0000-4000-8000-000000000020', 'Question analytics test'),
  ('cb000000-0000-4000-8000-000000000021', 'Other course');

INSERT INTO public.materials (id, course_id, academic_term_id, file_name, file_path, file_type) VALUES
  ('cb000000-0000-4000-8000-000000000030', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000010', 'Hashing.pdf', 'test/hashing.pdf', 'pdf'),
  ('cb000000-0000-4000-8000-000000000031', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000010', 'Lecture 4.mp4', 'test/lecture4.mp4', 'video'),
  ('cb000000-0000-4000-8000-000000000032', 'cb000000-0000-4000-8000-000000000021', 'cb000000-0000-4000-8000-000000000010', 'Elsewhere.pdf', 'test/elsewhere.pdf', 'pdf'),
  -- A second upload of the same file: its citations merge with the first's.
  ('cb000000-0000-4000-8000-000000000033', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000010', 'Hashing.pdf', 'test/hashing-copy.pdf', 'pdf');

-- The course vocabulary. "explain" is in the materials but is a filler
-- word; "midterm" and "red" only appear in the other course.
INSERT INTO public.chunks (id, material_id, chunk_index, chunk_text, page_number, start_ms, end_ms) VALUES
  ('cb000000-0000-4000-8000-000000000040', 'cb000000-0000-4000-8000-000000000030', 0, 'A hash table stores keys. A collision is resolved by linear probing. Let me explain.', 2, NULL, NULL),
  ('cb000000-0000-4000-8000-000000000041', 'cb000000-0000-4000-8000-000000000031', 0, 'Resizing the table, and binary search trees.', NULL, 60000, 90000),
  ('cb000000-0000-4000-8000-000000000042', 'cb000000-0000-4000-8000-000000000032', 0, 'The midterm covers red things.', 1, NULL, NULL);

INSERT INTO public.conversations (id, user_id, course_id) VALUES
  ('cb000000-0000-4000-8000-000000000050', 'cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000020'),
  ('cb000000-0000-4000-8000-000000000051', 'cb000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000020');
INSERT INTO public.messages (id, conversation_id, role, content) VALUES
  ('cb000000-0000-4000-8000-000000000061', 'cb000000-0000-4000-8000-000000000050', 'assistant', 'Answer 1'),
  ('cb000000-0000-4000-8000-000000000062', 'cb000000-0000-4000-8000-000000000051', 'assistant', 'Answer 2'),
  ('cb000000-0000-4000-8000-000000000063', 'cb000000-0000-4000-8000-000000000051', 'assistant', 'Answer 3'),
  ('cb000000-0000-4000-8000-000000000064', 'cb000000-0000-4000-8000-000000000050', 'assistant', 'Answer 4'),
  ('cb000000-0000-4000-8000-000000000065', 'cb000000-0000-4000-8000-000000000050', 'assistant', 'Answer 5'),
  ('cb000000-0000-4000-8000-000000000066', 'cb000000-0000-4000-8000-000000000050', 'assistant', 'Answer 6 (failed)'),
  ('cb000000-0000-4000-8000-000000000067', 'cb000000-0000-4000-8000-000000000050', 'assistant', 'Answer 7 (old)');

-- Counted, in the window:
--   q1 (A) labelled, answered from materials; cites the PDF.
--   q2 (B) unlabelled; cites the PDF and the video. Rule category how_to_process.
--   q3 (B) labelled, NOT answered from materials although it cites the video: a gap.
--   q4 (A) labelled logistics, not a study question, uncited: not a gap.
--   q5 (A) unlabelled and uncited: a gap by the fallback rule.
-- Not counted: q6 failed, q7 outside the window.
INSERT INTO public.query_events (id, user_id, course_id, assistant_message_id, query_text, query_category, citation_count, outcome, error_code, created_at, ai_category, ai_is_study_question, ai_answered_from_materials, ai_labeled_at) VALUES
  ('cb000000-0000-4000-8000-000000000071', 'cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000061', 'What is a hash table?', 'definition_concept', 1, 'success', NULL, '2093-09-10T10:00:00Z', 'definition_concept', true, true, now()),
  ('cb000000-0000-4000-8000-000000000072', 'cb000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000062', 'How does linear probing handle a collision in a hash table', 'how_to_process', 2, 'success', NULL, '2093-09-11T10:00:00Z', NULL, NULL, NULL, NULL),
  ('cb000000-0000-4000-8000-000000000073', 'cb000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000063', 'Explain hash tables resizing', 'other', 1, 'success', NULL, '2093-09-12T10:00:00Z', 'how_to_process', true, false, now()),
  ('cb000000-0000-4000-8000-000000000074', 'cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000064', 'When is the midterm?', 'other', 0, 'success', NULL, '2093-09-13T10:00:00Z', 'course_logistics', false, false, now()),
  ('cb000000-0000-4000-8000-000000000075', 'cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000065', 'What is a red black tree', 'definition_concept', 0, 'success', NULL, '2093-09-14T10:00:00Z', NULL, NULL, NULL, NULL),
  ('cb000000-0000-4000-8000-000000000076', 'cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000066', 'hash table failed', 'other', 0, 'error', 'http_429', '2093-09-14T11:00:00Z', NULL, NULL, NULL, NULL),
  ('cb000000-0000-4000-8000-000000000077', 'cb000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000020', 'cb000000-0000-4000-8000-000000000067', 'old hash table question', 'other', 1, 'success', NULL, '2093-01-01T10:00:00Z', NULL, NULL, NULL, NULL);

INSERT INTO public.citations (id, message_id, material_id, page_number, start_ms, end_ms) VALUES
  ('cb000000-0000-4000-8000-000000000081', 'cb000000-0000-4000-8000-000000000061', 'cb000000-0000-4000-8000-000000000030', 2, NULL, NULL),
  ('cb000000-0000-4000-8000-000000000088', 'cb000000-0000-4000-8000-000000000061', 'cb000000-0000-4000-8000-000000000033', 2, NULL, NULL),
  ('cb000000-0000-4000-8000-000000000082', 'cb000000-0000-4000-8000-000000000062', 'cb000000-0000-4000-8000-000000000030', 2, NULL, NULL),
  -- A duplicate citation of the same page: listed once as a source.
  ('cb000000-0000-4000-8000-000000000083', 'cb000000-0000-4000-8000-000000000062', 'cb000000-0000-4000-8000-000000000030', 2, NULL, NULL),
  ('cb000000-0000-4000-8000-000000000084', 'cb000000-0000-4000-8000-000000000062', 'cb000000-0000-4000-8000-000000000031', NULL, 65000, 80000),
  ('cb000000-0000-4000-8000-000000000085', 'cb000000-0000-4000-8000-000000000063', 'cb000000-0000-4000-8000-000000000031', NULL, 400000, 420000),
  ('cb000000-0000-4000-8000-000000000087', 'cb000000-0000-4000-8000-000000000067', 'cb000000-0000-4000-8000-000000000030', 2, NULL, NULL);

-- ── As the admin ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"cb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  course constant uuid := 'cb000000-0000-4000-8000-000000000020';
  pdf constant uuid := 'cb000000-0000-4000-8000-000000000030';
  video constant uuid := 'cb000000-0000-4000-8000-000000000031';
  s constant timestamptz := '2093-09-01T00:00:00Z';
  e constant timestamptz := '2093-09-30T00:00:00Z';
  row record;
  result jsonb;
  texts text[];
BEGIN
  -- Overview.
  SELECT * INTO STRICT row FROM public.get_course_question_overview(course, s, e);
  ASSERT row.question_count = 5 AND row.student_count = 2, format('Overview counts: %s', row);
  ASSERT row.labeled_count = 3 AND row.answered_from_materials_count = 1, format('Overview labels: %s', row);
  ASSERT row.needs_attention_count = 2, format('Gaps are q3 and q5: %s', row);
  ASSERT row.non_study_count = 1, format('q4 is logistics: %s', row);
  ASSERT row.cited_question_count = 3 AND row.document_question_count = 2 AND row.video_question_count = 2,
    format('Source split: %s', row);

  -- Question list, no filters: newest first, sources deduplicated, no student ids.
  result := public.get_course_questions(course, s, e);
  ASSERT (result->>'total_count')::int = 5 AND (result->>'student_count')::int = 2, format('All: %s', result);
  ASSERT result->'questions'->0->>'query_text' = 'What is a red black tree', 'Newest first';
  ASSERT (result->'questions'->0->>'needs_attention')::boolean, 'Uncited, unlabelled question is a gap';
  ASSERT result->'questions'->0->>'category' = 'definition_concept';
  ASSERT NOT (result->'questions'->0 ? 'user_id'), 'Student ids are never returned';
  SELECT q INTO result FROM jsonb_array_elements((public.get_course_questions(course, s, e))->'questions') q
    WHERE q->>'id' = 'cb000000-0000-4000-8000-000000000072';
  ASSERT jsonb_array_length(result->'sources') = 2, format('q2 cites page 2 twice and the video once: %s', result);
  ASSERT result->'sources'->0->>'file_name' = 'Hashing.pdf' AND (result->'sources'->0->>'page_number')::int = 2;
  ASSERT result->'sources'->1->>'file_type' = 'video' AND (result->'sources'->1->>'start_ms')::int = 65000;
  ASSERT result->>'category' = 'how_to_process' AND (result->>'needs_attention')::boolean = false;
  ASSERT result->'answered_from_materials' = 'null'::jsonb, 'Unlabelled answers are unknown';

  -- Paging: the total stays exact.
  result := public.get_course_questions(course, s, e, in_limit => 2, in_offset => 1);
  ASSERT (result->>'total_count')::int = 5 AND jsonb_array_length(result->'questions') = 2;
  ASSERT result->'questions'->0->>'query_text' = 'When is the midterm?', 'Offset skips the newest';

  -- Topic text: stems and phrases, case-insensitive.
  result := public.get_course_questions(course, s, e, in_topic_text => 'hash table');
  ASSERT (result->>'total_count')::int = 3, format('"hash table" matches q1-q3 (q3 says "tables"): %s', result);
  result := public.get_course_questions(course, s, e, in_topic_text => 'Probing');
  ASSERT (result->>'total_count')::int = 1;
  result := public.get_course_questions(course, s, e, in_topic_text => '50%_');
  ASSERT (result->>'total_count')::int = 0, 'LIKE wildcards in the topic are literal';

  -- Topic places widen the topic: text OR an answer citing a matching place.
  result := public.get_course_questions(course, s, e, in_topic_text => 'zzz',
    in_topic_places => jsonb_build_array(jsonb_build_object('material_id', video, 'start_ms', 0, 'end_ms', 300000)));
  ASSERT (result->>'total_count')::int = 1 AND result->'questions'->0->>'id' = 'cb000000-0000-4000-8000-000000000072',
    format('Only q2 cites the first five minutes: %s', result);
  result := public.get_course_questions(course, s, e, in_topic_text => 'red black',
    in_topic_places => jsonb_build_array(jsonb_build_object('material_id', video, 'start_ms', 0, 'end_ms', 300000)));
  ASSERT (result->>'total_count')::int = 2, 'q5 by text, q2 by place';

  -- Required places (a clicked page or video moment).
  result := public.get_course_questions(course, s, e,
    in_places => jsonb_build_array(jsonb_build_object('material_id', pdf, 'page_number', 2)));
  ASSERT (result->>'total_count')::int = 2, format('Page 2: q1 and q2: %s', result);

  -- File, source kind, type and gaps.
  result := public.get_course_questions(course, s, e, in_material_ids => ARRAY[video]);
  ASSERT (result->>'total_count')::int = 2;
  result := public.get_course_questions(course, s, e, in_material_ids => ARRAY['cb000000-0000-4000-8000-000000000033'::uuid, pdf]);
  ASSERT (result->>'total_count')::int = 2, 'Either copy of Hashing.pdf';
  SELECT q INTO result FROM jsonb_array_elements((public.get_course_questions(course, s, e))->'questions') q
    WHERE q->>'id' = 'cb000000-0000-4000-8000-000000000071';
  ASSERT jsonb_array_length(result->'sources') = 1, format('Page 2 of both copies is one source: %s', result);

  -- Cited files: copies merged, each question counted once.
  SELECT * INTO STRICT row FROM public.get_course_cited_files(course, s, e) WHERE file_name = 'Hashing.pdf';
  ASSERT row.question_count = 2 AND row.student_count = 2 AND cardinality(row.material_ids) = 2,
    format('Hashing.pdf across both copies: %s', row);
  ASSERT (SELECT count(*) = 2 FROM public.get_course_cited_files(course, s, e)), 'Hashing.pdf and Lecture 4.mp4';

  -- Question types: study only drops q4's course_logistics bucket.
  ASSERT (SELECT sum(question_count) = 5 FROM public.get_course_question_buckets(course, s, e));
  ASSERT (SELECT sum(question_count) = 4 FROM public.get_course_question_buckets(course, s, e, true));
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_course_question_buckets(course, s, e, true) WHERE category = 'course_logistics');

  -- Study questions only: drops q4, the logistics question.
  result := public.get_course_questions(course, s, e, in_study_only => true);
  ASSERT (result->>'total_count')::int = 4, format('Study only: %s', result);

  -- One question in full: its answer, sources and related questions.
  result := public.get_course_question_detail(course, 'cb000000-0000-4000-8000-000000000072', s, e);
  ASSERT result->>'query_text' = 'How does linear probing handle a collision in a hash table', format('Detail: %s', result);
  ASSERT result->>'answer_text' = 'Answer 2';
  ASSERT jsonb_array_length(result->'sources') = 2;
  ASSERT (result->>'related_count')::int = 1 AND result->'related'->0->>'id' = 'cb000000-0000-4000-8000-000000000071',
    format('q1 cites the same page (in either copy); the old question is outside the window: %s', result);
  ASSERT NOT (result ? 'user_id');
  result := public.get_course_question_detail(course, 'cb000000-0000-4000-8000-000000000075', s, e);
  ASSERT (result->>'related_count')::int = 0 AND jsonb_array_length(result->'sources') = 0;
  ASSERT public.get_course_question_detail('cb000000-0000-4000-8000-000000000021', 'cb000000-0000-4000-8000-000000000072', s, e) IS NULL,
    'A question from another course is not found';
  result := public.get_course_questions(course, s, e, in_source_kind => 'video');
  ASSERT (result->>'total_count')::int = 2;
  result := public.get_course_questions(course, s, e, in_source_kind => 'document');
  ASSERT (result->>'total_count')::int = 2;
  result := public.get_course_questions(course, s, e, in_category => 'how_to_process');
  ASSERT (result->>'total_count')::int = 2, 'q2 by rule category, q3 by AI label';
  result := public.get_course_questions(course, s, e, in_needs_attention => true);
  ASSERT (result->>'total_count')::int = 2;
  SELECT array_agg(q->>'query_text' ORDER BY q->>'query_text') INTO texts FROM jsonb_array_elements(result->'questions') q;
  ASSERT texts = ARRAY['Explain hash tables resizing', 'What is a red black tree'], format('Gaps: %s', texts);
  result := public.get_course_questions(course, s, e, in_needs_attention => true, in_source_kind => 'video');
  ASSERT (result->>'total_count')::int = 1, 'Filters combine';

  BEGIN
    PERFORM public.get_course_questions(course, s, e, in_source_kind => 'slides');
    ASSERT false, 'Unknown source kind is rejected';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Terms: words and two-word phrases from study questions, in the course
  -- vocabulary, filler words dropped.
  SELECT * INTO STRICT row FROM public.get_course_question_terms(course, s, e) WHERE term = 'hash table';
  ASSERT row.word_count = 2 AND row.question_count = 3 AND row.student_count = 2, format('hash table: %s', row);
  ASSERT (SELECT question_count = 3 FROM public.get_course_question_terms(course, s, e) WHERE term_key = 'hash');
  ASSERT NOT EXISTS (SELECT 1 FROM public.get_course_question_terms(course, s, e) WHERE question_count < 2),
    'By default a term needs two questions';
  SELECT array_agg(term ORDER BY term) INTO texts FROM public.get_course_question_terms(course, s, e, 1);
  ASSERT 'probing' = ANY (texts) AND 'tree' = ANY (texts) AND 'linear probing' = ANY (texts), format('Terms: %s', texts);
  ASSERT NOT ('red' = ANY (texts)) AND NOT ('midterm' = ANY (texts)), 'Words outside this course''s materials are dropped';
  ASSERT NOT ('explain' = ANY (texts)) AND NOT ('what' = ANY (texts)), 'Filler and stop words are dropped';
  ASSERT NOT ('old' = ANY (texts)) AND NOT ('failed' = ANY (texts)), 'Only counted questions in the window';
  ASSERT (SELECT term = 'hash table' FROM public.get_course_question_terms(course, s, e, 1) WHERE term_key = 'hash tabl'),
    'A term shows the wording students used most';
  ASSERT (SELECT count(*) = 1 FROM public.get_course_question_terms(course, s, e, 1, 1)), 'The limit applies';
END $$;

-- ── As a student ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"cb000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
DO $$
DECLARE
  course constant uuid := 'cb000000-0000-4000-8000-000000000020';
BEGIN
  BEGIN
    PERFORM public.get_course_question_overview(course, NULL, NULL);
    ASSERT false, 'Students cannot read the overview';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_course_questions(course, NULL, NULL);
    ASSERT false, 'Students cannot read questions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_course_question_terms(course, NULL, NULL);
    ASSERT false, 'Students cannot read terms';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_course_cited_files(course, NULL, NULL);
    ASSERT false, 'Students cannot read cited files';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_course_question_detail(course, 'cb000000-0000-4000-8000-000000000071', NULL, NULL);
    ASSERT false, 'Students cannot read question details';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.analytics_counted_questions(course, NULL, NULL);
    ASSERT false, 'The internal helper is not callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
SELECT 'question_analytics: all assertions passed' AS result;

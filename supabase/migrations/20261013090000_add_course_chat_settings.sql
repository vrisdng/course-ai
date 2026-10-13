-- Per-course chat and retrieval settings, tuned by admins from the dashboard
-- and read by rag-chat on every request. Defaults and ranges match
-- supabase/functions/_shared/chatSettings.ts (DEFAULT_CHAT_SETTINGS and
-- CHAT_SETTING_RANGES); keep them in step.

CREATE TABLE IF NOT EXISTS public.course_chat_settings (
  course_id uuid PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,

  -- Retrieval
  match_threshold double precision NOT NULL DEFAULT 0.2 CHECK (match_threshold BETWEEN 0 AND 1),
  summary_match_threshold double precision NOT NULL DEFAULT 0.15 CHECK (summary_match_threshold BETWEEN 0 AND 1),
  match_count integer NOT NULL DEFAULT 18 CHECK (match_count BETWEEN 1 AND 100),
  summary_match_count integer NOT NULL DEFAULT 30 CHECK (summary_match_count BETWEEN 1 AND 100),
  filtered_match_count integer NOT NULL DEFAULT 24 CHECK (filtered_match_count BETWEEN 1 AND 100),
  relevance_floor double precision NOT NULL DEFAULT 0.2 CHECK (relevance_floor BETWEEN 0 AND 1),
  summary_relevance_floor double precision NOT NULL DEFAULT 0.15 CHECK (summary_relevance_floor BETWEEN 0 AND 1),
  final_count integer NOT NULL DEFAULT 10 CHECK (final_count BETWEEN 1 AND 30),
  semantic_weight double precision NOT NULL DEFAULT 0.72 CHECK (semantic_weight BETWEEN 0 AND 1),
  source_context_chars integer NOT NULL DEFAULT 1300 CHECK (source_context_chars BETWEEN 200 AND 5000),
  query_rewrite_enabled boolean NOT NULL DEFAULT true,
  video_spread_window_ms integer NOT NULL DEFAULT 60000 CHECK (video_spread_window_ms BETWEEN 0 AND 600000),

  -- Answer model
  answer_temperature double precision NOT NULL DEFAULT 0.4 CHECK (answer_temperature BETWEEN 0 AND 2),
  max_answer_tokens integer NOT NULL DEFAULT 2000 CHECK (max_answer_tokens BETWEEN 256 AND 16000),
  allowed_model_tiers text[] NOT NULL DEFAULT ARRAY['fast', 'smart', 'pro'] CHECK (
    cardinality(allowed_model_tiers) > 0
    AND allowed_model_tiers <@ ARRAY['fast', 'smart', 'pro']
  ),
  default_model_tier text NOT NULL DEFAULT 'fast' CHECK (default_model_tier = ANY (allowed_model_tiers)),

  -- Conversation memory
  history_turn_limit integer NOT NULL DEFAULT 14 CHECK (history_turn_limit BETWEEN 0 AND 40),
  history_char_budget integer NOT NULL DEFAULT 9000 CHECK (history_char_budget BETWEEN 0 AND 40000),
  history_message_clip integer NOT NULL DEFAULT 850 CHECK (history_message_clip BETWEEN 100 AND 5000),

  -- Added to the system prompt for every chat in the course.
  course_instructions text NOT NULL DEFAULT '' CHECK (char_length(course_instructions) <= 4000),

  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_course_chat_settings_updated_at
BEFORE UPDATE ON public.course_chat_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.course_chat_settings ENABLE ROW LEVEL SECURITY;

-- Students read their course's settings so the chat only offers allowed
-- model tiers; admins read and edit every course's.
CREATE POLICY "Admins and enrolled students can view course chat settings"
ON public.course_chat_settings FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()) OR public.is_enrolled(auth.uid(), course_id));

CREATE POLICY "Admins can create course chat settings"
ON public.course_chat_settings FOR INSERT
TO authenticated
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update course chat settings"
ON public.course_chat_settings FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Every course gets a row of defaults, so the dashboard always has one to edit.
INSERT INTO public.course_chat_settings (course_id)
SELECT id FROM public.courses
ON CONFLICT (course_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_course_chat_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.course_chat_settings (course_id)
  VALUES (NEW.id)
  ON CONFLICT (course_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER create_course_chat_settings_on_course_insert
AFTER INSERT ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.create_course_chat_settings();

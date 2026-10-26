-- Per-course target share of each chat search's source text that comes from
-- video transcripts rather than documents (0-100), among passages that pass
-- the relevance floor. NULL (the default, and every existing course) keeps
-- ranking by relevance alone. Read by rag-chat through
-- supabase/functions/_shared/chatSettings.ts (videoSharePercent) and applied
-- by balanceByVideoShare in _shared/retrieval.ts; keep the range in step with
-- CHAT_SETTING_RANGES.videoSharePercent.
--
-- The existing course_chat_settings policies cover the new column: admins
-- insert and update, admins and enrolled students read.

ALTER TABLE public.course_chat_settings
  ADD COLUMN IF NOT EXISTS video_share_percent integer
    CHECK (video_share_percent IS NULL OR video_share_percent BETWEEN 0 AND 100);

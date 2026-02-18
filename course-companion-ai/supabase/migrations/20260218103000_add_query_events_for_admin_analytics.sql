-- Add query-level analytics events for admin evaluation dashboards.

CREATE TABLE IF NOT EXISTS public.query_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  academic_term_id UUID REFERENCES public.academic_terms(id) ON DELETE SET NULL,
  user_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  assistant_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  query_text TEXT NOT NULL,
  query_category TEXT NOT NULL DEFAULT 'other',
  retrieved_chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (retrieved_chunk_count >= 0),
  citation_count INTEGER NOT NULL DEFAULT 0 CHECK (citation_count >= 0),
  citation_hit BOOLEAN NOT NULL DEFAULT false,
  unresolved BOOLEAN NOT NULL DEFAULT false,
  unresolved_reason TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_events_created_at
ON public.query_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_events_course_term_created_at
ON public.query_events(course_id, academic_term_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_events_unresolved_created_at
ON public.query_events(unresolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_events_category
ON public.query_events(query_category);

ALTER TABLE public.query_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view query events" ON public.query_events;

CREATE POLICY "Admins can view query events"
ON public.query_events FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

GRANT SELECT ON public.query_events TO authenticated;

CREATE OR REPLACE VIEW public.analytics_query_category_stats
WITH (security_invoker = true) AS
SELECT
  query_category,
  COUNT(*)::BIGINT AS query_count,
  SUM(CASE WHEN citation_hit THEN 1 ELSE 0 END)::BIGINT AS citation_hit_count,
  ROUND(AVG(CASE WHEN citation_hit THEN 1.0 ELSE 0.0 END)::numeric, 4) AS citation_hit_rate,
  SUM(CASE WHEN unresolved THEN 1 ELSE 0 END)::BIGINT AS unresolved_count
FROM public.query_events
GROUP BY query_category;

CREATE OR REPLACE VIEW public.analytics_recent_unresolved_queries
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  course_id,
  academic_term_id,
  query_category,
  unresolved_reason,
  query_text
FROM public.query_events
WHERE unresolved = true
ORDER BY created_at DESC;

GRANT SELECT ON public.analytics_query_category_stats TO authenticated;
GRANT SELECT ON public.analytics_recent_unresolved_queries TO authenticated;

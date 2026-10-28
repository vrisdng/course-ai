-- Stores student feedback survey responses locally instead of emailing them,
-- so nothing is lost and no third-party email service is required.
CREATE TABLE IF NOT EXISTS public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

-- The survey function inserts with the service-role key (bypasses RLS), but this
-- policy lets the same code path work from the normal authenticated client too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'survey_responses'
      AND policyname = 'Users may insert their own survey responses'
  ) THEN
    CREATE POLICY "Users may insert their own survey responses"
      ON public.survey_responses
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

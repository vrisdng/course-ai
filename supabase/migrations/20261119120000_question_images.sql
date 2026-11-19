-- Images students attach to chat questions. The browser uploads each file to
-- the private question-images bucket under "<user id>/<uuid>.<ext>"; rag-chat
-- links it to the saved question message here. Course admins see them in
-- Course analytics through get_course_question_images.

CREATE TABLE public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  position smallint NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_attachments_message_id_idx ON public.message_attachments (message_id);

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- Same guard every app table has (20261020140000).
CREATE POLICY "Password setup required" ON public.message_attachments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.password_setup_complete())) WITH CHECK ((SELECT public.password_setup_complete()));

CREATE POLICY "Users can view attachments in own conversations"
ON public.message_attachments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_attachments.message_id AND c.user_id = auth.uid()
  )
);

-- Only on one's own questions, and only for one's own uploads.
CREATE POLICY "Users can attach own images to own questions"
ON public.message_attachments FOR INSERT
TO authenticated
WITH CHECK (
  (storage.foldername(storage_path))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_attachments.message_id AND m.role = 'user' AND c.user_id = auth.uid()
  )
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('question-images', 'question-images', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- storage.objects already carries the restrictive password-setup policy.
CREATE POLICY "Students can upload own question images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'question-images' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Students can view own question images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'question-images' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Admins can view question images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'question-images' AND
  public.is_admin(auth.uid())
);

-- The images attached to one analytics question (a query_events row).
CREATE FUNCTION public.get_course_question_images(in_course_id uuid, in_question_id uuid)
RETURNS TABLE (storage_path text, content_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT a.storage_path, a.content_type
  FROM public.query_events qe
  JOIN public.message_attachments a ON a.message_id = qe.user_message_id
  WHERE qe.id = in_question_id AND qe.course_id = in_course_id
  ORDER BY a.position;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_course_question_images(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_question_images(uuid, uuid) TO authenticated;

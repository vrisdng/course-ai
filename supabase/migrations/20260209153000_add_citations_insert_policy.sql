-- Allow users to insert citations only for messages in their own conversations.
DROP POLICY IF EXISTS "Users can create citations for own messages" ON public.citations;

CREATE POLICY "Users can create citations for own messages"
ON public.citations FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = message_id
      AND c.user_id = auth.uid()
  )
);

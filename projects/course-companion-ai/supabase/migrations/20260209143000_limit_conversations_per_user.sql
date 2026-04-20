-- Enforce a hard cap of 3 conversations per account.
CREATE OR REPLACE FUNCTION public.enforce_conversation_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conversation_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO conversation_count
  FROM public.conversations
  WHERE user_id = NEW.user_id;

  IF conversation_count >= 3 THEN
    RAISE EXCEPTION 'Conversation limit reached (max 3)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS limit_user_conversations ON public.conversations;
CREATE TRIGGER limit_user_conversations
BEFORE INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_conversation_limit();

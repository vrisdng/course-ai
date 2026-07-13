-- Remove conversation-count cap so users can create unlimited conversations.
DROP TRIGGER IF EXISTS limit_user_conversations ON public.conversations;
DROP FUNCTION IF EXISTS public.enforce_conversation_limit();

-- ============================================================================
-- supabase/migrations/20260703_comment_likes_function.sql
--
-- Atomic comment-likes counter increment, called from CommentSheet.tsx via
-- supabase.rpc('increment_comment_likes', ...) instead of a client-side
-- read-then-write (which raced under concurrent likes and was also blocked
-- by RLS, since `comments` has no client-facing UPDATE policy).
--
-- NOTE (verified 2026-07-03 against aewwdlvbwpczqyvkwvvj): this function was
-- already applied directly via Supabase MCP when CommentSheet.tsx was fixed.
-- This file makes it durable/discoverable under supabase/migrations.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_comment_likes(
  p_comment_id uuid,
  p_delta integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE comments
  SET likes_count = GREATEST(0, likes_count + p_delta)
  WHERE id = p_comment_id;
$$;

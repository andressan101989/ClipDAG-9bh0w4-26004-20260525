-- Atomic comment-likes counter increment, called from CommentSheet.tsx.
-- SECURITY DEFINER is required: `comments` has no client-facing UPDATE RLS
-- policy (only select_all / insert_own / delete_own), so a plain client
-- .update() would be denied by RLS regardless of read-modify-write races.
CREATE OR REPLACE FUNCTION public.increment_comment_likes(
  p_comment_id uuid,
  p_delta      integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $function$
  UPDATE comments
  SET likes_count = GREATEST(0, likes_count + p_delta)
  WHERE id = p_comment_id;
$function$;;

CREATE OR REPLACE FUNCTION public.increment_video_counter(
  p_video_id uuid,
  p_field text,
  p_delta integer DEFAULT 1
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE videos 
  SET likes_count = CASE WHEN p_field = 'likes_count' THEN GREATEST(0, likes_count + p_delta) ELSE likes_count END,
      comments_count = CASE WHEN p_field = 'comments_count' THEN GREATEST(0, comments_count + p_delta) ELSE comments_count END,
      views_count = CASE WHEN p_field = 'views_count' THEN GREATEST(0, views_count + p_delta) ELSE views_count END,
      shares_count = CASE WHEN p_field = 'shares_count' THEN GREATEST(0, shares_count + p_delta) ELSE shares_count END,
      saves_count = CASE WHEN p_field = 'saves_count' THEN GREATEST(0, saves_count + p_delta) ELSE saves_count END
  WHERE id = p_video_id;
$$;;

CREATE OR REPLACE FUNCTION public.increment_live_viewer_count(p_session_id uuid, p_delta integer)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE live_sessions
  SET viewer_count = GREATEST(0, viewer_count + p_delta)
  WHERE id = p_session_id;
$$;;

-- ============================================================================
-- supabase/migrations/20260705_call_type_and_live_viewer_count.sql
--
-- Documents fixes applied directly to aewwdlvbwpczqyvkwvvj via Supabase MCP
-- that weren't yet captured in a migration file:
--
--   1. `call_type` column on `calls` — added in a previous session pass when
--      app/call/[userId].tsx (audio) was implemented, so acceptIncomingCall
--      can route to /call/ vs /video-call/ based on how the call was placed.
--      Default 'video' preserves existing rows / the video-call flow.
--
--   2. `increment_live_viewer_count` RPC — the live-stream viewer count was
--      previously updated via a client-side read-then-write (select
--      viewer_count, compute +1/-1, update), which lost updates whenever two
--      viewers joined/left concurrently. Replaced with an atomic UPDATE,
--      same pattern as increment_video_counter (20260704_system_fixes.sql).
--
-- SAFE TO RE-RUN: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
-- ============================================================================

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS call_type text NOT NULL DEFAULT 'video';

CREATE OR REPLACE FUNCTION public.increment_live_viewer_count(p_session_id uuid, p_delta integer)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE live_sessions
  SET viewer_count = GREATEST(0, viewer_count + p_delta)
  WHERE id = p_session_id;
$$;

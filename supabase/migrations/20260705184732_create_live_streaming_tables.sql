-- Live streaming tables needed by broadcast/watch screens
CREATE TABLE IF NOT EXISTS public.live_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id      uuid NOT NULL REFERENCES public.user_profiles(id),
  title        text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'live' CHECK (status IN ('live','ended')),
  viewer_count integer NOT NULL DEFAULT 0,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.live_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.user_profiles(id),
  username   text NOT NULL DEFAULT '',
  message    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read live sessions" ON public.live_sessions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert live sessions" ON public.live_sessions FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host can update own sessions" ON public.live_sessions FOR UPDATE USING (auth.uid() = host_id);

CREATE POLICY "Anyone can read live messages" ON public.live_messages FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert live messages" ON public.live_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Enable Realtime for live_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_messages;;

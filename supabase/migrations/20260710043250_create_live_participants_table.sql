CREATE TABLE IF NOT EXISTS public.live_participants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   text NOT NULL,
  user_id      uuid NOT NULL REFERENCES public.user_profiles(id),
  agora_uid    integer NOT NULL,
  username     text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','rejected','removed','left')),
  mic_locked   boolean NOT NULL DEFAULT false,
  speech_timer_seconds integer,
  speech_started_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read live participants" ON public.live_participants FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert" ON public.live_participants FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Authenticated users can update" ON public.live_participants FOR UPDATE USING (auth.uid() IS NOT NULL);

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_participants;

CREATE INDEX idx_live_participants_session ON public.live_participants(session_id, status);;

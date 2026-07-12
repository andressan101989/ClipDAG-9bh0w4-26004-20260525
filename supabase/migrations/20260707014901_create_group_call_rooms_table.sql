CREATE TABLE IF NOT EXISTS public.group_call_rooms (
  id         text PRIMARY KEY,
  host_id    uuid NOT NULL REFERENCES public.user_profiles(id),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);

ALTER TABLE public.group_call_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read group call rooms" ON public.group_call_rooms FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create rooms" ON public.group_call_rooms FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host can update own room" ON public.group_call_rooms FOR UPDATE USING (auth.uid() = host_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_call_rooms;;

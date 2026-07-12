CREATE TABLE IF NOT EXISTS public.gifts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES public.user_profiles(id),
  gift_type  text NOT NULL,
  amount     numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read gifts" ON public.gifts FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert gifts" ON public.gifts FOR INSERT WITH CHECK (auth.uid() = sender_id);;

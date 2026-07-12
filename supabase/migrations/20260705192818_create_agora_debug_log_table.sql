CREATE TABLE IF NOT EXISTS public.agora_debug_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  event      text NOT NULL,
  data       jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agora_debug_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can insert debug logs" ON public.agora_debug_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read debug logs" ON public.agora_debug_logs FOR SELECT USING (true);;

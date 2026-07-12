ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS call_type text NOT NULL DEFAULT 'video';;

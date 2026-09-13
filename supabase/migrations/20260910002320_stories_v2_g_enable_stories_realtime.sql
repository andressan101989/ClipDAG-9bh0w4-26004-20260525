-- STORIES-V2-G: Realtime is an invalidation signal only. Canonical Story
-- visibility remains public.stories RLS and every client event is reconciled
-- through the normal SELECT path before it can affect shared state.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stories'
  ) then
    alter publication supabase_realtime add table public.stories;
  end if;
end
$$;

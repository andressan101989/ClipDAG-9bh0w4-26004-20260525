-- ============================================================================
-- supabase/migrations/20260703_add_realtime_publications.sql
--
-- Documents that comments, notifications, and calls must be members of the
-- supabase_realtime publication for their client-side postgres_changes
-- subscriptions to work (CommentSheet.tsx, NotificationsContext.tsx,
-- AgoraCallContext.tsx).
--
-- NOTE (verified 2026-07-03 against aewwdlvbwpczqyvkwvvj): all three were
-- already added to the publication by scripts/migration_to_supabase.sql's
-- REALTIME block when the schema was first migrated to this Supabase
-- project. This file makes that requirement durable/discoverable under
-- supabase/migrations, and is guarded so it's a safe no-op if run again.
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array['comments', 'notifications', 'calls']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

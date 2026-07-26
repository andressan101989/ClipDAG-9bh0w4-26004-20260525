-- ============================================================================
-- supabase/migrations/20260704_storage_buckets.sql
--
-- Storage buckets (avatars, images, videos) were created manually via
-- Supabase MCP against aewwdlvbwpczqyvkwvvj — this file documents what was
-- applied so a fresh project can be brought to the same state.
--
-- Note: Supabase Storage buckets/objects live in the `storage` schema as
-- plain tables (storage.buckets, storage.objects), so they're created via
-- SQL the same way as any other table row — there's no separate
-- "bucket API" migration mechanism.
--
--   avatars: public bucket — profile photos, path `${user.id}/avatar_*`
--   images:  public bucket — AI avatar images, post images, product photos,
--            chat image attachments; path `${user.id}/*`
--   videos:  public bucket — video posts; path `${user.id}/*`
--
-- All three follow the same RLS pattern: public read, write restricted to
-- the user's own top-level folder (matching the `${user.id}/...` path
-- convention used everywhere in the app — see app/(tabs)/upload.tsx,
-- app/(tabs)/profile.tsx, app/create-product.tsx, app/chat/[userId].tsx,
-- app/ai-avatar*.tsx).
--
-- SAFE TO RE-RUN: guarded with ON CONFLICT DO NOTHING / DROP POLICY IF EXISTS.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('images',  'images',  true),
  ('videos',  'videos',  true)
on conflict (id) do nothing;

-- ── avatars ──────────────────────────────────────────────────────────────────
drop policy if exists "avatars_select_all" on storage.objects;
create policy "avatars_select_all" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── images ───────────────────────────────────────────────────────────────────
drop policy if exists "images_select_all" on storage.objects;
create policy "images_select_all" on storage.objects
  for select using (bucket_id = 'images');

drop policy if exists "images_insert_own" on storage.objects;
create policy "images_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "images_update_own" on storage.objects;
create policy "images_update_own" on storage.objects
  for update using (
    bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "images_delete_own" on storage.objects;
create policy "images_delete_own" on storage.objects
  for delete using (
    bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── videos ───────────────────────────────────────────────────────────────────
drop policy if exists "videos_select_all" on storage.objects;
create policy "videos_select_all" on storage.objects
  for select using (bucket_id = 'videos');

drop policy if exists "videos_insert_own" on storage.objects;
create policy "videos_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "videos_update_own" on storage.objects;
create policy "videos_update_own" on storage.objects
  for update using (
    bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "videos_delete_own" on storage.objects;
create policy "videos_delete_own" on storage.objects
  for delete using (
    bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text
  );

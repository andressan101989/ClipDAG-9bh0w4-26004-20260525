insert into storage.buckets (id, name, public)
values ('images', 'images', true), ('videos', 'videos', true)
on conflict (id) do nothing;

-- images bucket
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

-- videos bucket
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
  );;

-- messages — used by contexts/MessagesContext.tsx and app/chat/[userId].tsx.
-- Column set and FK names (messages_sender_id_fkey / messages_recipient_id_fkey,
-- Postgres's default auto-generated names for inline `references` columns)
-- match exactly what MessagesContext.tsx's join syntax expects:
--   user_profiles!messages_sender_id_fkey(username, avatar_url)
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references user_profiles(id) on delete cascade,
  recipient_id  uuid not null references user_profiles(id) on delete cascade,
  text          text not null default '',
  media_url     text,
  media_type    text not null default 'text',
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists messages_sender_id_idx    on messages (sender_id, created_at desc);
create index if not exists messages_recipient_id_idx on messages (recipient_id, created_at desc);

alter table messages enable row level security;

drop policy if exists "messages_select_participant" on messages;
create policy "messages_select_participant" on messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "messages_insert_own" on messages;
create policy "messages_insert_own" on messages
  for insert with check (auth.uid() = sender_id);

drop policy if exists "messages_update_recipient" on messages;
create policy "messages_update_recipient" on messages
  for update using (auth.uid() = recipient_id);

-- likes — per-user video-like tracking (mirrors the existing comment_likes
-- pattern). Used by supabase/functions/process_dag_reward/index.ts as the
-- idempotency guard for the like/unlike + BDAG reward flow.
create table if not exists likes (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references videos(id) on delete cascade,
  user_id     uuid not null references user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (video_id, user_id)
);

create index if not exists likes_video_id_idx on likes (video_id);
create index if not exists likes_user_id_idx  on likes (user_id);

alter table likes enable row level security;

drop policy if exists "likes_select_all" on likes;
create policy "likes_select_all" on likes
  for select using (true);

drop policy if exists "likes_insert_own" on likes;
create policy "likes_insert_own" on likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "likes_delete_own" on likes;
create policy "likes_delete_own" on likes
  for delete using (auth.uid() = user_id);

-- video_saves — used by contexts/FeedContext.tsx's toggleSave().
create table if not exists video_saves (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references videos(id) on delete cascade,
  user_id     uuid not null references user_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (video_id, user_id)
);

create index if not exists video_saves_video_id_idx on video_saves (video_id);
create index if not exists video_saves_user_id_idx  on video_saves (user_id);

alter table video_saves enable row level security;

drop policy if exists "video_saves_select_own" on video_saves;
create policy "video_saves_select_own" on video_saves
  for select using (auth.uid() = user_id);

drop policy if exists "video_saves_insert_own" on video_saves;
create policy "video_saves_insert_own" on video_saves
  for insert with check (auth.uid() = user_id);

drop policy if exists "video_saves_delete_own" on video_saves;
create policy "video_saves_delete_own" on video_saves
  for delete using (auth.uid() = user_id);

-- Realtime (matches the pattern used for the original 13 tables)
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'likes', 'video_saves']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;;

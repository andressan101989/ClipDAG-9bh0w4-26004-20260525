begin;

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  media_url text not null,
  media_type text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_user_id_fkey
    foreign key (user_id) references public.user_profiles(id) on delete cascade,
  constraint stories_media_type_check
    check (media_type in ('photo', 'video')),
  constraint stories_media_url_not_empty
    check (length(btrim(media_url)) > 0),
  constraint stories_expiry_after_creation
    check (expires_at > created_at)
);

create index stories_user_created_idx
  on public.stories(user_id, created_at desc);
create index stories_expires_idx
  on public.stories(expires_at);
create index stories_active_user_idx
  on public.stories(user_id, expires_at desc);

create table public.story_views (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.user_profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  constraint story_views_story_viewer_key unique(story_id, viewer_id)
);

create index story_views_viewer_idx
  on public.story_views(viewer_id, viewed_at desc);
create index story_views_story_idx
  on public.story_views(story_id);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;

create policy stories_read_active_or_owned
  on public.stories
  for select
  to authenticated
  using (expires_at > now() or user_id = auth.uid());

create policy stories_insert_owned
  on public.stories
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy stories_delete_owned
  on public.stories
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy story_views_read_owned
  on public.story_views
  for select
  to authenticated
  using (viewer_id = auth.uid());

create policy story_views_insert_owned
  on public.story_views
  for insert
  to authenticated
  with check (
    viewer_id = auth.uid()
    and exists (
      select 1
      from public.stories s
      where s.id = story_id
        and (s.expires_at > now() or s.user_id = auth.uid())
    )
  );

grant select, insert, delete on public.stories to authenticated;
grant select, insert on public.story_views to authenticated;

notify pgrst, 'reload schema';

commit;

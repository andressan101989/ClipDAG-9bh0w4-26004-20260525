begin;

-- Story deletion is coordinated by one owner-authorized RPC. Clients retain
-- read-only table access and cannot bypass the media deletion lifecycle.
drop policy if exists stories_delete_owned on public.stories;

revoke all on table public.stories from anon, authenticated;
grant select on table public.stories to authenticated;

create or replace function public.delete_story(p_story_id uuid)
returns table(
  deleted_story_id uuid,
  media_asset_id uuid,
  media_cleanup_status text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_asset_id uuid;
  v_asset_owner uuid;
  v_cleanup_status text := 'none';
  v_affected integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;

  select s.id
  into v_story_id
  from public.stories s
  where s.id = p_story_id
    and s.user_id = v_actor
  for update;

  if v_story_id is null then
    raise exception using errcode = '42501', message = 'story_not_found_or_not_owned';
  end if;

  -- Discover the canonical Story link without treating legacy media_url as an
  -- object identity. C's partial unique index guarantees at most one row.
  select l.asset_id
  into v_asset_id
  from public.media_asset_links l
  where l.entity_type = 'story'
    and l.entity_id = v_story_id
    and l.slot = 'media'
    and l.position = 0;

  if v_asset_id is not null then
    -- Match the generic lifecycle lock order: media asset before media link.
    select a.owner_id
    into v_asset_owner
    from public.media_assets a
    where a.id = v_asset_id
    for update;

    if v_asset_owner is null or v_asset_owner <> v_actor then
      raise exception using errcode = '55000', message = 'story_media_contract_invalid';
    end if;

    perform 1
    from public.media_asset_links l
    where l.asset_id = v_asset_id
      and l.entity_type = 'story'
      and l.entity_id = v_story_id
      and l.slot = 'media'
      and l.position = 0
    for update;

    if not found then
      raise exception using errcode = '55000', message = 'story_media_contract_changed';
    end if;

    delete from public.media_asset_links l
    where l.asset_id = v_asset_id
      and l.entity_type = 'story'
      and l.entity_id = v_story_id
      and l.slot = 'media'
      and l.position = 0;

    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = '55000', message = 'story_media_unlink_failed';
    end if;
  end if;

  delete from public.stories s
  where s.id = v_story_id
    and s.user_id = v_actor;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = '55000', message = 'story_delete_failed';
  end if;

  -- Physical object deletion remains asynchronous and generic. A shared asset
  -- is retained when another authoritative link is still valid.
  if v_asset_id is not null then
    v_cleanup_status := public.schedule_media_asset_deletion(v_asset_id, v_actor);
    if v_cleanup_status not in ('scheduled', 'deleted', 'asset_in_use') then
      raise exception using errcode = '55000', message = 'story_media_schedule_failed';
    end if;
  end if;

  return query
  select v_story_id, v_asset_id, v_cleanup_status;
end;
$$;

revoke all on function public.delete_story(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_story(uuid)
  to authenticated;

comment on function public.delete_story(uuid) is
  'Canonical owner-only Story deletion. Removes the Story link and row atomically, relies on story_views cascade, and delegates media scheduling to the generic lifecycle.';

notify pgrst, 'reload schema';

commit;

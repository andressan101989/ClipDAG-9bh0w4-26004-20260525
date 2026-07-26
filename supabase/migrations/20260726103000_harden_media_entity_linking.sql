begin;

-- Only entity types backed by an existing authoritative ownership table are
-- client-linkable. exclusive_content and chat_message remain disabled until
-- their participant/entitlement authorization is implemented.
create or replace function public.link_media_asset(
  p_asset_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_slot text,
  p_position integer default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_authorized boolean := false;
begin
  if p_entity_type not in ('user_profile','video_post','story','shop_product') then
    raise exception 'invalid_entity_type';
  end if;
  if p_position < 0 then raise exception 'invalid_position'; end if;

  perform 1
  from public.media_assets
  where id = p_asset_id
    and owner_id = auth.uid()
    and status = 'ready';
  if not found then raise exception 'asset_not_ready_or_owned'; end if;

  case p_entity_type
    when 'user_profile' then
      v_authorized := p_entity_id = auth.uid();
    when 'video_post' then
      select exists(
        select 1 from public.videos
        where id = p_entity_id and user_id = auth.uid()
      ) into v_authorized;
    when 'story' then
      select exists(
        select 1 from public.stories
        where id = p_entity_id and user_id = auth.uid()
      ) into v_authorized;
    when 'shop_product' then
      select exists(
        select 1 from public.products
        where id = p_entity_id and seller_id = auth.uid()
      ) into v_authorized;
    else
      v_authorized := false;
  end case;

  if not v_authorized then raise exception 'entity_not_owned'; end if;

  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_id,p_entity_type,p_entity_id,p_slot,p_position)
  on conflict(asset_id,entity_type,entity_id,slot,position)
  do update set slot = excluded.slot
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.link_media_asset(uuid,text,uuid,text,integer)
  from public, anon;
grant execute on function public.link_media_asset(uuid,text,uuid,text,integer)
  to authenticated;

-- The catalog is publish-only in this phase. Authenticated sellers may edit
-- descriptive/catalog fields, but cannot forge sales totals or ownership.
revoke insert, update on public.products from authenticated;
grant insert (
  seller_id,title,description,price,currency,category,images,stock,status,tags
) on public.products to authenticated;
grant update (
  title,description,price,category,images,stock,status,tags
) on public.products to authenticated;

notify pgrst, 'reload schema';

commit;

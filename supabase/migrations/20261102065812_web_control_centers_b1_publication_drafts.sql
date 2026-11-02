begin;

-- WEB-CONTROL-CENTERS-B1
-- Canonical, owner-scoped photo/carousel publication receipts and private
-- cloud drafts. This migration does not add a scheduler, calendar, media
-- inventory, provider deletion path, Feed authority, or financial authority.

create table private.publication_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  client_request_id uuid not null,
  kind text not null check (kind in ('photo','carousel')),
  caption text not null default '' check (pg_catalog.char_length(caption) <= 300),
  music text not null default 'Sin musica' check (pg_catalog.char_length(music) <= 300),
  composition jsonb not null default '{}'::jsonb,
  state text not null default 'draft' check (state in ('draft','published','deleted')),
  revision bigint not null default 1 check (revision > 0),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  published_post_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  published_at timestamptz,
  deleted_at timestamptz,
  unique(owner_id, client_request_id),
  check (pg_catalog.jsonb_typeof(composition) = 'object'),
  check (pg_catalog.pg_column_size(composition) <= 65536),
  check (
    (state = 'draft' and published_post_id is null and published_at is null and deleted_at is null)
    or (state = 'published' and published_post_id is not null and published_at is not null and deleted_at is null)
    or (state = 'deleted' and published_post_id is null and published_at is null and deleted_at is not null)
  )
);

create index publication_drafts_owner_updated_idx
  on private.publication_drafts(owner_id, updated_at desc, id desc)
  where state = 'draft';

create table private.publication_draft_commands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  client_mutation_id uuid not null,
  draft_id uuid not null references private.publication_drafts(id) on delete restrict,
  operation text not null check (operation in ('create','update','delete')),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_revision bigint not null check (result_revision > 0),
  result_state text not null check (result_state in ('draft','deleted')),
  result_payload jsonb not null check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(owner_id, client_mutation_id)
);

create index publication_draft_commands_draft_idx
  on private.publication_draft_commands(draft_id, created_at desc);

create table private.publication_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  client_command_id uuid not null,
  operation text not null check (operation in ('direct','draft')),
  kind text not null check (kind in ('photo','carousel')),
  draft_id uuid references private.publication_drafts(id) on delete restrict,
  draft_revision bigint,
  ordered_asset_ids uuid[] not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  post_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(owner_id, client_command_id),
  check (pg_catalog.array_ndims(ordered_asset_ids) = 1),
  check (pg_catalog.cardinality(ordered_asset_ids) between 1 and 10),
  check (
    (operation = 'direct' and draft_id is null and draft_revision is null)
    or (operation = 'draft' and draft_id is not null and draft_revision is not null and draft_revision > 0)
  )
);

create unique index publication_receipts_draft_uidx
  on private.publication_receipts(draft_id)
  where operation = 'draft';

alter table private.publication_drafts enable row level security;
alter table private.publication_drafts force row level security;
alter table private.publication_draft_commands enable row level security;
alter table private.publication_draft_commands force row level security;
alter table private.publication_receipts enable row level security;
alter table private.publication_receipts force row level security;

revoke all on table private.publication_drafts from public, anon, authenticated, service_role;
revoke all on table private.publication_draft_commands from public, anon, authenticated, service_role;
revoke all on table private.publication_receipts from public, anon, authenticated, service_role;

create function private.guard_publication_receipt_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'publication_receipt_immutable';
end;
$function$;

create trigger publication_receipts_immutable
before update or delete on private.publication_receipts
for each row execute function private.guard_publication_receipt_immutable_v1();

create function private.guard_publication_draft_command_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'publication_draft_command_immutable';
end;
$function$;

create trigger publication_draft_commands_immutable
before update or delete on private.publication_draft_commands
for each row execute function private.guard_publication_draft_command_immutable_v1();

create function private.guard_publication_draft_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'publication_draft_physical_delete_forbidden';
  end if;
  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.client_request_id is distinct from old.client_request_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'publication_draft_identity_immutable';
  end if;
  if old.state <> 'draft'
     or new.state not in ('draft','published','deleted')
     or new.revision <> old.revision + 1 then
    raise exception using errcode = '55000', message = 'publication_draft_transition_invalid';
  end if;
  return new;
end;
$function$;

create trigger publication_drafts_guard_mutation
before update or delete on private.publication_drafts
for each row execute function private.guard_publication_draft_mutation_v1();

revoke all on function private.guard_publication_receipt_immutable_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_publication_draft_command_immutable_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_publication_draft_mutation_v1()
  from public, anon, authenticated, service_role;

alter table public.media_asset_links
  drop constraint media_asset_links_entity_type_check;

alter table public.media_asset_links
  add constraint media_asset_links_entity_type_check check (
    entity_type in (
      'user_profile','video_post','story','chat_message','shop_product',
      'exclusive_content','marketplace_store','marketplace_dispute',
      'marketplace_return_shipment','creator_premium_content','publication_draft'
    )
  );

create unique index publication_draft_media_position_uidx
  on public.media_asset_links(entity_id, position)
  where entity_type = 'publication_draft';

create unique index publication_draft_media_asset_uidx
  on public.media_asset_links(asset_id)
  where entity_type = 'publication_draft';

create function private.guard_publication_draft_media_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_asset public.media_assets;
  v_draft private.publication_drafts;
begin
  if tg_op = 'UPDATE' and old.entity_type = 'publication_draft' then
    raise exception using errcode = '55000', message = 'publication_draft_media_link_immutable';
  end if;
  if new.entity_type <> 'publication_draft' then return new; end if;
  if new.slot <> 'media' or new.position < 0 then
    raise exception using errcode = '23514', message = 'publication_draft_media_shape_invalid';
  end if;

  select draft.* into v_draft
  from private.publication_drafts draft
  where draft.id = new.entity_id
  for key share;
  if not found or v_draft.state <> 'draft' then
    raise exception using errcode = '23503', message = 'publication_draft_not_found';
  end if;

  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = new.asset_id
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'publication_draft_media_not_found';
  end if;
  if exists (
    select 1
    from public.media_assets asset
    join private.publication_drafts draft on draft.id = new.entity_id
    where asset.id = new.asset_id
      and asset.owner_id is distinct from draft.owner_id
  ) then
    raise exception using errcode = '42501', message = 'publication_draft_media_cross_owner';
  end if;
  if v_asset.provider <> 'r2'
     or v_asset.media_kind <> 'image'
     or v_asset.status <> 'ready'
     or v_asset.visibility <> 'private'
     or v_asset.public_url is not null then
    raise exception using errcode = '23514', message = 'publication_draft_media_not_private_ready';
  end if;
  if (v_draft.kind = 'photo' and (v_asset.purpose <> 'post_image' or new.position <> 0))
     or (v_draft.kind = 'carousel' and (v_asset.purpose <> 'carousel_image' or new.position > 9)) then
    raise exception using errcode = '23514', message = 'publication_draft_media_kind_mismatch';
  end if;
  return new;
end;
$function$;

create trigger media_asset_links_guard_publication_draft
before insert or update on public.media_asset_links
for each row execute function private.guard_publication_draft_media_v1();

revoke all on function private.guard_publication_draft_media_v1()
  from public, anon, authenticated, service_role;

drop policy media_asset_links_owner_read on public.media_asset_links;
create policy media_asset_links_owner_read on public.media_asset_links
for select to authenticated
using (
  entity_type not in ('story','creator_premium_content','publication_draft')
  and exists (
    select 1 from public.media_assets asset
    where asset.id = media_asset_links.asset_id
      and asset.owner_id = (select auth.uid())
  )
);

drop policy media_asset_links_public_read on public.media_asset_links;
create policy media_asset_links_public_read on public.media_asset_links
for select to anon, authenticated
using (
  entity_type not in ('story','creator_premium_content','publication_draft')
  and exists (
    select 1 from public.media_assets asset
    where asset.id = media_asset_links.asset_id
      and asset.visibility = 'public'
      and asset.status = 'ready'
  )
);

create function private.publication_draft_composition_safe_v1(p_composition jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_composition is not null
    and (jsonb_typeof(p_composition) <> 'object') = false
    and pg_column_size(p_composition) <= 65536
    and pg_catalog.lower(p_composition::text) !~
      '(file:|content:|ph:|blob:|data:|https?://|bucket_name|object_key|signed_url|public_url)'
$function$;

create function private.publication_draft_payload_fingerprint_v1(
  p_operation text,
  p_kind text,
  p_caption text,
  p_music text,
  p_composition jsonb,
  p_asset_ids uuid[],
  p_expected_revision bigint default null,
  p_draft_id uuid default null
) returns text
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'operation',p_operation,'kind',p_kind,'caption',p_caption,'music',p_music,
          'composition',p_composition,'ordered_asset_ids',pg_catalog.to_jsonb(p_asset_ids),
          'expected_revision',p_expected_revision,'draft_id',p_draft_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;

create function private.require_publication_asset_set_v1(
  p_actor uuid,
  p_kind text,
  p_asset_ids uuid[],
  p_visibility text
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer := coalesce(pg_catalog.cardinality(p_asset_ids),0);
  v_valid integer;
begin
  if p_actor is null
     or p_kind not in ('photo','carousel')
     or p_visibility not in ('private','public')
     or p_asset_ids is null
     or pg_catalog.array_ndims(p_asset_ids) <> 1
     or pg_catalog.array_position(p_asset_ids,null::uuid) is not null
     or (p_kind = 'photo' and v_count <> 1)
     or (p_kind = 'carousel' and v_count not between 2 and 10)
     or (select pg_catalog.count(distinct asset_id) from pg_catalog.unnest(p_asset_ids) asset_id) <> v_count then
    raise exception using errcode = '22023', message = 'publication_asset_set_invalid';
  end if;

  perform asset.id
  from public.media_assets asset
  where asset.id = any(p_asset_ids)
  order by asset.id
  for update;

  select pg_catalog.count(*) into v_valid
  from pg_catalog.unnest(p_asset_ids) requested(asset_id)
  join public.media_assets asset on asset.id = requested.asset_id
  where asset.owner_id = p_actor
    and asset.provider = 'r2'
    and asset.media_kind = 'image'
    and asset.status = 'ready'
    and asset.visibility = p_visibility
    and asset.purpose = case when p_kind = 'photo' then 'post_image' else 'carousel_image' end
    and (
      (p_visibility = 'private' and asset.public_url is null)
      or (p_visibility = 'public' and asset.public_url ~* '^https://')
    );
  if v_valid <> v_count then
    raise exception using errcode = '42501', message = 'publication_asset_not_ready_or_owned';
  end if;
end;
$function$;

create function private.publication_draft_json_v1(p_draft private.publication_drafts)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id',p_draft.id,
    'client_request_id',p_draft.client_request_id,
    'kind',p_draft.kind,
    'caption',p_draft.caption,
    'music',p_draft.music,
    'composition',p_draft.composition,
    'state',p_draft.state,
    'revision',p_draft.revision,
    'published_post_id',p_draft.published_post_id,
    'asset_ids',coalesce((
      select pg_catalog.jsonb_agg(link.asset_id order by link.position)
      from public.media_asset_links link
      where link.entity_type = 'publication_draft'
        and link.entity_id = p_draft.id
        and link.slot = 'media'
    ),'[]'::jsonb),
    'created_at',p_draft.created_at,
    'updated_at',p_draft.updated_at,
    'published_at',p_draft.published_at,
    'deleted_at',p_draft.deleted_at
  )
$function$;

revoke all on function private.publication_draft_composition_safe_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.publication_draft_payload_fingerprint_v1(text,text,text,text,jsonb,uuid[],bigint,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_publication_asset_set_v1(uuid,text,uuid[],text)
  from public, anon, authenticated, service_role;
revoke all on function private.publication_draft_json_v1(private.publication_drafts)
  from public, anon, authenticated, service_role;

create function public.create_my_publication_draft_v1(
  p_client_request_id uuid,
  p_kind text,
  p_caption text,
  p_music text,
  p_composition jsonb,
  p_asset_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_caption text := pg_catalog.btrim(coalesce(p_caption,''));
  v_music text := coalesce(nullif(pg_catalog.btrim(coalesce(p_music,'')),''),'Sin musica');
  v_composition jsonb := coalesce(p_composition,'{}'::jsonb);
  v_fingerprint text;
  v_command private.publication_draft_commands;
  v_existing private.publication_drafts;
  v_created private.publication_drafts;
  v_result jsonb;
  v_position integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'publication_auth_required';
  end if;
  if p_client_request_id is null
     or p_kind not in ('photo','carousel')
     or pg_catalog.char_length(v_caption) > 300
     or pg_catalog.char_length(v_music) > 300 then
    raise exception using errcode = '22023', message = 'publication_draft_invalid';
  end if;
  if not private.publication_draft_composition_safe_v1(v_composition) then
    raise exception using errcode = '22023', message = 'draft_composition_unsafe';
  end if;
  v_fingerprint := private.publication_draft_payload_fingerprint_v1(
    'create',p_kind,v_caption,v_music,v_composition,p_asset_ids,null,null
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-draft-create:' || v_actor::text || ':' || p_client_request_id::text,0
  ));
  select command.* into v_command
  from private.publication_draft_commands command
  where command.owner_id = v_actor and command.client_mutation_id = p_client_request_id;
  if found then
    if v_command.operation is distinct from 'create'
       or v_command.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'publication_draft_idempotency_conflict';
    end if;
    return v_command.result_payload;
  end if;
  perform private.require_publication_asset_set_v1(v_actor,p_kind,p_asset_ids,'private');

  select draft.* into v_existing
  from private.publication_drafts draft
  where draft.owner_id = v_actor and draft.client_request_id = p_client_request_id;
  if found then
    raise exception using errcode = '55000', message = 'publication_draft_command_missing';
  end if;

  insert into private.publication_drafts(
    owner_id,client_request_id,kind,caption,music,composition,request_fingerprint
  ) values (
    v_actor,p_client_request_id,p_kind,v_caption,v_music,v_composition,v_fingerprint
  ) returning * into v_created;

  for v_position in 1..pg_catalog.cardinality(p_asset_ids) loop
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    values(p_asset_ids[v_position],'publication_draft',v_created.id,'media',v_position-1);
  end loop;
  v_result := private.publication_draft_json_v1(v_created);
  insert into private.publication_draft_commands(
    owner_id,client_mutation_id,draft_id,operation,request_fingerprint,
    result_revision,result_state,result_payload
  ) values (v_actor,p_client_request_id,v_created.id,'create',v_fingerprint,1,'draft',v_result);
  return v_result;
end;
$function$;

create function public.get_my_publication_draft_v1(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_draft private.publication_drafts;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  select draft.* into v_draft from private.publication_drafts draft
  where draft.id=p_draft_id and draft.owner_id=v_actor and draft.state<>'deleted';
  if not found then raise exception using errcode='P0002',message='publication_draft_not_found'; end if;
  return private.publication_draft_json_v1(v_draft);
end;
$function$;

create function public.list_my_publication_drafts_v1(
  p_limit integer default 20,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null
) returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_limit integer := pg_catalog.greatest(1,pg_catalog.least(coalesce(p_limit,20),50));
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if (p_cursor_updated_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023',message='publication_draft_cursor_invalid';
  end if;
  return query
  select private.publication_draft_json_v1(draft)
  from private.publication_drafts draft
  where draft.owner_id=v_actor and draft.state='draft'
    and (p_cursor_updated_at is null or (draft.updated_at,draft.id)<(p_cursor_updated_at,p_cursor_id))
  order by draft.updated_at desc,draft.id desc
  limit v_limit;
end;
$function$;

create function public.update_my_publication_draft_v1(
  p_draft_id uuid,
  p_expected_revision bigint,
  p_client_mutation_id uuid,
  p_kind text,
  p_caption text,
  p_music text,
  p_composition jsonb,
  p_asset_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_caption text := pg_catalog.btrim(coalesce(p_caption,''));
  v_music text := coalesce(nullif(pg_catalog.btrim(coalesce(p_music,'')),''),'Sin musica');
  v_composition jsonb := coalesce(p_composition,'{}'::jsonb);
  v_fingerprint text;
  v_command private.publication_draft_commands;
  v_draft private.publication_drafts;
  v_updated private.publication_drafts;
  v_result jsonb;
  v_old_assets uuid[];
  v_asset_id uuid;
  v_position integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if p_draft_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_client_mutation_id is null or p_kind not in ('photo','carousel')
     or pg_catalog.char_length(v_caption)>300 or pg_catalog.char_length(v_music)>300 then
    raise exception using errcode='22023',message='publication_draft_invalid';
  end if;
  if not private.publication_draft_composition_safe_v1(v_composition) then
    raise exception using errcode='22023',message='draft_composition_unsafe';
  end if;
  v_fingerprint:=private.publication_draft_payload_fingerprint_v1(
    'update',p_kind,v_caption,v_music,v_composition,p_asset_ids,p_expected_revision,p_draft_id
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-draft-mutation:'||v_actor::text||':'||p_client_mutation_id::text,0
  ));
  select command.* into v_command from private.publication_draft_commands command
  where command.owner_id=v_actor and command.client_mutation_id=p_client_mutation_id;
  if found then
    if v_command.operation<>'update' or v_command.draft_id<>p_draft_id
       or v_command.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='draft_mutation_conflict';
    end if;
    return v_command.result_payload;
  end if;

  select draft.* into v_draft from private.publication_drafts draft
  where draft.id=p_draft_id and draft.owner_id=v_actor for update;
  if not found then raise exception using errcode='P0002',message='publication_draft_not_found'; end if;
  if v_draft.state<>'draft' or v_draft.revision<>p_expected_revision then
    raise exception using errcode='40001',message='publication_draft_revision_conflict';
  end if;
  perform private.require_publication_asset_set_v1(v_actor,p_kind,p_asset_ids,'private');
  select pg_catalog.array_agg(link.asset_id order by link.position) into v_old_assets
  from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  delete from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  update private.publication_drafts draft
  set kind=p_kind,caption=v_caption,music=v_music,composition=v_composition,
      revision=draft.revision+1,updated_at=pg_catalog.clock_timestamp()
  where draft.id=p_draft_id and draft.revision=p_expected_revision
  returning * into v_updated;
  if not found then raise exception using errcode='40001',message='publication_draft_revision_conflict'; end if;
  for v_position in 1..pg_catalog.cardinality(p_asset_ids) loop
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    values(p_asset_ids[v_position],'publication_draft',p_draft_id,'media',v_position-1);
  end loop;
  v_result:=private.publication_draft_json_v1(v_updated);
  insert into private.publication_draft_commands(
    owner_id,client_mutation_id,draft_id,operation,request_fingerprint,
    result_revision,result_state,result_payload
  ) values (v_actor,p_client_mutation_id,p_draft_id,'update',v_fingerprint,
    v_updated.revision,'draft',v_result);
  foreach v_asset_id in array coalesce(v_old_assets,'{}'::uuid[]) loop
    if not (v_asset_id=any(p_asset_ids)) then
      perform public.schedule_media_asset_deletion(v_asset_id,v_actor);
    end if;
  end loop;
  return v_result;
end;
$function$;

create function public.delete_my_publication_draft_v1(
  p_draft_id uuid,
  p_expected_revision bigint,
  p_client_mutation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid:=auth.uid();
  v_fingerprint text;
  v_command private.publication_draft_commands;
  v_draft private.publication_drafts;
  v_deleted private.publication_drafts;
  v_result jsonb;
  v_old_assets uuid[];
  v_asset_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if p_draft_id is null or p_expected_revision is null or p_expected_revision<1
     or p_client_mutation_id is null then
    raise exception using errcode='22023',message='publication_draft_invalid';
  end if;
  v_fingerprint:=private.publication_draft_payload_fingerprint_v1(
    'delete','photo','', '','{}'::jsonb,'{}'::uuid[],p_expected_revision,p_draft_id
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-draft-mutation:'||v_actor::text||':'||p_client_mutation_id::text,0
  ));
  select command.* into v_command from private.publication_draft_commands command
  where command.owner_id=v_actor and command.client_mutation_id=p_client_mutation_id;
  if found then
    if v_command.operation<>'delete' or v_command.draft_id<>p_draft_id
       or v_command.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='draft_mutation_conflict';
    end if;
    return v_command.result_payload;
  end if;
  select draft.* into v_draft from private.publication_drafts draft
  where draft.id=p_draft_id and draft.owner_id=v_actor for update;
  if not found then raise exception using errcode='P0002',message='publication_draft_not_found'; end if;
  if v_draft.state<>'draft' or v_draft.revision<>p_expected_revision then
    raise exception using errcode='40001',message='publication_draft_revision_conflict';
  end if;
  select pg_catalog.array_agg(link.asset_id order by link.position) into v_old_assets
  from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  delete from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  update private.publication_drafts draft
  set state='deleted',revision=draft.revision+1,deleted_at=pg_catalog.clock_timestamp(),
      updated_at=pg_catalog.clock_timestamp()
  where draft.id=p_draft_id and draft.revision=p_expected_revision
  returning * into v_deleted;
  if not found then raise exception using errcode='40001',message='publication_draft_revision_conflict'; end if;
  v_result:=private.publication_draft_json_v1(v_deleted);
  insert into private.publication_draft_commands(
    owner_id,client_mutation_id,draft_id,operation,request_fingerprint,
    result_revision,result_state,result_payload
  ) values (v_actor,p_client_mutation_id,p_draft_id,'delete',v_fingerprint,
    v_deleted.revision,'deleted',v_result);
  foreach v_asset_id in array coalesce(v_old_assets,'{}'::uuid[]) loop
    perform public.schedule_media_asset_deletion(v_asset_id,v_actor);
  end loop;
  return v_result;
end;
$function$;

create function public.publish_my_media_post_v1(
  p_client_command_id uuid,
  p_kind text,
  p_caption text,
  p_music text,
  p_asset_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid:=auth.uid();
  v_caption text:=pg_catalog.btrim(coalesce(p_caption,''));
  v_music text:=coalesce(nullif(pg_catalog.btrim(coalesce(p_music,'')),''),'Sin musica');
  v_request_fingerprint text;
  v_existing private.publication_receipts;
  v_linked_assets uuid[];
  v_post_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if p_client_command_id is null or p_kind not in ('photo','carousel')
     or pg_catalog.char_length(v_caption)>300 or pg_catalog.char_length(v_music)>300 then
    raise exception using errcode='22023',message='publication_request_invalid';
  end if;
  -- Canonical SHA-256 digest binds normalized text and ordered assets.
  v_request_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('operation','direct','kind',p_kind,'caption',v_caption,
      'music',v_music,'ordered_asset_ids',pg_catalog.to_jsonb(p_asset_ids))::text,'UTF8'
  ),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-command:'||v_actor::text||':'||p_client_command_id::text,0
  ));
  select receipt.* into v_existing from private.publication_receipts receipt
  where receipt.owner_id=v_actor and receipt.client_command_id=p_client_command_id for update;
  if found then
    if v_existing.operation is distinct from 'direct'
       or v_existing.kind is distinct from p_kind
       or v_existing.request_fingerprint is distinct from v_request_fingerprint
       or v_existing.ordered_asset_ids is distinct from p_asset_ids then
      raise exception using errcode='23505',message='publication_receipt_conflict';
    end if;
    select pg_catalog.array_agg(link.asset_id order by link.position) into v_linked_assets
    from public.videos post
    join public.media_asset_links link on link.entity_type='video_post'
      and link.entity_id=post.id and link.slot='media'
    where post.id=v_existing.post_id and post.user_id=v_actor;
    if v_linked_assets is distinct from v_existing.ordered_asset_ids then
      raise exception using errcode='P0002',message='publication_receipt_target_missing';
    end if;
    return v_existing.post_id;
  end if;
  perform private.require_publication_asset_set_v1(v_actor,p_kind,p_asset_ids,'public');
  if p_kind='photo' then
    v_post_id:=public.create_photo_post_with_media(v_caption,v_music,p_asset_ids[1]);
  else
    v_post_id:=public.create_carousel_post(v_caption,v_music,p_asset_ids);
  end if;
  insert into private.publication_receipts(
    owner_id,client_command_id,operation,kind,ordered_asset_ids,request_fingerprint,post_id
  ) values (v_actor,p_client_command_id,'direct',p_kind,p_asset_ids,v_request_fingerprint,v_post_id);
  return v_post_id;
end;
$function$;

create function public.publish_my_publication_draft_v1(
  p_draft_id uuid,
  p_expected_revision bigint,
  p_client_command_id uuid,
  p_public_asset_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid:=auth.uid();
  v_existing private.publication_receipts;
  v_draft private.publication_drafts;
  v_request_fingerprint text;
  v_linked_assets uuid[];
  v_private_assets uuid[];
  v_asset_id uuid;
  v_post_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if p_draft_id is null or p_expected_revision is null or p_expected_revision<1
     or p_client_command_id is null then
    raise exception using errcode='22023',message='publication_request_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-command:'||v_actor::text||':'||p_client_command_id::text,0
  ));
  select receipt.* into v_existing from private.publication_receipts receipt
  where receipt.owner_id=v_actor and receipt.client_command_id=p_client_command_id for update;
  if found then
    if v_existing.operation is distinct from 'draft'
       or v_existing.draft_id is distinct from p_draft_id
       or v_existing.draft_revision is distinct from p_expected_revision
       or v_existing.ordered_asset_ids is distinct from p_public_asset_ids then
      raise exception using errcode='23505',message='publication_receipt_conflict';
    end if;
    select pg_catalog.array_agg(link.asset_id order by link.position) into v_linked_assets
    from public.videos post
    join public.media_asset_links link on link.entity_type='video_post'
      and link.entity_id=post.id and link.slot='media'
    where post.id=v_existing.post_id and post.user_id=v_actor;
    if v_linked_assets is distinct from v_existing.ordered_asset_ids then
      raise exception using errcode='P0002',message='publication_receipt_target_missing';
    end if;
    return v_existing.post_id;
  end if;
  select draft.* into v_draft from private.publication_drafts draft
  where draft.id=p_draft_id and draft.owner_id=v_actor for update;
  if not found then raise exception using errcode='P0002',message='publication_draft_not_found'; end if;
  if v_draft.state<>'draft' or v_draft.revision<>p_expected_revision then
    raise exception using errcode='40001',message='publication_draft_revision_conflict';
  end if;
  perform private.require_publication_asset_set_v1(v_actor,v_draft.kind,p_public_asset_ids,'public');
  if (
    select pg_catalog.count(*)
    from public.media_assets asset
    where asset.id = any(p_public_asset_ids)
      and asset.visibility = 'public'
      and asset.status = 'ready'
  ) <> pg_catalog.cardinality(p_public_asset_ids) then
    raise exception using errcode='42501',message='publication_asset_not_ready_or_owned';
  end if;
  v_request_fingerprint:=private.publication_draft_payload_fingerprint_v1(
    'publish',v_draft.kind,v_draft.caption,v_draft.music,v_draft.composition,
    p_public_asset_ids,p_expected_revision,p_draft_id
  );
  if v_draft.kind='photo' then
    v_post_id:=public.create_photo_post_with_media(v_draft.caption,v_draft.music,p_public_asset_ids[1]);
  else
    v_post_id:=public.create_carousel_post(v_draft.caption,v_draft.music,p_public_asset_ids);
  end if;
  insert into private.publication_receipts(
    owner_id,client_command_id,operation,kind,draft_id,draft_revision,
    ordered_asset_ids,request_fingerprint,post_id
  ) values (
    v_actor,p_client_command_id,'draft',v_draft.kind,p_draft_id,p_expected_revision,
    p_public_asset_ids,v_request_fingerprint,v_post_id
  );
  select pg_catalog.array_agg(link.asset_id order by link.position) into v_private_assets
  from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  delete from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  update private.publication_drafts draft
  set state='published',published_post_id=v_post_id,published_at=pg_catalog.clock_timestamp(),
      revision=draft.revision+1,updated_at=pg_catalog.clock_timestamp()
  where draft.id=p_draft_id and draft.revision=p_expected_revision;
  if not found then raise exception using errcode='40001',message='publication_draft_revision_conflict'; end if;
  foreach v_asset_id in array coalesce(v_private_assets,'{}'::uuid[]) loop
    perform public.schedule_media_asset_deletion(v_asset_id,v_actor);
  end loop;
  return v_post_id;
end;
$function$;

revoke all on function public.create_my_publication_draft_v1(uuid,text,text,text,jsonb,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_publication_draft_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_publication_drafts_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_my_publication_draft_v1(uuid,bigint,uuid,text,text,text,jsonb,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.delete_my_publication_draft_v1(uuid,bigint,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_my_media_post_v1(uuid,text,text,text,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.publish_my_publication_draft_v1(uuid,bigint,uuid,uuid[])
  from public, anon, authenticated, service_role;

grant execute on function public.create_my_publication_draft_v1(uuid,text,text,text,jsonb,uuid[])
  to authenticated;
grant execute on function public.get_my_publication_draft_v1(uuid)
  to authenticated;
grant execute on function public.list_my_publication_drafts_v1(integer,timestamptz,uuid)
  to authenticated;
grant execute on function public.update_my_publication_draft_v1(uuid,bigint,uuid,text,text,text,jsonb,uuid[])
  to authenticated;
grant execute on function public.delete_my_publication_draft_v1(uuid,bigint,uuid)
  to authenticated;
grant execute on function public.publish_my_media_post_v1(uuid,text,text,text,uuid[])
  to authenticated;
grant execute on function public.publish_my_publication_draft_v1(uuid,bigint,uuid,uuid[])
  to authenticated;

commit;

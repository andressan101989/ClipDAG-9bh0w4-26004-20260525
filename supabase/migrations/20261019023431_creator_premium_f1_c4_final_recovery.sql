begin;

alter table private.creator_premium_plans
  add column creator_deleted_at timestamptz;

comment on column private.creator_premium_plans.creator_deleted_at is
  'Creator-panel tombstone. Financial, entitlement, mapping, and audit history remain intact.';

create index creator_premium_plans_creator_visible_idx
  on private.creator_premium_plans(creator_id,created_at desc,id desc)
  where creator_deleted_at is null;

create or replace function public.delete_my_creator_premium_draft_v1(p_content_id uuid)
returns table (
  content_id uuid,
  lifecycle_status text,
  r2_assets_scheduled integer,
  video_assets_scheduled integer,
  cleanup_scheduled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_media_ids uuid[] := '{}'::uuid[];
  v_video_ids uuid[] := '{}'::uuid[];
  v_asset_id uuid;
  v_cleanup_result text;
  v_r2_count integer := 0;
  v_video_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_content';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:' || p_content_id::text, 0)
  );
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status = 'deleted' then
    return query select v_content.id, v_content.lifecycle_status, 0, 0, false;
    return;
  end if;
  if v_content.lifecycle_status = 'published' then
    raise exception using errcode = '55000', message = 'creator_premium_content_retire_first';
  end if;
  if v_content.lifecycle_status in ('draft','pending_review','rejected','removed','deleted') then
    null;
  else
    raise exception using errcode = '55000', message = 'creator_premium_content_delete_forbidden';
  end if;
  if private.creator_premium_content_has_financial_history(v_content.id) then
    raise exception using errcode = '55000', message = 'creator_premium_content_has_financial_history';
  end if;

  select coalesce(pg_catalog.array_agg(link.asset_id order by link.asset_id), '{}'::uuid[])
  into v_media_ids
  from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;

  select coalesce(pg_catalog.array_agg(link.asset_id order by link.asset_id), '{}'::uuid[])
  into v_video_ids
  from public.video_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;

  -- Draft mappings are mutable and disappear with the draft. Published plan
  -- versions keep their historical mapping rows, while the content tombstone
  -- and entitlement checks prevent new exposure.
  delete from private.creator_premium_plan_contents mapping
  using private.creator_premium_plans plan
  where mapping.plan_id = plan.id
    and mapping.content_id = v_content.id
    and mapping.creator_id = v_actor
    and plan.creator_id = v_actor
    and plan.status = 'draft';

  delete from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;
  delete from public.video_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = v_content.id;

  foreach v_asset_id in array v_media_ids loop
    v_cleanup_result := public.schedule_media_asset_deletion(v_asset_id, v_actor);
    if v_cleanup_result not in ('scheduled','deleted') then
      raise exception using errcode = '55000', message = 'creator_premium_content_cleanup_failed';
    end if;
    if v_cleanup_result = 'scheduled' then v_r2_count := v_r2_count + 1; end if;
  end loop;

  foreach v_asset_id in array v_video_ids loop
    v_cleanup_result := private.schedule_creator_premium_video_deletion_v1(v_asset_id, v_actor);
    if v_cleanup_result not in ('scheduled','deleted') then
      raise exception using errcode = '55000', message = 'creator_premium_content_cleanup_failed';
    end if;
    if v_cleanup_result = 'scheduled' then v_video_count := v_video_count + 1; end if;
  end loop;

  update private.creator_premium_offer_versions offer
  set status = 'retired',
      retired_at = coalesce(offer.retired_at, v_now),
      updated_at = v_now
  where offer.content_id = v_content.id
    and offer.creator_id = v_actor
    and offer.status = 'active';

  update private.creator_premium_contents content
  set lifecycle_status = 'deleted',
      deleted_at = coalesce(content.deleted_at, v_now),
      verification_generation = content.verification_generation + 1,
      updated_at = v_now
  where content.id = v_content.id
  returning content.* into v_content;

  return query select v_content.id, v_content.lifecycle_status,
    v_r2_count, v_video_count, (v_r2_count + v_video_count) > 0;
end;
$$;

create or replace function public.delete_my_creator_premium_plan_draft_v1(
  p_plan_id uuid,
  p_client_request_id uuid
)
returns table (
  id uuid,
  status text,
  deleted boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan private.creator_premium_plans;
  v_command public.idempotency_keys;
  v_fingerprint text;
  v_response jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null or p_client_request_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_plan_delete_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', 'creator_premium_plan_delete', v_actor::text, p_plan_id::text),
    'sha256'
  ), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-delete-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );
  select command.* into v_command
  from public.idempotency_keys command
  where command.idempotency_key = p_client_request_id::text
    and command.operation_type = 'creator_premium_plan_delete'
    and command.user_id = v_actor
  for update;
  if found then
    if v_command.request_hash is distinct from v_fingerprint
       or v_command.status <> 'completed'
       or v_command.response_body is null then
      raise exception using errcode = '23505', message = 'creator_premium_plan_delete_idempotency_conflict';
    end if;
    return query select
      (v_command.response_body ->> 'id')::uuid,
      v_command.response_body ->> 'status',
      true,
      true;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-plan:' || p_plan_id::text, 0)
  );
  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_plan.creator_deleted_at is not null then
    v_response := pg_catalog.jsonb_build_object('id',v_plan.id,'status','deleted','deleted',true);
  elsif v_plan.status = 'active' then
    raise exception using errcode = '55000', message = 'creator_premium_plan_retire_first';
  elsif v_plan.status = 'draft' then
    if private.creator_premium_plan_has_dependencies(v_plan.id) then
      raise exception using errcode = '55000', message = 'creator_premium_plan_has_dependencies';
    end if;
    delete from private.creator_premium_plans plan
    where plan.id = v_plan.id and plan.creator_id = v_actor;
    v_response := pg_catalog.jsonb_build_object('id',v_plan.id,'status','deleted','deleted',true);
  elsif v_plan.status = 'retired' then
    update private.creator_premium_plans plan
    set creator_deleted_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where plan.id = v_plan.id and plan.creator_id = v_actor;
    v_response := pg_catalog.jsonb_build_object('id',v_plan.id,'status','deleted','deleted',true);
  else
    raise exception using errcode = '55000', message = 'creator_premium_plan_delete_forbidden';
  end if;

  insert into public.idempotency_keys(
    idempotency_key, operation_type, user_id, request_hash, status, response_body
  ) values (
    p_client_request_id::text,
    'creator_premium_plan_delete',
    v_actor,
    v_fingerprint,
    'completed',
    v_response
  );
  return query select v_plan.id, 'deleted'::text, true, false;
end;
$$;

create or replace function public.get_my_creator_premium_plans_v1(
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  name text,
  description text,
  price_bdag text,
  billing_period_days integer,
  version integer,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  mapped_content_count bigint,
  mapped_content_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  return query
  select plan.id, plan.name, plan.description, plan.price_bdag::text,
    plan.billing_period_days, plan.version, plan.status, plan.created_at,
    plan.updated_at, plan.activated_at, plan.retired_at,
    mapped.count, mapped.ids
  from private.creator_premium_plans plan
  left join lateral (
    select count(*)::bigint as count,
      coalesce(pg_catalog.array_agg(mapping.content_id order by mapping.content_id), '{}'::uuid[]) as ids
    from private.creator_premium_plan_contents mapping
    where mapping.plan_id = plan.id
      and mapping.creator_id = plan.creator_id
  ) mapped on true
  where plan.creator_id = v_actor
    and plan.creator_deleted_at is null
    and (
      p_cursor_created_at is null
      or (plan.created_at, plan.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by plan.created_at desc, plan.id desc
  limit p_limit;
end;
$$;

create or replace function public.clone_my_creator_premium_plan_version_v1(
  p_plan_id uuid,
  p_client_request_id uuid
) returns table (
  id uuid,
  name text,
  description text,
  price_bdag text,
  billing_period_days integer,
  version integer,
  status text,
  mapped_content_count bigint,
  created_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source private.creator_premium_plans;
  v_existing private.creator_premium_plans;
  v_inserted private.creator_premium_plans;
  v_plan_key text;
  v_fingerprint text;
  v_next_version integer;
  v_mapped_count bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null or p_client_request_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_plan_clone_invalid';
  end if;
  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', 'creator_premium_plan_clone', v_actor::text, p_plan_id::text),
    'sha256'
  ), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );
  select plan.* into v_existing
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.client_request_id = p_client_request_id;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'creator_premium_plan_idempotency_conflict';
    end if;
    select count(*) into v_mapped_count
    from private.creator_premium_plan_contents mapping
    where mapping.plan_id = v_existing.id;
    return query select v_existing.id, v_existing.name, v_existing.description,
      v_existing.price_bdag::text, v_existing.billing_period_days, v_existing.version,
      v_existing.status, v_mapped_count, v_existing.created_at, true;
    return;
  end if;
  select plan.plan_key into v_plan_key
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
    and plan.creator_deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-version:' || v_actor::text || ':' || v_plan_key,
      0
    )
  );
  select plan.* into v_source
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
    and plan.creator_deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_source.status not in ('active','retired') then
    raise exception using errcode = '55000', message = 'creator_premium_plan_clone_source_invalid';
  end if;
  perform plan.id
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.plan_key = v_source.plan_key
  order by plan.id
  for update;
  select coalesce(max(plan.version), 0) + 1 into v_next_version
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.plan_key = v_source.plan_key;
  insert into private.creator_premium_plans(
    creator_id, plan_key, version, name, description, price_bdag, currency,
    billing_period_days, status, client_request_id, request_fingerprint
  ) values (
    v_actor, v_source.plan_key, v_next_version, v_source.name, v_source.description,
    v_source.price_bdag, v_source.currency, v_source.billing_period_days, 'draft',
    p_client_request_id, v_fingerprint
  ) returning * into v_inserted;
  insert into private.creator_premium_plan_contents(plan_id, content_id, creator_id)
  select v_inserted.id, mapping.content_id, v_actor
  from private.creator_premium_plan_contents mapping
  where mapping.plan_id = v_source.id
    and mapping.creator_id = v_actor;
  get diagnostics v_mapped_count = row_count;
  return query select v_inserted.id, v_inserted.name, v_inserted.description,
    v_inserted.price_bdag::text, v_inserted.billing_period_days, v_inserted.version,
    v_inserted.status, v_mapped_count, v_inserted.created_at, false;
end;
$$;

create or replace function public.get_my_creator_premium_contents_v1(
  p_limit integer default 24,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,title text,description text,content_kind text,access_mode text,
  lifecycle_status text,published_at timestamptz,quarantined_at timestamptz,
  removed_at timestamptz,deleted_at timestamptz,removal_reason text,
  submitted_at timestamptz,reviewed_at timestamptz,reviewed_by uuid,review_reason text,
  verification_status text,verification_error_code text,
  verification_requested_at timestamptz,verification_completed_at timestamptz,
  created_at timestamptz,updated_at timestamptz,teaser_url text,
  teaser_attached boolean,original_attached boolean,image_media_ready boolean,
  video_attached boolean,video_media_ready boolean,active_offer_version integer,
  price_bdag text,mapped_plan_count bigint,active_plan_count bigint,
  submission_ready boolean,submission_blocker text
)
language plpgsql stable security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null then raise exception using errcode='42501',message='creator_premium_auth_required';end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode='22023',message='creator_premium_invalid_limit';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023',message='creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  return query select
    content.id,content.title,content.description,content.content_kind,content.access_mode,
    content.lifecycle_status,content.published_at,content.quarantined_at,content.removed_at,
    content.deleted_at,content.removal_reason,content.submitted_at,content.reviewed_at,
    content.reviewed_by,content.review_reason,content.verification_status,
    content.verification_error_code,content.verification_requested_at,
    content.verification_completed_at,content.created_at,content.updated_at,
    private.creator_premium_teaser_url_v1(content.id),
    private.creator_premium_teaser_url_v1(content.id) is not null,
    media.original_attached,
    content.content_kind='image' and private.creator_premium_image_is_ready_v1(content.id),
    video.video_attached,
    content.content_kind='video' and private.creator_premium_video_is_ready_v1(content.id),
    offer.version,offer.price_bdag::text,plans.mapped_plan_count,plans.active_plan_count,
    (content.lifecycle_status='draft' and blocker.value is null)
      or (content.lifecycle_status='pending_review' and (
        content.verification_status='failed'
        or (content.verification_status='not_requested'
          and content.verification_error_code='creator_premium_legacy_reverification_required')
      )),
    case
      when content.lifecycle_status='draft' then blocker.value
      when content.lifecycle_status='pending_review' and (
        content.verification_status='failed'
        or (content.verification_status='not_requested'
          and content.verification_error_code='creator_premium_legacy_reverification_required')
      ) then content.verification_error_code
      else 'creator_premium_draft_only'
    end
  from private.creator_premium_contents content
  left join lateral (
    select exists(
      select 1 from public.media_asset_links link
      join public.media_assets asset on asset.id=link.asset_id
      where link.entity_type='creator_premium_content' and link.entity_id=content.id
        and link.slot='original' and link."position"=0
        and asset.owner_id=content.creator_id
        and asset.purpose='creator_premium_original_image'
        and asset.visibility='private' and asset.status='ready' and asset.public_url is null
    ) original_attached
  ) media on true
  left join lateral (
    select exists(
      select 1 from public.video_asset_links link
      join public.video_assets asset on asset.id=link.asset_id
      where link.entity_type='creator_premium_content' and link.entity_id=content.id
        and link.slot='original' and link."position"=0
        and asset.owner_id=content.creator_id
        and asset.purpose='creator_premium_video' and asset.visibility='private'
    ) video_attached
  ) video on true
  left join lateral (
    select active_offer.version,active_offer.price_bdag
    from private.creator_premium_offer_versions active_offer
    where active_offer.content_id=content.id and active_offer.creator_id=content.creator_id
      and active_offer.status='active'
    order by active_offer.version desc limit 1
  ) offer on true
  left join lateral (
    select pg_catalog.count(*)::bigint mapped_plan_count,
      pg_catalog.count(*) filter(where plan.status='active')::bigint active_plan_count
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_plans plan on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
    where mapping.content_id=content.id and mapping.creator_id=content.creator_id
  ) plans on true
  left join lateral (
    select private.creator_premium_submission_blocker_v1(content.id) value
  ) blocker on true
  where content.creator_id=v_actor
    and content.lifecycle_status <> 'deleted'
    and (p_cursor_created_at is null
      or (content.created_at,content.id)<(p_cursor_created_at,p_cursor_id))
  order by content.created_at desc,content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.delete_my_creator_premium_draft_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_my_creator_premium_draft_v1(uuid)
  to authenticated;
revoke all on function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid)
  to authenticated;
revoke all on function public.get_my_creator_premium_plans_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_plans_v1(integer,timestamptz,uuid)
  to authenticated;
revoke all on function public.clone_my_creator_premium_plan_version_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.clone_my_creator_premium_plan_version_v1(uuid,uuid)
  to authenticated;
revoke all on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  to authenticated;

-- The security-definer content deletion authority may remove only mutable
-- draft mappings. Keep this internal to the postgres function owner; clients
-- and service_role retain no direct table access.
grant delete on table private.creator_premium_plan_contents to postgres;

alter function public.delete_my_creator_premium_draft_v1(uuid) owner to postgres;
alter function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid) owner to postgres;

comment on function public.delete_my_creator_premium_draft_v1(uuid) is
  'Canonical creator content deletion authority. Published content must be retired first; acquired rights block deletion.';
comment on function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid) is
  'Canonical idempotent creator plan deletion authority: physical for dependency-free drafts, creator tombstone for retired history.';

notify pgrst, 'reload schema';

commit;

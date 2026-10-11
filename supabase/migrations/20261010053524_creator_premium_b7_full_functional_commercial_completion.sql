begin;

-- CREATOR-PREMIUM-B7
-- Complete the already-canonical Premium domain with automatic publication
-- after canonical Content Safety verification, exception moderation,
-- safe consumer commerce projections, administrative refund orchestration,
-- creator earnings/analytics, and report-center integration.
--
-- This migration deliberately does not enable finance, choose a commission,
-- create a balance authority, publish a production fixture, or expose private
-- media locators. All product finance switches retain their B4 values.

alter table private.creator_premium_contents
  add column submitted_at timestamptz,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid,
  add column review_reason text,
  add column verification_generation bigint not null default 0,
  add column verification_scan_id uuid,
  add column verification_fingerprint text,
  add column verification_status text not null default 'not_requested',
  add column verification_error_code text,
  add column verification_requested_at timestamptz,
  add column verification_completed_at timestamptz;

alter table private.creator_premium_contents
  add constraint creator_premium_contents_reviewed_by_fkey
    foreign key (reviewed_by) references auth.users(id)
    on update restrict on delete restrict,
  add constraint creator_premium_contents_verification_scan_id_fkey
    foreign key (verification_scan_id) references private.content_safety_scans(id)
    on update restrict on delete restrict,
  add constraint creator_premium_contents_verification_status_check
    check (verification_status in (
      'not_requested','pending','passed','blocked','restricted','failed'
    )),
  add constraint creator_premium_contents_verification_generation_check
    check (verification_generation >= 0),
  add constraint creator_premium_contents_verification_fingerprint_check
    check (
      verification_fingerprint is null
      or verification_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint creator_premium_contents_verification_error_check
    check (
      verification_error_code is null
      or (
        verification_error_code = pg_catalog.btrim(verification_error_code)
        and verification_error_code ~ '^[a-z][a-z0-9_]{1,99}$'
      )
    ),
  add constraint creator_premium_contents_verification_binding_check
    check (
      (verification_status = 'not_requested'
        and verification_scan_id is null
        and verification_fingerprint is null
        and verification_requested_at is null
        and verification_completed_at is null)
      or (verification_status = 'pending'
        and verification_scan_id is not null
        and verification_fingerprint is not null
        and verification_requested_at is not null
        and verification_completed_at is null)
      or (verification_status in ('passed','blocked','restricted','failed')
        and verification_scan_id is not null
        and verification_fingerprint is not null
        and verification_requested_at is not null
        and verification_completed_at is not null)
    ),
  add constraint creator_premium_contents_review_reason_check
    check (
      review_reason is null
      or (
        review_reason = pg_catalog.btrim(review_reason)
        and pg_catalog.char_length(review_reason) between 2 and 1000
      )
    );

create index creator_premium_contents_reviewed_by_idx
  on private.creator_premium_contents(reviewed_by)
  where reviewed_by is not null;

create index creator_premium_contents_verification_scan_idx
  on private.creator_premium_contents(verification_scan_id)
  where verification_scan_id is not null;

create index creator_premium_contents_verification_queue_idx
  on private.creator_premium_contents(verification_status, verification_requested_at, id)
  where lifecycle_status = 'pending_review';

create index creator_premium_contents_review_queue_idx
  on private.creator_premium_contents(lifecycle_status, submitted_at desc, id desc)
  where lifecycle_status in ('pending_review','published','rejected','quarantined','removed');

alter table private.creator_premium_contents
  drop constraint creator_premium_contents_lifecycle_check,
  drop constraint creator_premium_contents_state_check;

alter table private.creator_premium_contents
  add constraint creator_premium_contents_lifecycle_check
    check (lifecycle_status in (
      'draft','pending_review','published','rejected','quarantined','removed','deleted'
    )),
  add constraint creator_premium_contents_state_check check (
    (lifecycle_status = 'draft'
      and published_at is null and quarantined_at is null and removed_at is null
      and deleted_at is null and submitted_at is null and reviewed_at is null
      and reviewed_by is null and review_reason is null
      and verification_status = 'not_requested')
    or (lifecycle_status = 'pending_review'
      and published_at is null and quarantined_at is null and removed_at is null
      and deleted_at is null and submitted_at is not null and reviewed_at is null
      and reviewed_by is null and review_reason is null
      and verification_status in ('pending','failed'))
    or (lifecycle_status = 'published'
      and published_at is not null and quarantined_at is null and removed_at is null
      and deleted_at is null and submitted_at is not null
      and verification_status = 'passed')
    or (lifecycle_status = 'rejected'
      and published_at is null and quarantined_at is null and removed_at is null
      and deleted_at is null and submitted_at is not null
      and verification_status = 'blocked' and review_reason is not null)
    or (lifecycle_status = 'quarantined'
      and quarantined_at is not null and removed_at is null and deleted_at is null
      and submitted_at is not null and review_reason is not null
      and verification_status in ('restricted','passed'))
    or (lifecycle_status = 'removed'
      and removed_at is not null and deleted_at is null and submitted_at is not null
      and reviewed_at is not null and reviewed_by is not null
      and review_reason is not null)
    or (lifecycle_status = 'deleted' and deleted_at is not null)
  );

alter table private.content_safety_scans
  drop constraint content_safety_scans_target_check,
  add constraint content_safety_scans_target_check
    check (target_type in (
      'video','comment','story','live_message','message','creator_premium'
    ));

alter table private.content_safety_alerts
  drop constraint content_safety_alerts_target_check,
  add constraint content_safety_alerts_target_check
    check (target_type in (
      'video','comment','story','live_message','message','creator_premium'
    ));

alter table private.content_safety_rules
  drop constraint content_safety_rules_scopes_check,
  add constraint content_safety_rules_scopes_check check (
    pg_catalog.cardinality(scopes) > 0
    and pg_catalog.array_position(scopes, null::text) is null
    and scopes <@ array[
      'video_caption','comment','story_text','live_chat','reported_message',
      'transcript','creator_premium_text'
    ]::text[]
  );

insert into private.admin_capabilities(
  capability_code, domain, effect, description, is_sensitive
) values
  ('creator_premium.review.read','creator_premium','read',
   'Read bounded Creator Premium moderation projections and temporary review media.',true),
  ('creator_premium.review.moderate','creator_premium','workflow',
   'Perform audited Creator Premium lifecycle decisions.',true),
  ('creator_premium.refunds.write','creator_premium','write',
   'Execute an audited full Creator Premium refund through the canonical B4 authority.',true)
on conflict (capability_code) do nothing;

insert into private.admin_role_capabilities(role_code, capability_code) values
  ('SUPER_ADMIN','creator_premium.review.read'),
  ('SUPER_ADMIN','creator_premium.review.moderate')
on conflict (role_code, capability_code) do nothing;

insert into private.admin_role_capabilities(role_code, capability_code) values
  ('PLATFORM_ADMIN','creator_premium.review.read'),
  ('PLATFORM_ADMIN','creator_premium.review.moderate')
on conflict (role_code, capability_code) do nothing;

insert into private.admin_role_capabilities(role_code, capability_code) values
  ('MODERATOR','creator_premium.review.read'),
  ('MODERATOR','creator_premium.review.moderate')
on conflict (role_code, capability_code) do nothing;

-- creator_premium.refunds.write is intentionally assigned to no role. A later,
-- separately authorized control-plane action must grant that sensitive ability.

create function private.creator_premium_publication_blocker_v1(p_content_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_content private.creator_premium_contents;
begin
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id;

  if not found then return 'creator_premium_content_not_found'; end if;
  if v_content.lifecycle_status <> 'pending_review' then
    return 'creator_premium_content_not_pending_review';
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(v_content.creator_id) then
    return 'creator_premium_creator_age_ineligible';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    return 'creator_premium_creator_account_restricted';
  end if;
  if v_content.content_kind = 'image'
     and not private.creator_premium_image_is_ready_v1(v_content.id) then
    return 'creator_premium_image_media_not_ready';
  end if;
  if v_content.content_kind = 'video'
     and not private.creator_premium_video_is_ready_v1(v_content.id) then
    return 'creator_premium_video_media_not_ready';
  end if;
  if v_content.access_mode in ('purchase','purchase_or_subscription')
     and not exists (
       select 1
       from private.creator_premium_offer_versions offer
       where offer.content_id = v_content.id
         and offer.creator_id = v_content.creator_id
         and offer.status = 'active'
         and offer.currency = 'BDAG'
         and offer.price_bdag > 0
     ) then
    return 'creator_premium_active_offer_required';
  end if;
  if v_content.access_mode in ('subscription','purchase_or_subscription')
     and not exists (
       select 1
       from private.creator_premium_plan_contents mapping
       join private.creator_premium_plans plan
         on plan.id = mapping.plan_id
        and plan.creator_id = mapping.creator_id
       where mapping.content_id = v_content.id
         and mapping.creator_id = v_content.creator_id
         and plan.status = 'active'
         and plan.currency = 'BDAG'
         and plan.price_bdag > 0
     ) then
    return 'creator_premium_active_plan_required';
  end if;
  return null;
end;
$$;

create or replace function public.submit_my_creator_premium_content_for_review_v1(
  p_content_id uuid
) returns table (
  content_id uuid,
  lifecycle_status text,
  submission_ready boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_blocker text;
  v_scan_id uuid;
  v_fingerprint text;
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
  where content.id = p_content_id and content.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status='pending_review' and v_content.verification_status='pending' then
    return query select v_content.id,v_content.lifecycle_status,true;
    return;
  end if;
  if v_content.lifecycle_status not in ('draft','pending_review')
     or (v_content.lifecycle_status='pending_review' and v_content.verification_status<>'failed') then
    raise exception using errcode='55000',message='creator_premium_publication_request_invalid_state';
  end if;
  if v_content.lifecycle_status='draft' then
    v_blocker:=private.creator_premium_submission_blocker_v1(v_content.id);
  else
    -- A failed scan may be retried only after the still-current media and
    -- commercial facts are ready. The retry always advances the generation so
    -- a completed/failed scan can never be recycled as fresh publication proof.
    v_blocker:=private.creator_premium_publication_blocker_v1(v_content.id);
  end if;
  if v_blocker is not null then
    raise exception using errcode='55000',message=v_blocker;
  end if;

  update private.creator_premium_contents content
  set verification_generation=content.verification_generation+1,
      updated_at=pg_catalog.clock_timestamp()
  where content.id=v_content.id
  returning content.* into v_content;

  v_scan_id:=private.enqueue_content_safety_scan(
    'creator_premium',v_content.id,
    case when v_content.lifecycle_status='draft' then 'content_created' else 'retry' end
  );
  if v_scan_id is null then
    raise exception using errcode='55000',message='creator_premium_safety_scan_unavailable';
  end if;
  select scan.content_fingerprint into v_fingerprint
  from private.content_safety_scans scan where scan.id=v_scan_id;
  if v_fingerprint is null then
    raise exception using errcode='55000',message='creator_premium_safety_fingerprint_unavailable';
  end if;
  update private.creator_premium_contents content
  set lifecycle_status = 'pending_review',
      submitted_at = coalesce(content.submitted_at,pg_catalog.clock_timestamp()),
      reviewed_at = null,
      reviewed_by = null,
      review_reason = null,
      removal_reason = null,
      verification_scan_id=v_scan_id,
      verification_fingerprint=v_fingerprint,
      verification_status='pending',
      verification_error_code=null,
      verification_requested_at=pg_catalog.clock_timestamp(),
      verification_completed_at=null,
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

  begin
    perform public.wake_content_safety_scanner();
  exception when others then
    null;
  end;

  return query select v_content.id, v_content.lifecycle_status, true;
end;
$$;

-- Extend the canonical B5 owner list in place so moderation feedback reaches
-- only the owning creator. No private media locator is added to the projection.
drop function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid);

create function public.get_my_creator_premium_contents_v1(
  p_limit integer default 24,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  lifecycle_status text,
  published_at timestamptz,
  quarantined_at timestamptz,
  removed_at timestamptz,
  deleted_at timestamptz,
  removal_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_reason text,
  verification_status text,
  verification_error_code text,
  verification_requested_at timestamptz,
  verification_completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  teaser_url text,
  teaser_attached boolean,
  original_attached boolean,
  image_media_ready boolean,
  video_attached boolean,
  video_media_ready boolean,
  active_offer_version integer,
  price_bdag text,
  mapped_plan_count bigint,
  active_plan_count bigint,
  submission_ready boolean,
  submission_blocker text
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
  select
    content.id,
    content.title,
    content.description,
    content.content_kind,
    content.access_mode,
    content.lifecycle_status,
    content.published_at,
    content.quarantined_at,
    content.removed_at,
    content.deleted_at,
    content.removal_reason,
    content.submitted_at,
    content.reviewed_at,
    content.reviewed_by,
    content.review_reason,
    content.verification_status,
    content.verification_error_code,
    content.verification_requested_at,
    content.verification_completed_at,
    content.created_at,
    content.updated_at,
    private.creator_premium_teaser_url_v1(content.id),
    private.creator_premium_teaser_url_v1(content.id) is not null,
    media.original_attached,
    content.content_kind = 'image'
      and private.creator_premium_image_is_ready_v1(content.id),
    video.video_attached,
    content.content_kind = 'video'
      and private.creator_premium_video_is_ready_v1(content.id),
    offer.version,
    offer.price_bdag::text,
    plans.mapped_plan_count,
    plans.active_plan_count,
    (content.lifecycle_status = 'draft' and blocker.value is null)
      or (content.lifecycle_status='pending_review' and content.verification_status='failed'),
    case
      when content.lifecycle_status='draft' then blocker.value
      when content.lifecycle_status='pending_review' and content.verification_status='failed'
        then content.verification_error_code
      else 'creator_premium_draft_only'
    end
  from private.creator_premium_contents content
  left join lateral (
    select exists (
      select 1
      from public.media_asset_links link
      join public.media_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = content.id
        and link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_original_image'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and asset.public_url is null
    ) as original_attached
  ) media on true
  left join lateral (
    select exists (
      select 1
      from public.video_asset_links link
      join public.video_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = content.id
        and link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_video'
        and asset.visibility = 'private'
    ) as video_attached
  ) video on true
  left join lateral (
    select active_offer.version, active_offer.price_bdag
    from private.creator_premium_offer_versions active_offer
    where active_offer.content_id = content.id
      and active_offer.creator_id = content.creator_id
      and active_offer.status = 'active'
    limit 1
  ) offer on true
  left join lateral (
    select
      pg_catalog.count(*)::bigint as mapped_plan_count,
      pg_catalog.count(*) filter (where plan.status = 'active')::bigint
        as active_plan_count
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_plans plan
      on plan.id = mapping.plan_id
     and plan.creator_id = mapping.creator_id
    where mapping.content_id = content.id
      and mapping.creator_id = content.creator_id
  ) plans on true
  left join lateral (
    select private.creator_premium_submission_blocker_v1(content.id) as value
  ) blocker on true
  where content.creator_id = v_actor
    and (
      p_cursor_created_at is null
      or (content.created_at, content.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by content.created_at desc, content.id desc
  limit p_limit;
end;
$$;

drop function public.get_my_creator_premium_content_v1(uuid);

create function public.get_my_creator_premium_content_v1(p_content_id uuid)
returns table (
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
  if p_content_id is null then raise exception using errcode='22023',message='creator_premium_content_invalid';end if;
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
      or (content.lifecycle_status='pending_review' and content.verification_status='failed'),
    case
      when content.lifecycle_status='draft' then blocker.value
      when content.lifecycle_status='pending_review' and content.verification_status='failed'
        then content.verification_error_code
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
  where content.id=p_content_id and content.creator_id=v_actor;
  if not found then raise exception using errcode='P0002',message='creator_premium_content_not_found';end if;
end;
$$;

create function public.reopen_my_creator_premium_rejected_v1(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
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
  where content.id = p_content_id and content.creator_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'rejected' then
    raise exception using errcode = '55000', message = 'creator_premium_rejected_only';
  end if;
  if exists (
    select 1 from private.creator_premium_purchase_receipts receipt
    where receipt.content_id = v_content.id
  ) then
    raise exception using errcode = '55000', message = 'creator_premium_rejected_has_financial_history';
  end if;

  update private.creator_premium_contents content
  set lifecycle_status = 'draft', submitted_at = null, reviewed_at = null,
      reviewed_by = null, review_reason = null, published_at = null,
      quarantined_at = null, removed_at = null, removal_reason = null,
      verification_scan_id = null, verification_fingerprint = null,
      verification_status = 'not_requested', verification_error_code = null,
      verification_requested_at = null, verification_completed_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

  return pg_catalog.jsonb_build_object(
    'content_id', v_content.id,
    'lifecycle_status', v_content.lifecycle_status,
    'updated_at', v_content.updated_at
  );
end;
$$;

create function public.search_admin_creator_premium_content_v1(
  p_status text default 'pending_review',
  p_query text default null,
  p_cursor_submitted_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := pg_catalog.nullif(pg_catalog.btrim(p_query), '');
  v_limit integer := pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform public.admin_require_capability('creator_premium.review.read');
  if p_status is not null and p_status not in (
    'pending_review','published','rejected','quarantined','removed'
  ) then
    raise exception using errcode = '22023', message = 'creator_premium_admin_status_invalid';
  end if;
  if v_query is not null and pg_catalog.char_length(v_query) > 120 then
    raise exception using errcode = '22023', message = 'creator_premium_admin_query_invalid';
  end if;
  if (p_cursor_submitted_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_admin_cursor_invalid';
  end if;

  return coalesce((
    with page as (
      select
        content.id, content.creator_id, content.title, content.description,
        content.content_kind, content.access_mode, content.lifecycle_status,
        content.submitted_at, content.reviewed_at, content.reviewed_by,
        content.review_reason, content.published_at, content.quarantined_at,
        content.removed_at, content.created_at, content.updated_at,
        content.verification_status, content.verification_error_code,
        content.verification_requested_at, content.verification_completed_at,
        profile.username, profile.display_name, profile.avatar_url,
        private.creator_premium_teaser_url_v1(content.id) as teaser_url,
        case
          when content.content_kind = 'image'
            then private.creator_premium_image_is_ready_v1(content.id)
          when content.content_kind = 'video'
            then private.creator_premium_video_is_ready_v1(content.id)
          else false
        end as media_ready,
        private.creator_premium_publication_blocker_v1(content.id) as publication_blocker
      from private.creator_premium_contents content
      left join public.public_user_profiles profile on profile.id = content.creator_id
      where content.lifecycle_status in ('pending_review','published','rejected','quarantined','removed')
        and content.submitted_at is not null
        and (p_status is null or content.lifecycle_status = p_status)
        and (
          v_query is null or content.id::text = v_query or content.creator_id::text = v_query
          or content.title ilike '%' || v_query || '%'
          or profile.username ilike '%' || v_query || '%'
          or profile.display_name ilike '%' || v_query || '%'
        )
        and (
          p_cursor_submitted_at is null
          or (content.submitted_at, content.id) < (p_cursor_submitted_at, p_cursor_id)
        )
      order by content.submitted_at desc, content.id desc
      limit v_limit
    )
    select pg_catalog.jsonb_build_object(
      'items', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', id,
        'creator', pg_catalog.jsonb_build_object(
          'id', creator_id, 'username', username,
          'display_name', display_name, 'avatar_url', avatar_url
        ),
        'title', title, 'description', description,
        'content_kind', content_kind, 'access_mode', access_mode,
        'lifecycle_status', lifecycle_status, 'teaser_url', teaser_url,
        'media_ready', media_ready, 'publication_blocker', publication_blocker,
        'submitted_at', submitted_at, 'reviewed_at', reviewed_at,
        'reviewed_by', reviewed_by, 'review_reason', review_reason,
        'verification_status', verification_status,
        'verification_error_code', verification_error_code,
        'verification_requested_at', verification_requested_at,
        'verification_completed_at', verification_completed_at,
        'published_at', published_at, 'quarantined_at', quarantined_at,
        'removed_at', removed_at, 'created_at', created_at, 'updated_at', updated_at
      ) order by submitted_at desc, id desc), '[]'::jsonb),
      'next_cursor', case when pg_catalog.count(*) = v_limit then (
        select pg_catalog.jsonb_build_object('submitted_at', submitted_at, 'id', id)
        from page order by submitted_at, id limit 1
      ) else null end
    ) from page
  ), pg_catalog.jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null));
end;
$$;

create function public.get_admin_creator_premium_content_v1(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.admin_require_capability('creator_premium.review.read');
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_admin_content_invalid';
  end if;

  select pg_catalog.jsonb_build_object(
    'id', content.id,
    'creator', pg_catalog.jsonb_build_object(
      'id', content.creator_id, 'username', profile.username,
      'display_name', profile.display_name, 'avatar_url', profile.avatar_url
    ),
    'title', content.title, 'description', content.description,
    'content_kind', content.content_kind, 'access_mode', content.access_mode,
    'lifecycle_status', content.lifecycle_status,
    'verification_status', content.verification_status,
    'verification_error_code', content.verification_error_code,
    'verification_requested_at', content.verification_requested_at,
    'verification_completed_at', content.verification_completed_at,
    'teaser_url', private.creator_premium_teaser_url_v1(content.id),
    'media_ready', case
      when content.content_kind = 'image' then private.creator_premium_image_is_ready_v1(content.id)
      when content.content_kind = 'video' then private.creator_premium_video_is_ready_v1(content.id)
      else false end,
    'publication_blocker', private.creator_premium_publication_blocker_v1(content.id),
    'offer', (
      select pg_catalog.jsonb_build_object(
        'id', offer.id, 'version', offer.version, 'price_bdag', offer.price_bdag::text,
        'currency', offer.currency, 'status', offer.status
      )
      from private.creator_premium_offer_versions offer
      where offer.content_id = content.id and offer.creator_id = content.creator_id
        and offer.status = 'active'
      limit 1
    ),
    'plans', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', plan.id, 'name', plan.name, 'version', plan.version,
        'price_bdag', plan.price_bdag::text, 'currency', plan.currency,
        'billing_period_days', plan.billing_period_days, 'status', plan.status
      ) order by plan.name, plan.version desc)
      from (
        select plan.*
        from private.creator_premium_plan_contents mapping
        join private.creator_premium_plans plan
          on plan.id = mapping.plan_id and plan.creator_id = mapping.creator_id
        where mapping.content_id = content.id and mapping.creator_id = content.creator_id
          and plan.status in ('draft','active','retired')
        order by plan.name, plan.version desc, plan.id
        limit 100
      ) plan
    ), '[]'::jsonb),
    'plan_count', (
      select pg_catalog.count(*)
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans plan
        on plan.id = mapping.plan_id and plan.creator_id = mapping.creator_id
      where mapping.content_id = content.id and mapping.creator_id = content.creator_id
        and plan.status in ('draft','active','retired')
    ),
    'plans_truncated', exists (
      select 1
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans plan
        on plan.id = mapping.plan_id and plan.creator_id = mapping.creator_id
      where mapping.content_id = content.id and mapping.creator_id = content.creator_id
        and plan.status in ('draft','active','retired')
      order by plan.name, plan.version desc, plan.id
      offset 100 limit 1
    ),
    'finance_policy', (
      select pg_catalog.jsonb_build_object(
        'purchase_enabled', policy.purchase_enabled,
        'subscription_enabled', policy.subscription_enabled,
        'refunds_enabled', policy.refunds_enabled,
        'policy_version', policy.policy_version
      )
      from private.creator_premium_finance_policy policy
      where policy.singleton = true
    ),
    'submitted_at', content.submitted_at, 'reviewed_at', content.reviewed_at,
    'reviewed_by', content.reviewed_by, 'review_reason', content.review_reason,
    'published_at', content.published_at, 'quarantined_at', content.quarantined_at,
    'removed_at', content.removed_at, 'created_at', content.created_at,
    'updated_at', content.updated_at,
    'audit', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', audit.id, 'actor_id', audit.actor_id,
        'action', audit.action, 'reason', audit.reason,
        'outcome', audit.outcome, 'created_at', audit.created_at
      ) order by audit.created_at desc, audit.id desc)
      from (
        select audit.id, audit.actor_id, audit.action, audit.reason,
          audit.outcome, audit.created_at
        from private.admin_action_audit audit
        where audit.domain = 'creator_premium'
          and audit.target_type = 'creator_premium_content'
          and audit.target_id = content.id
        order by audit.created_at desc, audit.id desc
        limit 100
      ) audit
    ), '[]'::jsonb),
    'reports', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', report.id, 'reason', report.reason, 'status', report.status,
        'created_at', report.created_at
      ) order by report.created_at desc, report.id desc)
      from (
        select report.id, report.reason, report.status, report.created_at
        from public.reports report
        where report.reported_content_type = 'creator_premium'
          and report.reported_content_id = content.id
        order by report.created_at desc, report.id desc
        limit 100
      ) report
    ), '[]'::jsonb)
  ) into v_result
  from private.creator_premium_contents content
  left join public.public_user_profiles profile on profile.id = content.creator_id
  where content.id = p_content_id
    and content.lifecycle_status in (
      'pending_review','published','rejected','quarantined','removed'
    );

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'creator_premium_admin_content_not_found';
  end if;
  return v_result;
end;
$$;

create function public.admin_review_creator_premium_content_v1(
  p_content_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_reason text := pg_catalog.nullif(pg_catalog.btrim(p_reason), '');
  v_scope text;
  v_fingerprint text;
  v_prior private.admin_action_audit;
  v_content private.creator_premium_contents;
  v_scan_id uuid;
  v_scan private.content_safety_scans;
  v_now timestamptz;
  v_receipt jsonb;
begin
  v_actor := public.admin_require_capability('creator_premium.review.moderate');
  if p_content_id is null or p_idempotency_key is null
     or v_action not in ('quarantine','remove','restore')
     or v_reason is null or pg_catalog.char_length(v_reason) not between 2 and 500 then
    raise exception using errcode = '22023', message = 'creator_premium_admin_review_invalid';
  end if;

  v_scope := 'v1|human|' || v_actor::text
    || '|creator_premium.review.moderate|creator_premium.review';
  v_fingerprint := private.admin_request_fingerprint(pg_catalog.jsonb_build_object(
    'contract_version', 1, 'actor_kind', 'human_admin', 'actor_id', v_actor,
    'capability', 'creator_premium.review.moderate',
    'action', 'creator_premium.' || v_action,
    'target_type', 'creator_premium_content', 'target_id', p_content_id,
    'reason', v_reason
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_scope || ':' || p_idempotency_key::text, 0)
  );
  select audit.* into v_prior
  from private.admin_action_audit audit
  where audit.idempotency_scope = v_scope
    and audit.idempotency_key = p_idempotency_key;
  if found then
    if v_prior.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'admin_idempotency_conflict';
    end if;
    return (v_prior.metadata -> 'receipt')
      || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:' || p_content_id::text, 0)
  );
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_admin_content_not_found';
  end if;
  v_now := pg_catalog.clock_timestamp();

  case v_action
    when 'quarantine' then
      if v_content.lifecycle_status <> 'published' then
        raise exception using errcode = '55000', message = 'creator_premium_admin_quarantine_invalid_state';
      end if;
      update private.creator_premium_contents content
      set lifecycle_status = 'quarantined', quarantined_at = v_now,
          removed_at = null, reviewed_at = v_now, reviewed_by = v_actor,
          review_reason = v_reason, removal_reason = v_reason, updated_at = v_now
      where content.id = v_content.id
      returning content.* into v_content;
    when 'remove' then
      if v_content.lifecycle_status not in ('published','quarantined') then
        raise exception using errcode = '55000', message = 'creator_premium_admin_remove_invalid_state';
      end if;
      update private.creator_premium_contents content
      set lifecycle_status = 'removed', removed_at = v_now,
          reviewed_at = v_now, reviewed_by = v_actor,
          review_reason = v_reason, removal_reason = v_reason, updated_at = v_now
      where content.id = v_content.id
      returning content.* into v_content;
    when 'restore' then
      if v_content.lifecycle_status not in ('rejected','quarantined','removed') then
        raise exception using errcode = '55000', message = 'creator_premium_admin_restore_invalid_state';
      end if;
      update private.creator_premium_contents content
      set verification_generation = content.verification_generation + 1,
          updated_at = v_now
      where content.id = v_content.id
      returning content.* into v_content;
      v_scan_id := private.enqueue_content_safety_scan(
        'creator_premium', v_content.id, 'retry'
      );
      select scan.* into v_scan
      from private.content_safety_scans scan
      where scan.id = v_scan_id;
      if not found then
        raise exception using errcode = '55000', message = 'creator_premium_safety_enqueue_failed';
      end if;
      update private.creator_premium_contents content
      set lifecycle_status = 'pending_review', submitted_at = v_now,
          published_at = null, quarantined_at = null, removed_at = null,
          reviewed_at = null, reviewed_by = null, review_reason = null,
          removal_reason = null,
          verification_scan_id = v_scan.id,
          verification_fingerprint = v_scan.content_fingerprint,
          verification_status = 'pending', verification_error_code = null,
          verification_requested_at = v_now, verification_completed_at = null,
          updated_at = v_now
      where content.id = v_content.id
      returning content.* into v_content;
      begin
        perform public.wake_content_safety_scanner();
      exception when others then
        null;
      end;
  end case;

  v_receipt := pg_catalog.jsonb_build_object(
    'content_id', v_content.id, 'action', v_action,
    'lifecycle_status', v_content.lifecycle_status,
    'reviewed_at', v_content.reviewed_at,
    'published_at', v_content.published_at,
    'replayed', false
  );
  insert into private.admin_action_audit(
    actor_id, actor_kind, actor_role_snapshot, actor_capability,
    domain, action, target_type, target_id, target_ref, reason,
    outcome, financial_effect, contains_pii, metadata,
    idempotency_scope, idempotency_key, request_fingerprint
  ) values (
    v_actor, 'human_admin', private.admin_active_role_codes(v_actor),
    'creator_premium.review.moderate', 'creator_premium',
    'creator_premium.' || v_action, 'creator_premium_content', v_content.id,
    v_content.id::text, v_reason, 'succeeded', false, false,
    pg_catalog.jsonb_build_object('receipt', v_receipt),
    v_scope, p_idempotency_key, v_fingerprint
  );
  return v_receipt;
end;
$$;

-- Reuse the one canonical report table. Creator Premium insertion is RPC-only;
-- direct authenticated inserts remain limited to the historical public types.
alter table public.reports drop constraint reports_reported_content_type_check;
alter table public.reports add constraint reports_reported_content_type_check
  check (reported_content_type in (
    'video','comment','user','story','message','creator_premium'
  ));

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
for insert to authenticated
with check (
  reporter_user_id = auth.uid()
  and reported_content_type in ('video','comment','user')
);

create unique index reports_one_pending_creator_premium_per_reporter_content_idx
  on public.reports(reporter_user_id, reported_content_id)
  where reported_content_type = 'creator_premium' and status = 'pending';

create function public.report_creator_premium_content_v1(
  p_content_id uuid,
  p_reason text,
  p_details text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason, '')));
  v_details text := pg_catalog.nullif(pg_catalog.btrim(p_details), '');
  v_content private.creator_premium_contents;
  v_report_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_content_id is null
     or v_reason not in (
       'spam','harassment','violence','hate','sexual','self_harm','drugs',
       'weapons','fraud','misinformation','child_safety',
       'non_consensual_intimate','illegal_exploitation','other'
     )
     or (v_details is not null and pg_catalog.char_length(v_details) > 1000) then
    raise exception using errcode = '22023', message = 'creator_premium_report_invalid';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.lifecycle_status = 'published';
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.creator_id = v_actor then
    raise exception using errcode = '42501', message = 'creator_premium_report_self_forbidden';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor, v_content.creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_blocked_relationship';
  end if;
  if (v_content.content_kind = 'image'
      and not private.creator_premium_image_is_ready_v1(v_content.id))
     or (v_content.content_kind = 'video'
      and not private.creator_premium_video_is_ready_v1(v_content.id)) then
    raise exception using errcode = '55000', message = 'creator_premium_media_unavailable';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'creator-premium-report|' || v_actor::text || '|' || v_content.id::text, 0
  ));
  if not exists (
    select 1
    from public.reports report
    where report.reporter_user_id = v_actor
      and report.reported_content_id = v_content.id
      and report.reported_content_type = 'creator_premium'
      and report.status = 'pending'
  ) then
    insert into public.reports(
      reporter_user_id, reported_content_id, reported_content_type, reason, details
    ) values (
      v_actor, v_content.id, 'creator_premium', v_reason, v_details
    ) returning id into v_report_id;
    return v_report_id;
  end if;
  raise exception using errcode = '23505', message = 'creator_premium_report_pending_exists';
end;
$$;

create or replace function public.search_admin_reports(
  p_query text default null,
  p_status text default null,
  p_content_type text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := pg_catalog.nullif(pg_catalog.btrim(p_query), '');
  v_limit integer := pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform public.admin_require_capability('reports.cases.read');
  if p_status is not null and p_status not in ('pending','reviewed','dismissed') then
    raise exception using errcode = '22023', message = 'admin_report_status_invalid';
  end if;
  if p_content_type is not null and p_content_type not in (
    'video','comment','user','story','message','creator_premium'
  ) then
    raise exception using errcode = '22023', message = 'admin_report_content_type_invalid';
  end if;
  if v_query is not null and pg_catalog.char_length(v_query) > 120 then
    raise exception using errcode = '22023', message = 'admin_report_query_invalid';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'admin_report_cursor_invalid';
  end if;
  return coalesce((
    with page as (
      select report.*, profile.username, profile.display_name, profile.avatar_url
      from public.reports report
      left join public.public_user_profiles profile on profile.id = report.reporter_user_id
      where (p_status is null or report.status = p_status)
        and (p_content_type is null or report.reported_content_type = p_content_type)
        and (
          v_query is null or report.id::text = v_query
          or report.reported_content_id::text = v_query
          or profile.username ilike '%' || v_query || '%'
          or profile.display_name ilike '%' || v_query || '%'
        )
        and (
          p_cursor_created_at is null
          or (report.created_at, report.id) < (p_cursor_created_at, p_cursor_id)
        )
      order by report.created_at desc, report.id desc
      limit v_limit
    )
    select pg_catalog.jsonb_build_object(
      'items', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', id,
        'reporter', pg_catalog.jsonb_build_object(
          'id', reporter_user_id, 'username', username,
          'display_name', display_name, 'avatar_url', avatar_url
        ),
        'reported_content_id', reported_content_id,
        'reported_content_type', reported_content_type,
        'reason', reason, 'status', status, 'created_at', created_at
      ) order by created_at desc, id desc), '[]'::jsonb),
      'next_cursor', case when pg_catalog.count(*) = v_limit then (
        select pg_catalog.jsonb_build_object('created_at', created_at, 'id', id)
        from page order by created_at, id limit 1
      ) else null end
    ) from page
  ), pg_catalog.jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null));
end;
$$;

create or replace function public.get_admin_report_detail(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report public.reports;
  v_reporter jsonb;
  v_subject jsonb;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_conversation_type text;
begin
  perform public.admin_require_capability('reports.cases.read');
  select * into v_report from public.reports where id = p_report_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_report_not_found';
  end if;
  select pg_catalog.jsonb_build_object(
    'id', id, 'username', username, 'display_name', display_name, 'avatar_url', avatar_url
  ) into v_reporter
  from public.public_user_profiles where id = v_report.reporter_user_id;

  if v_report.reported_content_type in ('video','comment') then
    perform public.admin_require_capability('content.items.read');
    if v_report.reported_content_type = 'video' then
      select pg_catalog.jsonb_build_object(
        'type','video','id',video.id,
        'caption',pg_catalog.left(coalesce(video.caption,''),500),
        'thumbnail_url',case when video.thumbnail_url ~* '^https://' then video.thumbnail_url else null end,
        'playback_url',case when video.video_url ~* '^https://' then video.video_url else null end,
        'created_at',video.created_at,'owner_id',video.user_id,
        'visibility',coalesce(state.visibility,'visible')
      ) into v_subject
      from public.videos video
      left join private.admin_content_moderation_state state
        on state.target_type = 'video' and state.target_id = video.id
      where video.id = v_report.reported_content_id;
    else
      select pg_catalog.jsonb_build_object(
        'type','comment','id',comment.id,
        'text',pg_catalog.left(coalesce(comment.text,''),500),
        'created_at',comment.created_at,'owner_id',comment.user_id,
        'video_id',comment.video_id,'visibility',coalesce(state.visibility,'visible')
      ) into v_subject
      from public.comments comment
      left join private.admin_content_moderation_state state
        on state.target_type = 'comment' and state.target_id = comment.id
      where comment.id = v_report.reported_content_id;
    end if;
  elsif v_report.reported_content_type = 'user' then
    perform public.admin_require_capability('users.accounts.read');
    select pg_catalog.jsonb_build_object(
      'type','user','id',profile.id,'username',profile.username,
      'display_name',profile.display_name,'avatar_url',profile.avatar_url
    ) into v_subject
    from public.public_user_profiles profile
    where profile.id = v_report.reported_content_id;
  elsif v_report.reported_content_type = 'story' then
    perform public.admin_require_capability('stories.items.read');
    select pg_catalog.jsonb_build_object(
      'type','story','id',story.id,'owner_id',story.user_id,
      'story_kind',story.story_kind,'media_type',story.media_type,
      'created_at',story.created_at,'expires_at',story.expires_at,
      'shared_video_id',story.shared_video_id,'shared_content_type',story.shared_content_type,
      'visibility',coalesce(state.visibility,'visible'),
      'media_asset_id',(select link.asset_id from public.media_asset_links link
        where link.entity_type='story' and link.entity_id=story.id
          and link.slot='media' and link.position=0 limit 1),
      'preview_url',(select case when asset.public_url ~* '^https://' then asset.public_url else null end
        from public.media_asset_links link join public.media_assets asset on asset.id=link.asset_id
        where link.entity_type='story' and link.entity_id=story.id
          and link.slot='media' and link.position=0
          and asset.visibility='public' and asset.status='ready' limit 1)
    ) into v_subject
    from public.stories story
    left join private.admin_content_moderation_state state
      on state.target_type='story' and state.target_id=story.id
    where story.id=v_report.reported_content_id;
  elsif v_report.reported_content_type = 'message' then
    perform public.admin_require_capability('chat.abuse_reports.read');
    select pg_catalog.jsonb_build_object(
      'type','message','id',message.id,
      'sender',pg_catalog.jsonb_build_object(
        'id',message.sender_id,'username',profile.username,
        'display_name',profile.display_name,'avatar_url',profile.avatar_url),
      'message_type',message.message_type,
      'text_excerpt',case when message.message_type='text' and message.consumption_policy='standard'
        then pg_catalog.left(coalesce(message.text,''),500) else null end,
      'has_media',(message.media_asset_id is not null or message.media_url is not null),
      'media_asset_id',message.media_asset_id,
      'audio_duration_ms',case when message.message_type='voice' then message.audio_duration_ms else null end,
      'created_at',message.created_at,'hidden',message.deleted_at is not null
    ) into v_subject
    from public.messages message
    left join public.public_user_profiles profile on profile.id=message.sender_id
    where message.id=v_report.reported_content_id;
    select conversation.conversation_type into v_conversation_type
    from public.messages message
    join public.chat_conversations conversation on conversation.id=message.conversation_id
    where message.id=v_report.reported_content_id;
    select coalesce(pg_catalog.jsonb_agg(item order by created_at,id),'[]'::jsonb)
    into v_before from (
      select message.created_at,message.id,pg_catalog.jsonb_build_object(
        'id',message.id,'sender',pg_catalog.jsonb_build_object(
          'id',message.sender_id,'username',profile.username,
          'display_name',profile.display_name,'avatar_url',profile.avatar_url),
        'message_type',message.message_type,
        'text_excerpt',case when message.message_type='text' and message.consumption_policy='standard'
          then pg_catalog.left(coalesce(message.text,''),500) else null end,
        'has_media',(message.media_asset_id is not null or message.media_url is not null),
        'audio_duration_ms',case when message.message_type='voice' then message.audio_duration_ms else null end,
        'created_at',message.created_at,'hidden',message.deleted_at is not null) item
      from public.messages message
      join public.messages target on target.id=v_report.reported_content_id
        and target.conversation_id=message.conversation_id
      left join public.public_user_profiles profile on profile.id=message.sender_id
      where message.deleted_at is null
        and (message.created_at,message.id)<(target.created_at,target.id)
      order by message.created_at desc,message.id desc limit 3
    ) context_before;
    select coalesce(pg_catalog.jsonb_agg(item order by created_at,id),'[]'::jsonb)
    into v_after from (
      select message.created_at,message.id,pg_catalog.jsonb_build_object(
        'id',message.id,'sender',pg_catalog.jsonb_build_object(
          'id',message.sender_id,'username',profile.username,
          'display_name',profile.display_name,'avatar_url',profile.avatar_url),
        'message_type',message.message_type,
        'text_excerpt',case when message.message_type='text' and message.consumption_policy='standard'
          then pg_catalog.left(coalesce(message.text,''),500) else null end,
        'has_media',(message.media_asset_id is not null or message.media_url is not null),
        'audio_duration_ms',case when message.message_type='voice' then message.audio_duration_ms else null end,
        'created_at',message.created_at,'hidden',message.deleted_at is not null) item
      from public.messages message
      join public.messages target on target.id=v_report.reported_content_id
        and target.conversation_id=message.conversation_id
      left join public.public_user_profiles profile on profile.id=message.sender_id
      where message.deleted_at is null
        and (message.created_at,message.id)>(target.created_at,target.id)
      order by message.created_at,message.id limit 3
    ) context_after;
  elsif v_report.reported_content_type = 'creator_premium' then
    perform public.admin_require_capability('creator_premium.review.read');
    select pg_catalog.jsonb_build_object(
      'type','creator_premium','id',content.id,'owner_id',content.creator_id,
      'owner',pg_catalog.jsonb_build_object(
        'id',content.creator_id,'username',profile.username,
        'display_name',profile.display_name,'avatar_url',profile.avatar_url),
      'title',content.title,'description',pg_catalog.left(content.description,1000),
      'content_kind',content.content_kind,'access_mode',content.access_mode,
      'lifecycle_status',content.lifecycle_status,
      'teaser_url',private.creator_premium_teaser_url_v1(content.id),
      'created_at',content.created_at,'submitted_at',content.submitted_at
    ) into v_subject
    from private.creator_premium_contents content
    left join public.public_user_profiles profile on profile.id=content.creator_id
    where content.id=v_report.reported_content_id;
  else
    raise exception using errcode='22023',message='admin_report_content_type_invalid';
  end if;

  return pg_catalog.jsonb_build_object(
    'id',v_report.id,'reporter',v_reporter,
    'reported_content_id',v_report.reported_content_id,
    'reported_content_type',v_report.reported_content_type,
    'reason',v_report.reason,'details',v_report.details,'status',v_report.status,
    'created_at',v_report.created_at,'subject',v_subject,
    'chat_context',case when v_report.reported_content_type='message'
      then pg_catalog.jsonb_build_object(
        'conversation_type',v_conversation_type,'before',v_before,'after',v_after
      ) else null end
  );
end;
$$;

create function public.get_creator_premium_commerce_v1(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_entitlement record;
  v_policy private.creator_premium_finance_policy;
  v_media_ready boolean := false;
  v_purchase_owned boolean := false;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode='22023',message='creator_premium_invalid_content';
  end if;
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id=p_content_id and content.lifecycle_status='published';
  if not found then
    raise exception using errcode='P0002',message='creator_premium_content_not_found';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_creator_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor,v_content.creator_id) then
    raise exception using errcode='42501',message='creator_premium_blocked_relationship';
  end if;
  v_media_ready := case v_content.content_kind
    when 'image' then private.creator_premium_image_is_ready_v1(v_content.id)
    when 'video' then private.creator_premium_video_is_ready_v1(v_content.id)
    else false end;
  if not v_media_ready then
    raise exception using errcode='55000',message='creator_premium_media_unavailable';
  end if;
  select * into v_entitlement
  from private.resolve_creator_premium_entitlement_v1(v_content.id);
  select policy.* into v_policy
  from private.creator_premium_finance_policy policy
  where policy.singleton=true;
  select exists(
    select 1
    from private.creator_premium_purchase_receipts receipt
    where receipt.buyer_id=v_actor
      and receipt.content_id=v_content.id
      and receipt.access_state='active'
      and private.creator_premium_purchase_binding_is_valid_v1(receipt.id)
  ) into v_purchase_owned;

  select pg_catalog.jsonb_build_object(
    'content',pg_catalog.jsonb_build_object(
      'id',content.id,'creator_id',content.creator_id,'title',content.title,
      'description',content.description,'content_kind',content.content_kind,
      'access_mode',content.access_mode,'teaser_url',private.creator_premium_teaser_url_v1(content.id),
      'published_at',content.published_at
    ),
    'creator',pg_catalog.jsonb_build_object(
      'id',content.creator_id,'username',profile.username,
      'display_name',profile.display_name,'avatar_url',profile.avatar_url
    ),
    'offer',(
      select pg_catalog.jsonb_build_object(
        'id',offer.id,'version',offer.version,'price_bdag',offer.price_bdag::text,
        'currency',offer.currency,'status',offer.status
      )
      from private.creator_premium_offer_versions offer
      where offer.content_id=content.id and offer.creator_id=content.creator_id
        and offer.status='active'
      limit 1
    ),
    'plans',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',plan.id,'name',plan.name,'description',plan.description,
        'version',plan.version,'price_bdag',plan.price_bdag::text,
        'currency',plan.currency,'billing_period_days',plan.billing_period_days,
        'status',plan.status,
        'relationship',case when plan.relationship_id is null then null else
          pg_catalog.jsonb_build_object(
            'id',plan.relationship_id,'status',plan.relationship_status,
            'cancelled_at',plan.relationship_cancelled_at,
            'paid_through_at',plan.relationship_paid_through_at,
            'access_state',plan.relationship_access_state
          ) end,
        'subscription_available',coalesce(v_policy.subscription_enabled,false)
          and v_actor<>content.creator_id and plan.relationship_id is null,
        'subscription_blocker',case
          when v_actor=content.creator_id then 'creator_premium_self_subscription_forbidden'
          when not coalesce(v_policy.subscription_enabled,false) then 'creator_premium_subscription_disabled'
          when plan.relationship_status in ('expired','revoked') then 'creator_premium_subscription_renewal_not_implemented'
          when plan.relationship_id is not null then 'creator_premium_already_subscribed'
          else null end
      ) order by plan.price_bdag,plan.id)
      from (
        select plan.*,
          relationship.id as relationship_id,
          relationship.status as relationship_status,
          relationship.cancelled_at as relationship_cancelled_at,
          relationship.paid_through_at as relationship_paid_through_at,
          relationship.access_state as relationship_access_state
        from private.creator_premium_plan_contents mapping
        join private.creator_premium_plans plan
          on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
        left join lateral (
          select subscription.id,subscription.status,subscription.cancelled_at,
            period.paid_through_at,period.access_state
          from private.creator_premium_subscriptions subscription
          left join lateral (
            select paid_period.paid_through_at,paid_period.access_state
            from private.creator_premium_subscription_periods paid_period
            where paid_period.subscription_id=subscription.id
            order by paid_period.starts_at desc,paid_period.id desc
            limit 1
          ) period on true
          where subscription.subscriber_id=v_actor
            and subscription.plan_id=plan.id
          order by subscription.created_at desc,subscription.id desc
          limit 1
        ) relationship on true
        where mapping.content_id=content.id and mapping.creator_id=content.creator_id
          and plan.status='active'
        order by plan.price_bdag,plan.id
        limit 100
      ) plan
    ),'[]'::jsonb),
    'plan_count',(
      select pg_catalog.count(*)
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans plan
        on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
      where mapping.content_id=content.id and mapping.creator_id=content.creator_id
        and plan.status='active'
    ),
    'plans_truncated',exists(
      select 1
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans plan
        on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
      where mapping.content_id=content.id and mapping.creator_id=content.creator_id
        and plan.status='active'
      order by plan.price_bdag,plan.id
      offset 100 limit 1
    ),
    'entitlement',pg_catalog.jsonb_build_object(
      'allowed',v_entitlement.allowed,'source',v_entitlement.source,
      'reason',v_entitlement.reason,'expires_at',v_entitlement.expires_at
    ),
    'operations',pg_catalog.jsonb_build_object(
      'purchase_available',coalesce(v_policy.purchase_enabled,false)
        and v_actor<>content.creator_id
        and content.access_mode in ('purchase','purchase_or_subscription')
        and not v_purchase_owned
        and exists(select 1 from private.creator_premium_offer_versions active_offer
          where active_offer.content_id=content.id
            and active_offer.creator_id=content.creator_id
            and active_offer.status='active'),
      'purchase_blocker',case
        when v_actor=content.creator_id then 'creator_premium_self_purchase_forbidden'
        when content.access_mode not in ('purchase','purchase_or_subscription') then 'creator_premium_purchase_access_mode_invalid'
        when v_purchase_owned then 'creator_premium_already_owned'
        when not exists(select 1 from private.creator_premium_offer_versions active_offer
          where active_offer.content_id=content.id
            and active_offer.creator_id=content.creator_id
            and active_offer.status='active') then 'creator_premium_active_offer_not_found'
        when not coalesce(v_policy.purchase_enabled,false) then 'creator_premium_purchase_disabled'
        else null end
    ),
    'policy',pg_catalog.jsonb_build_object(
      'purchase_enabled',coalesce(v_policy.purchase_enabled,false),
      'subscription_enabled',coalesce(v_policy.subscription_enabled,false),
      'refunds_enabled',coalesce(v_policy.refunds_enabled,false),
      'policy_version',v_policy.policy_version
    )
  ) into v_result
  from private.creator_premium_contents content
  left join public.public_user_profiles profile on profile.id=content.creator_id
  where content.id=v_content.id;
  return v_result;
end;
$$;

create function public.get_my_creator_premium_subscriptions_v1(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := pg_catalog.least(pg_catalog.greatest(coalesce(p_limit,50),1),100);
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023',message='creator_premium_subscription_cursor_invalid';
  end if;

  return coalesce((
    with page as (
      select
        subscription.id, subscription.creator_id, subscription.plan_id,
        subscription.status, subscription.started_at, subscription.cancelled_at,
        subscription.ended_at, subscription.created_at, subscription.updated_at,
        plan.name as plan_name, plan.description as plan_description,
        plan.version as plan_version, plan.billing_period_days,
        plan.price_bdag::text as plan_price_bdag, plan.currency,
        profile.username, profile.display_name, profile.avatar_url,
        period.id as period_id, period.starts_at, period.paid_through_at,
        period.access_state, period.gross_amount_bdag::text as gross_amount_bdag,
        case
          when subscription.status in ('active','cancelled')
            and period.access_state='active'
            and period.paid_through_at > pg_catalog.clock_timestamp()
            and private.creator_premium_period_binding_is_valid_v1(period.id)
          then true else false
        end as access_active
      from private.creator_premium_subscriptions subscription
      join private.creator_premium_plans plan
        on plan.id=subscription.plan_id and plan.creator_id=subscription.creator_id
      left join public.public_user_profiles profile on profile.id=subscription.creator_id
      left join lateral (
        select paid_period.*
        from private.creator_premium_subscription_periods paid_period
        where paid_period.subscription_id=subscription.id
          and paid_period.subscriber_id=subscription.subscriber_id
        order by paid_period.paid_through_at desc,paid_period.id desc
        limit 1
      ) period on true
      where subscription.subscriber_id=v_actor
        and (p_cursor_created_at is null
          or (subscription.created_at,subscription.id)<(p_cursor_created_at,p_cursor_id))
      order by subscription.created_at desc,subscription.id desc
      limit v_limit
    )
    select pg_catalog.jsonb_build_object(
      'items',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',id,'creator',pg_catalog.jsonb_build_object(
          'id',creator_id,'username',username,'display_name',display_name,'avatar_url',avatar_url),
        'plan',pg_catalog.jsonb_build_object(
          'id',plan_id,'name',plan_name,'description',plan_description,
          'version',plan_version,'price_bdag',plan_price_bdag,'currency',currency,
          'billing_period_days',billing_period_days),
        'status',status,'started_at',started_at,'cancelled_at',cancelled_at,
        'ended_at',ended_at,'period',case when period_id is null then null else
          pg_catalog.jsonb_build_object(
            'id',period_id,'starts_at',starts_at,'paid_through_at',paid_through_at,
            'access_state',access_state,'gross_amount_bdag',gross_amount_bdag) end,
        'access_active',access_active,'auto_renew',false,'renewal_supported',false,
        'created_at',created_at,'updated_at',updated_at
      ) order by created_at desc,id desc),'[]'::jsonb),
      'next_cursor',case when pg_catalog.count(*)=v_limit then (
        select pg_catalog.jsonb_build_object('created_at',created_at,'id',id)
        from page order by created_at,id limit 1
      ) else null end
    ) from page
  ),pg_catalog.jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function private.creator_premium_financial_fact_is_valid_v1(
  p_original_transaction_id uuid,
  p_reversal_transaction_id uuid,
  p_access_state text,
  p_payer_id uuid,
  p_creator_id uuid,
  p_payer_account_id uuid,
  p_creator_account_id uuid,
  p_platform_account_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_charge_operation_type text,
  p_refund_operation_type text,
  p_charge_idempotency_key uuid,
  p_refund_idempotency_key uuid,
  p_gross_amount_bdag numeric,
  p_platform_fee_bdag numeric,
  p_creator_net_bdag numeric,
  p_platform_fee_bps integer
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists(
    select 1
    from public.financial_transactions original
    join public.ledger_accounts payer_account
      on payer_account.id=p_payer_account_id
     and payer_account.owner_id=p_payer_id
     and payer_account.account_type='user'
     and payer_account.currency='BDAG'
    join public.ledger_accounts creator_account
      on creator_account.id=p_creator_account_id
     and creator_account.owner_id=p_creator_id
     and creator_account.account_type='user'
     and creator_account.currency='BDAG'
    join public.ledger_accounts platform_account
      on platform_account.id=p_platform_account_id
     and platform_account.owner_id is null
     and platform_account.account_type='platform'
     and platform_account.currency='BDAG'
    left join public.financial_transactions reversal
      on reversal.id=p_reversal_transaction_id
    where original.id=p_original_transaction_id
      and (p_reference_type,p_charge_operation_type,p_refund_operation_type) in (
        ('creator_premium_purchase_receipt','creator_premium_purchase','creator_premium_purchase_refund'),
        ('creator_premium_subscription_period','creator_premium_subscription','creator_premium_subscription_refund')
      )
      and (
        (p_reference_type='creator_premium_purchase_receipt'
          and p_access_state in ('active','revoked','refunded'))
        or
        (p_reference_type='creator_premium_subscription_period'
          and p_access_state in ('active','expired','revoked','refunded'))
      )
      and p_gross_amount_bdag>0
      and p_creator_net_bdag>0
      and p_platform_fee_bdag>=0
      and p_platform_fee_bps between 0 and 9999
      and p_gross_amount_bdag=p_creator_net_bdag+p_platform_fee_bdag
      and p_platform_fee_bdag=pg_catalog.round(
        p_gross_amount_bdag*p_platform_fee_bps/10000,8)
      and p_gross_amount_bdag=pg_catalog.round(p_gross_amount_bdag,8)
      and p_creator_net_bdag=pg_catalog.round(p_creator_net_bdag,8)
      and p_platform_fee_bdag=pg_catalog.round(p_platform_fee_bdag,8)
      and original.operation_type=p_charge_operation_type
      and original.reference_type=p_reference_type
      and original.reference_id=p_reference_id::text
      and original.from_account_id=p_payer_account_id
      and original.to_account_id=p_creator_account_id
      and original.amount=p_gross_amount_bdag
      and original.fee_amount=p_platform_fee_bdag
      and original.currency='BDAG'
      and original.initiated_by=p_payer_id
      and original.idempotency_key=p_charge_idempotency_key::text
      and original.status=case
        when p_access_state='refunded' then 'reversed'
        else 'completed'
      end
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id)=case
          when p_platform_fee_bdag=0 then 2 else 3 end
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id
          and entry.account_id=p_payer_account_id
          and entry.entry_type='debit'
          and entry.amount=p_gross_amount_bdag
          and entry.metadata->>'fin_txn_id'=original.id::text
          and entry.metadata->>'reference_type'=p_reference_type
          and entry.metadata->>'reference_id'=p_reference_id::text
          and entry.metadata->>'financial_leg'='payer_gross_debit')=1
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id
          and entry.account_id=p_creator_account_id
          and entry.entry_type='credit'
          and entry.amount=p_creator_net_bdag
          and entry.metadata->>'fin_txn_id'=original.id::text
          and entry.metadata->>'reference_type'=p_reference_type
          and entry.metadata->>'reference_id'=p_reference_id::text
          and entry.metadata->>'financial_leg'='creator_net_credit')=1
      and (
        p_platform_fee_bdag=0
        or (select pg_catalog.count(*) from public.ledger_entries entry
          where entry.txn_id=original.id
            and entry.account_id=p_platform_account_id
            and entry.entry_type='credit'
            and entry.amount=p_platform_fee_bdag
            and entry.metadata->>'fin_txn_id'=original.id::text
            and entry.metadata->>'reference_type'=p_reference_type
            and entry.metadata->>'reference_id'=p_reference_id::text
            and entry.metadata->>'financial_leg'='platform_fee_credit')=1
      )
      and (
        (p_access_state<>'refunded'
          and p_reversal_transaction_id is null
          and p_refund_idempotency_key is null)
        or
        (p_access_state='refunded'
          and p_reversal_transaction_id is not null
          and p_refund_idempotency_key is not null
          and reversal.status='completed'
          and reversal.operation_type=p_refund_operation_type
          and reversal.reference_type=p_reference_type
          and reversal.reference_id=p_reference_id::text
          and reversal.from_account_id=p_creator_account_id
          and reversal.to_account_id=p_payer_account_id
          and reversal.amount=p_gross_amount_bdag
          and reversal.fee_amount=p_platform_fee_bdag
          and reversal.currency='BDAG'
          and reversal.initiated_by=p_payer_id
          and reversal.idempotency_key=p_refund_idempotency_key::text
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id)=case
              when p_platform_fee_bdag=0 then 2 else 3 end
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id
              and entry.account_id=p_creator_account_id
              and entry.entry_type='debit'
              and entry.amount=p_creator_net_bdag
              and entry.metadata->>'fin_txn_id'=reversal.id::text
              and entry.metadata->>'reference_type'=p_reference_type
              and entry.metadata->>'reference_id'=p_reference_id::text
              and entry.metadata->>'financial_leg'='creator_net_debit')=1
          and (
            p_platform_fee_bdag=0
            or (select pg_catalog.count(*) from public.ledger_entries entry
              where entry.txn_id=reversal.id
                and entry.account_id=p_platform_account_id
                and entry.entry_type='debit'
                and entry.amount=p_platform_fee_bdag
                and entry.metadata->>'fin_txn_id'=reversal.id::text
                and entry.metadata->>'reference_type'=p_reference_type
                and entry.metadata->>'reference_id'=p_reference_id::text
                and entry.metadata->>'financial_leg'='platform_fee_debit')=1
          )
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id
              and entry.account_id=p_payer_account_id
              and entry.entry_type='credit'
              and entry.amount=p_gross_amount_bdag
              and entry.metadata->>'fin_txn_id'=reversal.id::text
              and entry.metadata->>'reference_type'=p_reference_type
              and entry.metadata->>'reference_id'=p_reference_id::text
              and entry.metadata->>'financial_leg'='payer_gross_credit')=1)
      )
  ),false);
$$;

create function public.get_my_creator_premium_commercial_summary_v1(
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_from timestamptz := coalesce(p_from,pg_catalog.clock_timestamp()-interval '30 days');
  v_to timestamptz := coalesce(p_to,pg_catalog.clock_timestamp());
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode='42501',message='creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode='42501',message='creator_premium_account_restricted';
  end if;
  if v_from >= v_to or v_to-v_from > interval '366 days' then
    raise exception using errcode='22023',message='creator_premium_summary_range_invalid';
  end if;

  with purchase_facts as (
    select receipt.*,
      original.created_at as charge_created_at,
      reversal.created_at as refund_created_at,
      private.creator_premium_financial_fact_is_valid_v1(
        receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
        receipt.access_state,receipt.buyer_id,receipt.creator_id,
        receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
        'creator_premium_purchase_receipt',receipt.id,
        'creator_premium_purchase','creator_premium_purchase_refund',
        receipt.idempotency_key,receipt.refund_idempotency_key,
        receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
        receipt.platform_fee_bps
      ) as verified
    from private.creator_premium_purchase_receipts receipt
    join public.financial_transactions original
      on original.id=receipt.financial_transaction_id
    left join public.financial_transactions reversal
      on reversal.id=receipt.reversal_financial_transaction_id
    where receipt.creator_id=v_actor
  ), period_facts as (
    select period.*,
      original.created_at as charge_created_at,
      reversal.created_at as refund_created_at,
      private.creator_premium_financial_fact_is_valid_v1(
        period.financial_transaction_id,period.reversal_financial_transaction_id,
        period.access_state,period.subscriber_id,period.creator_id,
        period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
        'creator_premium_subscription_period',period.id,
        'creator_premium_subscription','creator_premium_subscription_refund',
        period.idempotency_key,period.refund_idempotency_key,
        period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
        period.platform_fee_bps
      ) as verified
    from private.creator_premium_subscription_periods period
    join public.financial_transactions original
      on original.id=period.financial_transaction_id
    left join public.financial_transactions reversal
      on reversal.id=period.reversal_financial_transaction_id
    where period.creator_id=v_actor
  ), charge_events as (
    select 'purchase'::text as source,id as reference_id,content_id,
      financial_transaction_id as transaction_id,
      gross_amount_bdag,platform_fee_bdag,creator_net_bdag,
      'charge'::text as event_type,charge_created_at as event_at
    from purchase_facts
    where verified and charge_created_at>=v_from and charge_created_at<v_to
    union all
    select 'subscription'::text,id,null::uuid,
      financial_transaction_id,gross_amount_bdag,platform_fee_bdag,
      creator_net_bdag,'charge'::text,charge_created_at
    from period_facts
    where verified and charge_created_at>=v_from and charge_created_at<v_to
  ), refund_events as (
    select 'purchase'::text as source,id as reference_id,content_id,
      reversal_financial_transaction_id as transaction_id,
      gross_amount_bdag,platform_fee_bdag,creator_net_bdag,
      'refund'::text as event_type,refund_created_at as event_at
    from purchase_facts
    where verified and reversal_financial_transaction_id is not null
      and refund_created_at>=v_from and refund_created_at<v_to
    union all
    select 'subscription'::text,id,null::uuid,
      reversal_financial_transaction_id,gross_amount_bdag,platform_fee_bdag,
      creator_net_bdag,'refund'::text,refund_created_at
    from period_facts
    where verified and reversal_financial_transaction_id is not null
      and refund_created_at>=v_from and refund_created_at<v_to
  ), all_events as (
    select * from charge_events
    union all
    select * from refund_events
  ), totals as (
    select
      coalesce((select pg_catalog.sum(gross_amount_bdag) from charge_events),0)::numeric(20,8) gross,
      coalesce((select pg_catalog.sum(platform_fee_bdag) from charge_events),0)::numeric(20,8) platform_fee,
      coalesce((select pg_catalog.sum(creator_net_bdag) from charge_events),0)::numeric(20,8) creator_net,
      coalesce((select pg_catalog.sum(gross_amount_bdag) from refund_events),0)::numeric(20,8) refund,
      coalesce((select pg_catalog.sum(creator_net_bdag) from refund_events),0)::numeric(20,8) creator_refund,
      (select pg_catalog.count(*) from charge_events where source='purchase') purchase_count,
      (select pg_catalog.count(*) from charge_events where source='subscription') subscription_period_count,
      (select pg_catalog.count(*) from refund_events) refund_count
  ), content_metrics as (
    select content.id,content.title,content.lifecycle_status,
      pg_catalog.count(fact.id) filter(where fact.verified
        and fact.charge_created_at>=v_from and fact.charge_created_at<v_to) purchase_sales,
      (coalesce(pg_catalog.sum(fact.creator_net_bdag) filter(where fact.verified
          and fact.charge_created_at>=v_from and fact.charge_created_at<v_to),0)
       -coalesce(pg_catalog.sum(fact.creator_net_bdag) filter(where fact.verified
          and fact.reversal_financial_transaction_id is not null
          and fact.refund_created_at>=v_from and fact.refund_created_at<v_to),0))::numeric(20,8)
        purchase_net_retained
    from private.creator_premium_contents content
    left join purchase_facts fact on fact.content_id=content.id
    where content.creator_id=v_actor
    group by content.id,content.title,content.lifecycle_status
  )
  select pg_catalog.jsonb_build_object(
    'range',pg_catalog.jsonb_build_object('from',v_from,'to',v_to),
    'currency','BDAG',
    'gross',totals.gross::text,
    'platform_fee',totals.platform_fee::text,
    'creator_net',totals.creator_net::text,
    'refund',totals.refund::text,
    'net_retained',(totals.creator_net-totals.creator_refund)::numeric(20,8)::text,
    'purchase_count',totals.purchase_count,
    'subscription_period_count',totals.subscription_period_count,
    'refund_count',totals.refund_count,
    'published_contents',(select pg_catalog.count(*) from private.creator_premium_contents
      where creator_id=v_actor and lifecycle_status='published'),
    'pending_contents',(select pg_catalog.count(*) from private.creator_premium_contents
      where creator_id=v_actor and lifecycle_status='pending_review'),
    'rejected_contents',(select pg_catalog.count(*) from private.creator_premium_contents
      where creator_id=v_actor and lifecycle_status='rejected'),
    'active_subscription_grants',(select pg_catalog.count(*)
      from private.creator_premium_subscriptions subscription
      where subscription.creator_id=v_actor
        and subscription.status in('active','cancelled')
        and exists(select 1 from private.creator_premium_subscription_periods period
          where period.subscription_id=subscription.id and period.access_state='active'
            and period.paid_through_at>pg_catalog.clock_timestamp()
            and private.creator_premium_period_binding_is_valid_v1(period.id))),
    'revoked_subscription_count',(select pg_catalog.count(*)
      from private.creator_premium_subscriptions subscription
      where subscription.creator_id=v_actor and subscription.status='revoked'),
    'recent_transactions',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'source',recent.source,'event_type',recent.event_type,
        'reference_id',recent.reference_id,'content_id',recent.content_id,
        'financial_transaction_id',recent.transaction_id,
        'gross_amount_bdag',recent.gross_amount_bdag::text,
        'platform_fee_bdag',recent.platform_fee_bdag::text,
        'creator_net_bdag',recent.creator_net_bdag::text,
        'created_at',recent.event_at
      ) order by recent.event_at desc,recent.transaction_id desc)
      from (
        select event.* from all_events event
        order by event.event_at desc,event.transaction_id desc
        limit 50
      ) recent
    ),'[]'::jsonb),
    'content_performance',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'content_id',metric.id,'title',metric.title,'lifecycle_status',metric.lifecycle_status,
      'purchase_sales',metric.purchase_sales,
      'purchase_net_retained',metric.purchase_net_retained::text,
      'subscription_revenue_allocation','not_allocated'
    ) order by metric.title,metric.id) from content_metrics metric),'[]'::jsonb),
    'views_instrumented',false
  ) into v_result
  from totals;
  return v_result;
end;
$$;

create function public.get_admin_creator_premium_refund_candidates_v1(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_require_capability('creator_premium.refunds.write');
  if p_content_id is null then
    raise exception using errcode='22023',message='creator_premium_refund_target_invalid';
  end if;
  return pg_catalog.jsonb_build_object(
    'purchases',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'receipt_id',receipt.id,'buyer_id',receipt.buyer_id,
      'access_state',receipt.access_state,'gross_amount_bdag',receipt.gross_amount_bdag::text,
      'platform_fee_bdag',receipt.platform_fee_bdag::text,
      'creator_net_bdag',receipt.creator_net_bdag::text,
      'purchased_at',receipt.purchased_at,'refunded_at',receipt.refunded_at,
      'refundable',receipt.access_state='active'
    ) order by receipt.purchased_at desc,receipt.id desc)
    from (
      select receipt.*
      from private.creator_premium_purchase_receipts receipt
      where receipt.content_id=p_content_id
      order by receipt.purchased_at desc,receipt.id desc
      limit 100
    ) receipt),'[]'::jsonb),
    'subscription_periods',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'period_id',period.id,'subscriber_id',period.subscriber_id,
      'access_state',period.access_state,'gross_amount_bdag',period.gross_amount_bdag::text,
      'platform_fee_bdag',period.platform_fee_bdag::text,
      'creator_net_bdag',period.creator_net_bdag::text,
      'starts_at',period.starts_at,'paid_through_at',period.paid_through_at,
      'refunded_at',period.refunded_at,'refundable',period.access_state='active'
    ) order by period.starts_at desc,period.id desc)
    from (
      select period.*
      from private.creator_premium_subscription_periods period
      join private.creator_premium_plan_contents mapping
        on mapping.plan_id=period.plan_id and mapping.creator_id=period.creator_id
      where mapping.content_id=p_content_id
      order by period.starts_at desc,period.id desc
      limit 100
    ) period),'[]'::jsonb)
  );
end;
$$;

create or replace function private.creator_premium_internal_finance_authority_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    session_user in ('postgres','supabase_admin')
    or auth.role() = 'service_role'
    or pg_catalog.current_setting('request.jwt.claim.role', true) = 'service_role'
    or (
      current_user = 'postgres'
      and auth.uid() is not null
      and public.admin_actor_has_capability('creator_premium.refunds.write')
    ),
    false
  );
$$;

-- Preserve financial_effect as the audit sensitivity/classification flag while
-- exposing the canonical per-invocation movement truth to finance auditors.
create or replace function private.admin_audit_safe_metadata(
  p_metadata jsonb,
  p_contains_pii boolean,
  p_financial_scope boolean
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'result', p_metadata -> 'result',
    'result_kind', p_metadata -> 'result_kind',
    'status', p_metadata -> 'status',
    'previous_status', p_metadata -> 'previous_status',
    'final_status', p_metadata -> 'final_status',
    'changed', p_metadata -> 'changed',
    'money_moved', case when p_financial_scope then p_metadata -> 'money_moved' end,
    'replayed', case when p_financial_scope then p_metadata -> 'replayed' end,
    'already_refunded', case when p_financial_scope then p_metadata -> 'already_refunded' end,
    'reference_id', case when p_financial_scope then p_metadata -> 'reference_id' end,
    'reversal_financial_transaction_id',
      case when p_financial_scope then p_metadata -> 'reversal_financial_transaction_id' end,
    'reason_code', case when p_financial_scope then p_metadata -> 'reason_code' end,
    'already_released', case when p_financial_scope then p_metadata -> 'already_released' end,
    'migration', case when not p_contains_pii then p_metadata -> 'migration' end,
    'legacy_role', case when not p_contains_pii then p_metadata -> 'legacy_role' end,
    'source', case when not p_contains_pii then p_metadata -> 'source' end,
    'action', case when not p_contains_pii then p_metadata -> 'action' end,
    'target_type', case when not p_contains_pii then p_metadata -> 'target_type' end
  ));
$$;

revoke all on function private.admin_audit_safe_metadata(jsonb,boolean,boolean)
  from public,anon,authenticated,service_role;

create function public.admin_refund_creator_premium_purchase_v1(
  p_receipt_id uuid,
  p_idempotency_key uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason_code,'')));
  v_scope text;
  v_fingerprint text;
  v_prior private.admin_action_audit;
  v_result jsonb;
  v_receipt private.creator_premium_purchase_receipts;
begin
  v_actor:=public.admin_require_capability('creator_premium.refunds.write');
  if p_receipt_id is null or p_idempotency_key is null
     or v_reason !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception using errcode='22023',message='creator_premium_admin_refund_invalid';
  end if;
  v_scope:='v1|human|'||v_actor::text
    ||'|creator_premium.refunds.write|creator_premium.purchase_refund';
  v_fingerprint:=private.admin_request_fingerprint(pg_catalog.jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','creator_premium.refunds.write',
    'action','creator_premium.purchase_refund','target_type','creator_premium_purchase_receipt',
    'target_id',p_receipt_id,'reason',v_reason));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select audit.* into v_prior from private.admin_action_audit audit
  where audit.idempotency_scope=v_scope and audit.idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return (v_prior.metadata->'receipt') || pg_catalog.jsonb_build_object(
      'money_moved',false,
      'replayed',true,
      'already_refunded',true
    );
  end if;
  select receipt.* into v_receipt
  from private.creator_premium_purchase_receipts receipt
  where receipt.id=p_receipt_id;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_purchase_receipt_not_found';
  end if;
  v_result:=public.refund_creator_premium_purchase_v1(
    p_receipt_id,p_idempotency_key,v_reason);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,
    target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,
    metadata,idempotency_scope,idempotency_key,request_fingerprint
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),
    'creator_premium.refunds.write','creator_premium','creator_premium.purchase_refund',
    'creator_premium_purchase_receipt',p_receipt_id,p_receipt_id::text,v_reason,
    case when coalesce((v_result->>'money_moved')::boolean,false)
      then 'succeeded' else 'no_op' end,
    true,true,pg_catalog.jsonb_build_object(
      'receipt',v_result,
      'result',case when coalesce((v_result->>'money_moved')::boolean,false)
        then 'refunded' else 'already_refunded' end,
      'money_moved',coalesce((v_result->>'money_moved')::boolean,false),
      'replayed',coalesce((v_result->>'replayed')::boolean,false),
      'already_refunded',coalesce((v_result->>'already_refunded')::boolean,false),
      'reference_id',p_receipt_id,
      'reversal_financial_transaction_id',v_result->'reversal_financial_transaction_id',
      'idempotency_key',p_idempotency_key,
      'reason_code',v_reason
    ),
    v_scope,p_idempotency_key,v_fingerprint);
  return v_result;
end;
$$;

create function public.admin_refund_creator_premium_subscription_period_v1(
  p_period_id uuid,
  p_idempotency_key uuid,
  p_reason_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason_code,'')));
  v_scope text;
  v_fingerprint text;
  v_prior private.admin_action_audit;
  v_result jsonb;
  v_period private.creator_premium_subscription_periods;
begin
  v_actor:=public.admin_require_capability('creator_premium.refunds.write');
  if p_period_id is null or p_idempotency_key is null
     or v_reason !~ '^[a-z][a-z0-9_]{0,79}$' then
    raise exception using errcode='22023',message='creator_premium_admin_refund_invalid';
  end if;
  v_scope:='v1|human|'||v_actor::text
    ||'|creator_premium.refunds.write|creator_premium.subscription_refund';
  v_fingerprint:=private.admin_request_fingerprint(pg_catalog.jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','creator_premium.refunds.write',
    'action','creator_premium.subscription_refund',
    'target_type','creator_premium_subscription_period',
    'target_id',p_period_id,'reason',v_reason));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select audit.* into v_prior from private.admin_action_audit audit
  where audit.idempotency_scope=v_scope and audit.idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return (v_prior.metadata->'receipt') || pg_catalog.jsonb_build_object(
      'money_moved',false,
      'replayed',true,
      'already_refunded',true
    );
  end if;
  select period.* into v_period
  from private.creator_premium_subscription_periods period
  where period.id=p_period_id;
  if not found then
    raise exception using errcode='P0002',message='creator_premium_subscription_period_not_found';
  end if;
  v_result:=public.refund_creator_premium_subscription_period_v1(
    p_period_id,p_idempotency_key,v_reason);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,
    target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,
    metadata,idempotency_scope,idempotency_key,request_fingerprint
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),
    'creator_premium.refunds.write','creator_premium','creator_premium.subscription_refund',
    'creator_premium_subscription_period',p_period_id,p_period_id::text,v_reason,
    case when coalesce((v_result->>'money_moved')::boolean,false)
      then 'succeeded' else 'no_op' end,
    true,true,pg_catalog.jsonb_build_object(
      'receipt',v_result,
      'result',case when coalesce((v_result->>'money_moved')::boolean,false)
        then 'refunded' else 'already_refunded' end,
      'money_moved',coalesce((v_result->>'money_moved')::boolean,false),
      'replayed',coalesce((v_result->>'replayed')::boolean,false),
      'already_refunded',coalesce((v_result->>'already_refunded')::boolean,false),
      'reference_id',p_period_id,
      'reversal_financial_transaction_id',v_result->'reversal_financial_transaction_id',
      'idempotency_key',p_idempotency_key,
      'reason_code',v_reason
    ),
    v_scope,p_idempotency_key,v_fingerprint);
  return v_result;
end;
$$;

-- B7-F2: Creator Premium joins the one canonical Content Safety queue. The
-- snapshot fingerprints metadata plus the exact current private original so a
-- PASS can never be reused after a media or commercial-state change.
create or replace function private.content_safety_target_snapshot(
  p_target_type text,
  p_target_id uuid
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if p_target_type='video' then
    select pg_catalog.jsonb_build_object(
      'owner_user_id',v.user_id,'scope','video_caption','text_value',coalesce(v.caption,''),
      'reach',greatest(v.views_count,0),'path','/content/video/'||v.id::text,
      'summary',left(nullif(btrim(v.caption),''),300),
      'content_version',pg_catalog.jsonb_build_object('caption',v.caption,'video_url',v.video_url,'media_urls',v.media_urls,'edited_at',v.edited_at,'created_at',v.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.videos v where v.id=p_target_id;
  elsif p_target_type='comment' then
    select pg_catalog.jsonb_build_object(
      'owner_user_id',c.user_id,'scope','comment','text_value',coalesce(c.text,''),'reach',0,
      'path','/content/comment/'||c.id::text,'summary',left(c.text,300),
      'content_version',pg_catalog.jsonb_build_object('text',c.text,'created_at',c.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.comments c where c.id=p_target_id;
  elsif p_target_type='story' then
    select pg_catalog.jsonb_build_object(
      'owner_user_id',s.user_id,'scope','story_text',
      'text_value',coalesce((select pg_catalog.string_agg(nullif(btrim(e->>'text'),''),' ' order by ordinality)
        from pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality as x(e,ordinality)
        where e->>'type'='text'),''),
      'reach',(select count(*) from public.story_views sv where sv.story_id=s.id),
      'path','/stories/'||s.id::text,
      'summary',left(coalesce((select pg_catalog.string_agg(nullif(btrim(e->>'text'),''),' ' order by ordinality)
        from pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality as x(e,ordinality)
        where e->>'type'='text'),''),300),
      'content_version',pg_catalog.jsonb_build_object('composition',s.story_composition,'media_url',s.media_url,'media_type',s.media_type,'story_kind',s.story_kind,'shared_video_id',s.shared_video_id,'created_at',s.created_at)::text,
      'shared_video_id',s.shared_video_id
    ) into v_result from public.stories s where s.id=p_target_id;
  elsif p_target_type='live_message' then
    select pg_catalog.jsonb_build_object(
      'owner_user_id',m.user_id,'scope','live_chat','text_value',coalesce(m.message,''),'reach',0,
      'path','/live/'||m.session_id::text,'summary',left(m.message,300),
      'content_version',pg_catalog.jsonb_build_object('message',m.message,'created_at',m.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.live_messages m where m.id=p_target_id;
  elsif p_target_type='message' then
    select pg_catalog.jsonb_build_object(
      'owner_user_id',m.sender_id,'scope','reported_message','text_value',coalesce(m.text,''),'reach',0,
      'path','/reports','summary',left(m.text,160),
      'content_version',pg_catalog.jsonb_build_object('text',m.text,'message_type',m.message_type,'deleted_at',m.deleted_at,'created_at',m.created_at)::text,
      'shared_video_id',null
    ) into v_result
    from public.messages m
    where m.id=p_target_id and exists(
      select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
    );
  elsif p_target_type='creator_premium' then
    select pg_catalog.jsonb_build_object(
      'owner_user_id',content.creator_id,
      'scope','creator_premium_text',
      'text_value',content.title||E'\n'||coalesce(content.description,''),
      'reach',0,
      'path','/creator-premium/'||content.id::text,
      'summary',left(content.title,300),
      'content_version',pg_catalog.jsonb_build_object(
        'title',content.title,'description',content.description,
        'content_kind',content.content_kind,'access_mode',content.access_mode,
        'verification_generation',content.verification_generation,
        'teaser_asset_id',teaser.asset_id,'teaser_status',teaser.status,
        'media_asset_id',image_original.asset_id,'media_status',image_original.status,
        'video_asset_id',video_original.asset_id,'video_status',video_original.status,
        'offer_id',offer.id,'offer_version',offer.version,'offer_price_bdag',offer.price_bdag,
        'eligible_plan_facts',coalesce(plans.facts,'[]'::jsonb),
        'pending_report_count',coalesce(report_signal.pending_count,0),
        'latest_report_at',report_signal.latest_report_at
      )::text,
      'shared_video_id',null,
      'media_asset_id',image_original.asset_id,
      'video_asset_id',video_original.asset_id
    ) into v_result
    from private.creator_premium_contents content
    left join lateral (
      select asset.id asset_id,asset.status
      from public.media_asset_links link
      join public.media_assets asset on asset.id=link.asset_id
      where link.entity_type='creator_premium_content' and link.entity_id=content.id
        and link.slot='teaser' and link."position"=0
        and asset.owner_id=content.creator_id
        and asset.purpose='creator_premium_teaser_image'
      limit 1
    ) teaser on true
    left join lateral (
      select asset.id asset_id,asset.status
      from public.media_asset_links link
      join public.media_assets asset on asset.id=link.asset_id
      where link.entity_type='creator_premium_content' and link.entity_id=content.id
        and link.slot='original' and link."position"=0
        and asset.owner_id=content.creator_id
        and asset.purpose='creator_premium_original_image'
      limit 1
    ) image_original on true
    left join lateral (
      select asset.id asset_id,asset.status
      from public.video_asset_links link
      join public.video_assets asset on asset.id=link.asset_id
      where link.entity_type='creator_premium_content' and link.entity_id=content.id
        and link.slot='original' and link."position"=0
        and asset.owner_id=content.creator_id
        and asset.purpose='creator_premium_video'
      limit 1
    ) video_original on true
    left join lateral (
      select active_offer.id,active_offer.version,active_offer.price_bdag
      from private.creator_premium_offer_versions active_offer
      where active_offer.content_id=content.id and active_offer.creator_id=content.creator_id
        and active_offer.status='active'
      order by active_offer.version desc limit 1
    ) offer on true
    left join lateral (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',plan.id,'plan_key',plan.plan_key,'version',plan.version,
        'price_bdag',plan.price_bdag,'billing_period_days',plan.billing_period_days
      ) order by plan.id) facts
      from private.creator_premium_plan_contents mapping
      join private.creator_premium_plans plan on plan.id=mapping.plan_id and plan.creator_id=mapping.creator_id
      where mapping.content_id=content.id and mapping.creator_id=content.creator_id
        and plan.status in('draft','active')
    ) plans on true
    left join lateral (
      select pg_catalog.count(*) filter (where report.status='pending')::bigint pending_count,
        pg_catalog.max(report.created_at) latest_report_at
      from public.reports report
      where report.reported_content_type='creator_premium'
        and report.reported_content_id=content.id
    ) report_signal on true
    where content.id=p_target_id
      and content.lifecycle_status in ('draft','pending_review','published','rejected','quarantined','removed');
  end if;
  return v_result;
end;
$$;

create or replace function private.content_safety_audio_source(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_asset public.video_assets;v_media public.media_assets;v_shared uuid;v_source jsonb;v_content private.creator_premium_contents;
begin
  if p_target_type='creator_premium' then
    select * into v_content from private.creator_premium_contents where id=p_target_id;
    if not found then return pg_catalog.jsonb_build_object('kind','not_configured','reason','creator_premium_content_not_found');end if;
    if v_content.content_kind='image' then return pg_catalog.jsonb_build_object('kind','not_applicable','reason','canonical_image');end if;
    select asset.* into v_asset
    from public.video_asset_links link join public.video_assets asset on asset.id=link.asset_id
    where link.entity_type='creator_premium_content' and link.entity_id=v_content.id
      and link.slot='original' and link."position"=0
      and link.owner_id=v_content.creator_id and asset.owner_id=v_content.creator_id
      and asset.purpose='creator_premium_video'
    order by link.created_at,link.id limit 1;
    if found and v_asset.provider='cloudflare_stream' and v_asset.status='ready' and v_asset.deleted_at is null
       and v_asset.visibility='private' and nullif(pg_catalog.btrim(v_asset.cloudflare_uid),'') is not null
       and v_asset.mime_type in('video/mp4','video/quicktime','video/webm')
       and v_asset.duration_seconds>0 and v_asset.duration_seconds<=60
       and v_asset.provider_metadata->'require_signed_urls'='true'::jsonb
       and v_asset.hls_url is null and v_asset.dash_url is null and v_asset.thumbnail_url is null then
      return pg_catalog.jsonb_build_object('kind','eligible','source_asset_id',v_asset.id,
        'cloudflare_uid',v_asset.cloudflare_uid,'duration_seconds',v_asset.duration_seconds,
        'provider',v_asset.provider,'model','@cf/openai/whisper-large-v3-turbo');
    end if;
    return pg_catalog.jsonb_build_object('kind','not_configured','reason','creator_premium_private_audio_source_unavailable');
  elsif p_target_type='video' then
    select a.* into v_asset from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
    where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='video' and l.position=0
    order by l.created_at,l.id limit 1;
    if found and v_asset.provider='cloudflare_stream' and v_asset.status='ready' and v_asset.deleted_at is null
       and nullif(btrim(v_asset.cloudflare_uid),'') is not null and v_asset.mime_type like 'video/%'
       and v_asset.duration_seconds>0 and v_asset.duration_seconds<=60 and v_asset.visibility='public' then
      return pg_catalog.jsonb_build_object('kind','eligible','source_asset_id',v_asset.id,'cloudflare_uid',v_asset.cloudflare_uid,
        'duration_seconds',v_asset.duration_seconds,'provider',v_asset.provider,'model','@cf/openai/whisper-large-v3-turbo');
    end if;
    select a.* into v_media from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
    where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='media' and l.position=0
    order by l.created_at,l.id limit 1;
    if found and v_media.status='ready' and v_media.deleted_at is null and v_media.media_kind='image' and v_media.mime_type like 'image/%' then
      return pg_catalog.jsonb_build_object('kind','not_applicable','reason','canonical_image');
    end if;
    return pg_catalog.jsonb_build_object('kind','not_configured','reason','canonical_audio_source_unavailable');
  elsif p_target_type='story' then
    select s.shared_video_id into v_shared from public.stories s where s.id=p_target_id;
    if not found then return pg_catalog.jsonb_build_object('kind','not_configured','reason','canonical_audio_source_unavailable');end if;
    if v_shared is not null then
      v_source:=private.content_safety_audio_source('video',v_shared);
      return v_source||pg_catalog.jsonb_build_object('kind',case v_source->>'kind' when 'eligible' then 'shared_video' when 'not_applicable' then 'not_applicable' else 'not_configured' end,'shared_video_id',v_shared);
    end if;
    select a.* into v_media from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
    where l.entity_type='story' and l.entity_id=p_target_id and l.slot='media' and l.position=0
    order by l.created_at,l.id limit 1;
    if found and v_media.status='ready' and v_media.deleted_at is null and v_media.media_kind='image' and v_media.mime_type like 'image/%' then
      return pg_catalog.jsonb_build_object('kind','not_applicable','reason','canonical_image');
    end if;
    return pg_catalog.jsonb_build_object('kind','not_configured','reason','canonical_audio_source_unavailable');
  end if;
  return pg_catalog.jsonb_build_object('kind','not_applicable','reason','text_only_target');
end;
$$;

create or replace function private.content_safety_visual_source(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_video public.video_assets;v_media public.media_assets;v_shared uuid;v_source jsonb;v_has_link boolean:=false;v_content private.creator_premium_contents;
begin
  if p_target_type='creator_premium' then
    select * into v_content from private.creator_premium_contents where id=p_target_id;
    if not found then return pg_catalog.jsonb_build_object('kind','not_configured','reason','creator_premium_content_not_found');end if;
    if v_content.content_kind='image' then
      select asset.* into v_media
      from public.media_asset_links link join public.media_assets asset on asset.id=link.asset_id
      where link.entity_type='creator_premium_content' and link.entity_id=v_content.id
        and link.slot='original' and link."position"=0
        and link.owner_id=v_content.creator_id and asset.owner_id=v_content.creator_id
        and asset.purpose='creator_premium_original_image'
      order by link.created_at,link.id limit 1;
      if found and v_media.provider='r2' and v_media.status='ready' and v_media.deleted_at is null
         and v_media.visibility='private' and v_media.public_url is null and v_media.media_kind='image'
         and v_media.mime_type in('image/jpeg','image/png','image/webp')
         and nullif(pg_catalog.btrim(v_media.bucket_name),'') is not null
         and nullif(pg_catalog.btrim(v_media.object_key),'') is not null
         and v_media.size_bytes>0 and v_media.size_bytes<=25000000 then
        return pg_catalog.jsonb_build_object('kind','eligible_image','media_asset_id',v_media.id,
          'bucket_name',v_media.bucket_name,'object_key',v_media.object_key,
          'mime_type',v_media.mime_type,'size_bytes',v_media.size_bytes);
      end if;
    elsif v_content.content_kind='video' then
      select asset.* into v_video
      from public.video_asset_links link join public.video_assets asset on asset.id=link.asset_id
      where link.entity_type='creator_premium_content' and link.entity_id=v_content.id
        and link.slot='original' and link."position"=0
        and link.owner_id=v_content.creator_id and asset.owner_id=v_content.creator_id
        and asset.purpose='creator_premium_video'
      order by link.created_at,link.id limit 1;
      if found and v_video.provider='cloudflare_stream' and v_video.status='ready' and v_video.deleted_at is null
         and v_video.visibility='private'
         and v_video.provider_metadata->'require_signed_urls'='true'::jsonb
         and nullif(pg_catalog.btrim(v_video.cloudflare_uid),'') is not null
         and v_video.mime_type in('video/mp4','video/quicktime','video/webm')
         and v_video.duration_seconds>0 and v_video.duration_seconds<=60
         and v_video.hls_url is null and v_video.dash_url is null and v_video.thumbnail_url is null then
        return pg_catalog.jsonb_build_object('kind','eligible_stream_video','video_asset_id',v_video.id,
          'cloudflare_uid',v_video.cloudflare_uid,'duration_seconds',v_video.duration_seconds,'mime_type',v_video.mime_type);
      end if;
    end if;
    return pg_catalog.jsonb_build_object('kind','not_configured','reason','creator_premium_private_visual_source_unavailable');
  elsif p_target_type='video' then
    select a.* into v_video from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
      where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='video' and l.position=0
      order by l.created_at,l.id limit 1;
    if found then
      v_has_link:=true;
      if v_video.provider='cloudflare_stream' and v_video.status='ready' and v_video.deleted_at is null and v_video.visibility='public'
         and nullif(btrim(v_video.cloudflare_uid),'') is not null and v_video.mime_type like 'video/%'
         and v_video.duration_seconds>0 and v_video.duration_seconds<=60 then
        return pg_catalog.jsonb_build_object('kind','eligible_stream_video','video_asset_id',v_video.id,'cloudflare_uid',v_video.cloudflare_uid,
          'duration_seconds',v_video.duration_seconds,'mime_type',v_video.mime_type);
      end if;
    end if;
    select a.* into v_media from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='media' and l.position=0
      order by l.created_at,l.id limit 1;
    if found then
      v_has_link:=true;
      if v_media.provider='r2' and v_media.status='ready' and v_media.deleted_at is null and v_media.visibility='public'
         and v_media.media_kind='image' and v_media.mime_type in('image/jpeg','image/png','image/webp')
         and nullif(btrim(v_media.bucket_name),'') is not null and nullif(btrim(v_media.object_key),'') is not null
         and v_media.size_bytes>0 and v_media.size_bytes<=10485760 then
        return pg_catalog.jsonb_build_object('kind','eligible_image','media_asset_id',v_media.id,'bucket_name',v_media.bucket_name,
          'object_key',v_media.object_key,'mime_type',v_media.mime_type,'size_bytes',v_media.size_bytes);
      end if;
    end if;
    return pg_catalog.jsonb_build_object('kind','not_configured','reason','canonical_visual_source_unavailable');
  elsif p_target_type='story' then
    select s.shared_video_id into v_shared from public.stories s where s.id=p_target_id;
    if not found then return pg_catalog.jsonb_build_object('kind','not_configured','reason','canonical_visual_source_unavailable');end if;
    if v_shared is not null then
      v_source:=private.content_safety_visual_source('video',v_shared);
      return v_source||pg_catalog.jsonb_build_object('kind',case v_source->>'kind' when 'eligible_image' then 'shared_image' when 'eligible_stream_video' then 'shared_stream_video' else v_source->>'kind' end,'shared_video_id',v_shared);
    end if;
    return pg_catalog.jsonb_build_object('kind','not_configured','reason','canonical_visual_source_unavailable');
  end if;
  return pg_catalog.jsonb_build_object('kind','not_applicable','reason','text_only_or_private_target');
end;
$$;

create or replace function private.enqueue_content_safety_scan(
  p_target_type text,p_target_id uuid,p_requested_reason text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_snapshot jsonb;v_fingerprint text;v_id uuid;v_source_scan uuid;v_analysis_id uuid;
  v_audio text;v_visual text;v_audio_source jsonb;v_visual_source jsonb;
begin
  if p_target_type not in('video','comment','story','live_message','message','creator_premium')
     or p_requested_reason not in('content_created','content_updated','report_signal','shared_source','backfill','retry') then
    return null;
  end if;
  v_snapshot:=private.content_safety_target_snapshot(p_target_type,p_target_id);
  if v_snapshot is null then return null; end if;
  v_fingerprint:=private.content_safety_sha256(p_target_type||'|'||p_target_id::text||'|'||coalesce(v_snapshot->>'content_version',''));
  if p_target_type='story' and nullif(v_snapshot->>'shared_video_id','') is not null then
    v_source_scan:=private.enqueue_content_safety_scan('video',(v_snapshot->>'shared_video_id')::uuid,'shared_source');
  end if;
  v_audio:=case when p_target_type in('video','story','creator_premium') or (p_target_type='message' and coalesce(v_snapshot->>'scope','')='reported_message') then 'not_configured' else 'not_applicable' end;
  v_visual:=case when p_target_type in('video','story','creator_premium') then 'not_configured' else 'not_applicable' end;
  insert into private.content_safety_scans(
    target_type,target_id,owner_user_id,content_fingerprint,media_source_scan_id,status,
    requested_reason,text_status,audio_status,visual_status,reports_status,available_at
  ) values(
    p_target_type,p_target_id,(v_snapshot->>'owner_user_id')::uuid,v_fingerprint,v_source_scan,'queued',
    p_requested_reason,'pending',v_audio,v_visual,'pending',pg_catalog.clock_timestamp()
  )
  on conflict(target_type,target_id,content_fingerprint) do update set
    status=case when private.content_safety_scans.status='processing' then 'processing' else 'queued' end,
    requested_reason=excluded.requested_reason,
    media_source_scan_id=coalesce(excluded.media_source_scan_id,private.content_safety_scans.media_source_scan_id),
    text_status=case when private.content_safety_scans.status='processing' then private.content_safety_scans.text_status else 'pending' end,
    reports_status=case when private.content_safety_scans.status='processing' then private.content_safety_scans.reports_status else 'pending' end,
    attempt_count=case when private.content_safety_scans.status='processing' then private.content_safety_scans.attempt_count else 0 end,
    available_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.available_at else pg_catalog.clock_timestamp() end,
    started_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.started_at else null end,
    completed_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.completed_at else null end,
    last_error_code=case when private.content_safety_scans.status='processing' then private.content_safety_scans.last_error_code else null end,
    updated_at=pg_catalog.clock_timestamp()
  returning id into v_id;

  if p_target_type='creator_premium' then
    v_audio_source:=private.content_safety_audio_source(p_target_type,p_target_id);
    v_visual_source:=private.content_safety_visual_source(p_target_type,p_target_id);
    update private.content_safety_scans scan set
      audio_status=case v_audio_source->>'kind' when 'eligible' then case when scan.audio_status='analyzed' then 'analyzed' else 'pending' end when 'not_applicable' then 'not_applicable' else 'not_configured' end,
      audio_provider=case when v_audio_source->>'kind'='eligible' then 'cloudflare_workers_ai' else null end,
      audio_model=case when v_audio_source->>'kind'='eligible' then '@cf/openai/whisper-large-v3-turbo' else null end,
      audio_source_asset_id=case when v_audio_source->>'source_asset_id' is null then null else (v_audio_source->>'source_asset_id')::uuid end,
      audio_available_at=case when v_audio_source->>'kind'='eligible' and scan.audio_status<>'analyzed' then pg_catalog.clock_timestamp() else scan.audio_available_at end,
      audio_last_error_code=case when v_audio_source->>'kind' in('eligible','not_applicable') then null else v_audio_source->>'reason' end,
      visual_status=case when v_visual_source->>'kind' in('eligible_image','eligible_stream_video') then case when scan.visual_status='analyzed' then 'analyzed' else 'pending' end else 'not_configured' end,
      visual_provider=case when v_visual_source->>'kind' in('eligible_image','eligible_stream_video') then 'cloudflare_workers_ai' else null end,
      visual_model=case when v_visual_source->>'kind' in('eligible_image','eligible_stream_video') then '@cf/google/gemma-4-26b-a4b-it' else null end,
      visual_prompt_version=case when v_visual_source->>'kind' in('eligible_image','eligible_stream_video') then 'visual-safety-v1' else null end,
      visual_source_kind=case when v_visual_source->>'kind' in('eligible_image','eligible_stream_video') then v_visual_source->>'kind' else null end,
      visual_video_asset_id=case when v_visual_source->>'video_asset_id' is null then null else (v_visual_source->>'video_asset_id')::uuid end,
      visual_media_asset_id=case when v_visual_source->>'media_asset_id' is null then null else (v_visual_source->>'media_asset_id')::uuid end,
      visual_available_at=case when v_visual_source->>'kind' in('eligible_image','eligible_stream_video') and scan.visual_status<>'analyzed' then pg_catalog.clock_timestamp() else scan.visual_available_at end,
      visual_last_error_code=case when v_visual_source->>'kind' in('eligible_image','eligible_stream_video') then null else v_visual_source->>'reason' end,
      updated_at=pg_catalog.clock_timestamp()
    where scan.id=v_id;
    select analysis.id into v_analysis_id
    from private.content_safety_visual_analyses analysis
    where analysis.provider='cloudflare_workers_ai'
      and analysis.model='@cf/google/gemma-4-26b-a4b-it'
      and analysis.prompt_version='visual-safety-v1'
      and ((v_visual_source->>'media_asset_id' is not null
          and analysis.media_asset_id=(v_visual_source->>'media_asset_id')::uuid
          and analysis.sample_strategy='single_image_v1')
        or (v_visual_source->>'video_asset_id' is not null
          and analysis.video_asset_id=(v_visual_source->>'video_asset_id')::uuid
          and analysis.sample_strategy='percentile_5_v1'))
    order by analysis.created_at,analysis.id limit 1;
    if v_analysis_id is not null then
      perform private.content_safety_attach_visual_analysis(v_analysis_id);
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function private.content_safety_visual_producer_scan_id(
  p_video_asset_id uuid,p_media_asset_id uuid
) returns uuid language sql stable security definer set search_path=''
as $$
  select scan.id
  from private.content_safety_scans scan
  where scan.target_type in('video','creator_premium')
    and scan.visual_provider='cloudflare_workers_ai'
    and scan.visual_model='@cf/google/gemma-4-26b-a4b-it'
    and scan.visual_prompt_version='visual-safety-v1'
    and (
      (p_media_asset_id is not null and scan.visual_media_asset_id=p_media_asset_id and scan.visual_source_kind='eligible_image')
      or (p_video_asset_id is not null and scan.visual_video_asset_id=p_video_asset_id and scan.visual_source_kind='eligible_stream_video')
    )
  order by scan.created_at,scan.id limit 1;
$$;

create or replace function public.claim_content_safety_audio_scans(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row record;v_result jsonb:='[]'::jsonb;
begin
  if p_limit<1 or p_limit>1 then raise exception using errcode='22023',message='invalid_audio_claim_limit';end if;
  for v_row in
    select scan.id,scan.target_type,scan.target_id,scan.content_fingerprint,scan.audio_source_asset_id,
      scan.audio_attempt_count,asset.cloudflare_uid,asset.duration_seconds
    from private.content_safety_scans scan
    join public.video_assets asset on asset.id=scan.audio_source_asset_id
    where scan.target_type in('video','creator_premium') and scan.audio_status='pending'
      and scan.audio_attempt_count<5 and scan.audio_available_at<=pg_catalog.clock_timestamp()
      and (scan.audio_started_at is null or scan.audio_started_at<pg_catalog.clock_timestamp()-interval '10 minutes')
      and asset.provider='cloudflare_stream' and asset.status='ready' and asset.deleted_at is null
      and asset.mime_type like 'video/%' and asset.duration_seconds>0 and asset.duration_seconds<=60
      and nullif(pg_catalog.btrim(asset.cloudflare_uid),'') is not null
      and (
        (scan.target_type='video' and asset.visibility='public')
        or (scan.target_type='creator_premium' and asset.visibility='private'
          and asset.purpose='creator_premium_video'
          and asset.provider_metadata->'require_signed_urls'='true'::jsonb
          and asset.hls_url is null and asset.dash_url is null and asset.thumbnail_url is null)
      )
    order by scan.audio_available_at,scan.created_at,scan.id
    for update of scan skip locked limit p_limit
  loop
    update private.content_safety_scans set
      audio_attempt_count=audio_attempt_count+1,audio_started_at=pg_catalog.clock_timestamp(),
      audio_last_error_code=null,updated_at=pg_catalog.clock_timestamp()
    where id=v_row.id;
    v_result:=v_result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'scan_id',v_row.id,'target_type',v_row.target_type,'target_id',v_row.target_id,
      'content_fingerprint',v_row.content_fingerprint,'source_asset_id',v_row.audio_source_asset_id,
      'cloudflare_uid',v_row.cloudflare_uid,'duration_seconds',v_row.duration_seconds,
      'attempt_count',v_row.audio_attempt_count+1));
  end loop;
  return v_result;
end;
$$;

create or replace function public.complete_content_safety_audio_transcription(
  p_scan_id uuid,p_source_asset_id uuid,p_content_fingerprint text,p_detected_language text,p_transcript_text text,
  p_word_count integer,p_segments jsonb,p_no_speech boolean,p_transcript_fingerprint text,p_cleanup_pending boolean
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_transcript private.content_safety_audio_transcripts;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_audio_scan_not_found';end if;
  if v_scan.target_type not in('video','creator_premium') or v_scan.audio_status<>'pending'
     or v_scan.audio_source_asset_id is distinct from p_source_asset_id
     or v_scan.content_fingerprint<>p_content_fingerprint or p_transcript_fingerprint!~'^[0-9a-f]{64}$'
     or p_word_count<0 or pg_catalog.jsonb_typeof(p_segments)<>'array'
     or pg_catalog.pg_column_size(p_segments)>65536 or pg_catalog.char_length(coalesce(p_transcript_text,''))>100000 then
    raise exception using errcode='22023',message='invalid_content_safety_audio_completion';
  end if;
  insert into private.content_safety_audio_transcripts(
    source_scan_id,source_asset_id,source_content_fingerprint,provider,model,detected_language,
    transcript_text,word_count,segments,no_speech,transcript_fingerprint,rule_eval_status,rule_eval_available_at
  ) values(
    v_scan.id,p_source_asset_id,p_content_fingerprint,'cloudflare_workers_ai','@cf/openai/whisper-large-v3-turbo',
    nullif(pg_catalog.btrim(coalesce(p_detected_language,'')),''),coalesce(p_transcript_text,''),p_word_count,
    p_segments,coalesce(p_no_speech,false),p_transcript_fingerprint,'pending',pg_catalog.clock_timestamp()
  ) on conflict(source_scan_id,source_content_fingerprint,provider,model)
    do update set updated_at=pg_catalog.clock_timestamp()
  returning * into v_transcript;
  update private.content_safety_scans set
    audio_status='analyzed',audio_provider='cloudflare_workers_ai',audio_model='@cf/openai/whisper-large-v3-turbo',
    audio_completed_at=pg_catalog.clock_timestamp(),audio_started_at=null,audio_last_error_code=null,
    audio_cleanup_pending=coalesce(p_cleanup_pending,false),
    audio_cleanup_attempt_count=case when coalesce(p_cleanup_pending,false) then 0 else audio_cleanup_attempt_count end,
    audio_cleanup_available_at=case when coalesce(p_cleanup_pending,false) then pg_catalog.clock_timestamp()+interval '1 minute' else null end,
    audio_provider_call_count=audio_provider_call_count+1,updated_at=pg_catalog.clock_timestamp()
  where id=v_scan.id;
  if v_scan.target_type='video' then
    update private.content_safety_scans set audio_status='analyzed',audio_provider='cloudflare_workers_ai',
      audio_model='@cf/openai/whisper-large-v3-turbo',audio_completed_at=pg_catalog.clock_timestamp(),
      audio_last_error_code=null,updated_at=pg_catalog.clock_timestamp()
    where media_source_scan_id=v_scan.id and target_type='story';
  end if;
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'transcript_id',v_transcript.id,
    'audio_status','analyzed','cleanup_pending',coalesce(p_cleanup_pending,false));
end;
$$;

create or replace function public.claim_content_safety_visual_scans(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row record;v_result jsonb:='[]'::jsonb;
begin
  if p_limit<1 or p_limit>1 then raise exception using errcode='22023',message='invalid_visual_claim_limit';end if;
  for v_row in
    select scan.id,scan.target_type,scan.target_id,scan.content_fingerprint,scan.visual_source_kind,
      scan.visual_video_asset_id,scan.visual_media_asset_id,scan.visual_attempt_count,
      scan.visual_provider_call_count,scan.visual_frame_cursor,scan.visual_partial_result,
      video.cloudflare_uid,video.duration_seconds,media.bucket_name,media.object_key,media.mime_type,media.size_bytes
    from private.content_safety_scans scan
    left join public.video_assets video on video.id=scan.visual_video_asset_id
    left join public.media_assets media on media.id=scan.visual_media_asset_id
    where scan.target_type in('video','creator_premium') and scan.visual_status='pending'
      and scan.visual_analysis_id is null and scan.visual_attempt_count<5
      and scan.visual_provider_call_count<5 and scan.visual_available_at<=pg_catalog.clock_timestamp()
      and (scan.visual_started_at is null or scan.visual_started_at<pg_catalog.clock_timestamp()-interval '10 minutes')
      and scan.id=private.content_safety_visual_producer_scan_id(scan.visual_video_asset_id,scan.visual_media_asset_id)
      and private.content_safety_visual_analysis_id_for_asset(scan.visual_video_asset_id,scan.visual_media_asset_id) is null
      and (
        (scan.visual_source_kind='eligible_stream_video' and video.provider='cloudflare_stream'
          and video.status='ready' and video.deleted_at is null and video.mime_type like 'video/%'
          and video.duration_seconds>0 and video.duration_seconds<=60
          and nullif(pg_catalog.btrim(video.cloudflare_uid),'') is not null
          and ((scan.target_type='video' and video.visibility='public')
            or (scan.target_type='creator_premium' and video.visibility='private'
              and video.purpose='creator_premium_video'
              and video.provider_metadata->'require_signed_urls'='true'::jsonb
              and video.hls_url is null and video.dash_url is null and video.thumbnail_url is null)))
        or
        (scan.visual_source_kind='eligible_image' and media.provider='r2' and media.status='ready'
          and media.deleted_at is null and media.media_kind='image'
          and media.mime_type in('image/jpeg','image/png','image/webp')
          and media.size_bytes>0
          and media.size_bytes<=case when scan.target_type='creator_premium' then 25000000 else 10485760 end
          and nullif(pg_catalog.btrim(media.bucket_name),'') is not null
          and nullif(pg_catalog.btrim(media.object_key),'') is not null
          and ((scan.target_type='video' and media.visibility='public')
            or (scan.target_type='creator_premium' and media.visibility='private'
              and media.purpose='creator_premium_original_image' and media.public_url is null)))
      )
    order by scan.visual_available_at,scan.created_at,scan.id
    for update of scan skip locked limit p_limit
  loop
    update private.content_safety_scans set visual_attempt_count=visual_attempt_count+1,
      visual_started_at=pg_catalog.clock_timestamp(),visual_last_error_code=null,
      updated_at=pg_catalog.clock_timestamp() where id=v_row.id;
    v_result:=v_result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'scan_id',v_row.id,'target_type',v_row.target_type,'target_id',v_row.target_id,
      'content_fingerprint',v_row.content_fingerprint,'source_kind',v_row.visual_source_kind,
      'video_asset_id',v_row.visual_video_asset_id,'media_asset_id',v_row.visual_media_asset_id,
      'cloudflare_uid',v_row.cloudflare_uid,'duration_seconds',v_row.duration_seconds,
      'bucket_name',v_row.bucket_name,'object_key',v_row.object_key,'mime_type',v_row.mime_type,
      'size_bytes',v_row.size_bytes,'frame_cursor',v_row.visual_frame_cursor,
      'partial_result',v_row.visual_partial_result,'attempt_count',v_row.visual_attempt_count+1,
      'provider_call_count',v_row.visual_provider_call_count));
  end loop;
  return v_result;
end;
$$;

create or replace function public.advance_content_safety_visual_scan(
  p_scan_id uuid,p_expected_cursor integer,p_frame_timestamp_ms integer,p_frame_result jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_frames jsonb;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  if v_scan.target_type not in('video','creator_premium') or v_scan.visual_status<>'pending'
     or v_scan.visual_source_kind<>'eligible_stream_video' or v_scan.visual_frame_cursor<>p_expected_cursor
     or p_expected_cursor not between 0 and 3 or p_frame_timestamp_ms<0
     or pg_catalog.jsonb_typeof(p_frame_result)<>'object' or pg_catalog.pg_column_size(p_frame_result)>8192
     or v_scan.visual_provider_call_count>=5 then
    raise exception using errcode='22023',message='invalid_content_safety_visual_advance';
  end if;
  v_frames:=coalesce(v_scan.visual_partial_result->'frames','[]'::jsonb)
    ||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'frame_index',p_expected_cursor,'timestamp_ms',p_frame_timestamp_ms,'result',p_frame_result));
  if pg_catalog.pg_column_size(pg_catalog.jsonb_build_object('frames',v_frames))>32768 then
    raise exception using errcode='22023',message='content_safety_visual_partial_too_large';
  end if;
  update private.content_safety_scans set visual_frame_cursor=visual_frame_cursor+1,
    visual_partial_result=pg_catalog.jsonb_build_object('frames',v_frames),
    visual_provider_call_count=visual_provider_call_count+1,visual_attempt_count=0,
    visual_started_at=null,visual_available_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
  where id=v_scan.id;
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'visual_status','pending',
    'frame_cursor',v_scan.visual_frame_cursor+1,'provider_call_count',v_scan.visual_provider_call_count+1);
end;
$$;

create or replace function public.complete_content_safety_visual_analysis(
  p_scan_id uuid,p_content_fingerprint text,p_analysis_result jsonb,
  p_analysis_fingerprint text,p_frame_timestamps_ms integer[]
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_scan private.content_safety_scans;v_analysis private.content_safety_visual_analyses;
  v_finding jsonb;v_provider_calls integer;v_frame_count integer;v_strategy text;
  v_existing_id uuid;v_producer_id uuid;v_attach jsonb;v_inserted boolean:=false;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  v_strategy:=case when v_scan.visual_source_kind='eligible_image' then 'single_image_v1' else 'percentile_5_v1' end;
  v_existing_id:=private.content_safety_visual_analysis_id_for_asset(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
  v_provider_calls:=v_scan.visual_provider_call_count+1;
  if v_existing_id is not null then
    update private.content_safety_scans set visual_provider_call_count=v_provider_calls,
      visual_started_at=null,updated_at=pg_catalog.clock_timestamp() where id=v_scan.id;
    v_attach:=private.content_safety_attach_visual_analysis(v_existing_id);
    return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'analysis_id',v_existing_id,
      'visual_status','analyzed','alerts_processed',coalesce((v_attach->>'alerts_processed')::integer,0),
      'provider_call_count',v_provider_calls,'race_reused',true);
  end if;
  v_producer_id:=private.content_safety_visual_producer_scan_id(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
  v_frame_count:=case when v_scan.visual_source_kind='eligible_image' then 1 else pg_catalog.cardinality(p_frame_timestamps_ms) end;
  if v_scan.target_type not in('video','creator_premium') or v_scan.id is distinct from v_producer_id
     or v_scan.visual_status<>'pending' or v_scan.content_fingerprint<>p_content_fingerprint
     or v_scan.visual_source_kind not in('eligible_image','eligible_stream_video')
     or v_provider_calls not between 1 and 5 or p_analysis_fingerprint!~'^[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(p_analysis_result)<>'object' or pg_catalog.pg_column_size(p_analysis_result)>32768
     or p_analysis_result->>'schema_version'<>'visual-safety-v1'
     or pg_catalog.jsonb_typeof(p_analysis_result->'review_required')<>'boolean'
     or pg_catalog.jsonb_typeof(p_analysis_result->'findings')<>'array'
     or pg_catalog.jsonb_array_length(p_analysis_result->'findings')>10
     or pg_catalog.jsonb_typeof(p_analysis_result->'summary')<>'string'
     or pg_catalog.char_length(p_analysis_result->>'summary')>500
     or (v_scan.visual_source_kind='eligible_image' and pg_catalog.cardinality(p_frame_timestamps_ms)<>0)
     or (v_scan.visual_source_kind='eligible_stream_video' and
       (v_frame_count<1 or v_frame_count>5 or v_scan.visual_frame_cursor<>v_frame_count-1))
     or ((p_analysis_result->>'review_required')::boolean and pg_catalog.jsonb_array_length(p_analysis_result->'findings')=0)
     or (not (p_analysis_result->>'review_required')::boolean and pg_catalog.jsonb_array_length(p_analysis_result->'findings')<>0) then
    raise exception using errcode='22023',message='invalid_content_safety_visual_completion';
  end if;
  if exists(
    select 1 from pg_catalog.unnest(p_frame_timestamps_ms) with ordinality a(value,pos)
    join pg_catalog.unnest(p_frame_timestamps_ms) with ordinality b(value,pos) on b.pos=a.pos+1
    where b.value<=a.value
  ) or exists(select 1 from pg_catalog.unnest(p_frame_timestamps_ms) value where value<0) then
    raise exception using errcode='22023',message='invalid_visual_frame_timestamps';
  end if;
  for v_finding in select value from pg_catalog.jsonb_array_elements(p_analysis_result->'findings') loop
    if pg_catalog.jsonb_typeof(v_finding)<>'object'
       or (select count(*) from pg_catalog.jsonb_object_keys(v_finding))<>4
       or not(v_finding?'category' and v_finding?'triage_level' and v_finding?'description' and v_finding?'frame_index')
       or v_finding->>'category' not in('violence','threat','sexual','self_harm','drugs','weapons','fraud','spam','other')
       or v_finding->>'triage_level' not in('low','medium','high','critical')
       or pg_catalog.char_length(v_finding->>'description')>240
       or (v_scan.visual_source_kind='eligible_image' and pg_catalog.jsonb_typeof(v_finding->'frame_index')<>'null')
       or (v_scan.visual_source_kind='eligible_stream_video' and (
         pg_catalog.jsonb_typeof(v_finding->'frame_index')<>'number'
         or (v_finding->>'frame_index')::integer<0 or (v_finding->>'frame_index')::integer>=v_frame_count
       )) then
      raise exception using errcode='22023',message='invalid_content_safety_visual_finding';
    end if;
  end loop;
  insert into private.content_safety_visual_analyses(
    source_scan_id,video_asset_id,media_asset_id,source_content_fingerprint,provider,model,prompt_version,
    sample_strategy,frame_count,frame_timestamps_ms,analysis_result,analysis_fingerprint,provider_call_count
  ) values(
    v_scan.id,v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,v_scan.content_fingerprint,
    'cloudflare_workers_ai','@cf/google/gemma-4-26b-a4b-it','visual-safety-v1',v_strategy,
    v_frame_count,p_frame_timestamps_ms,p_analysis_result,p_analysis_fingerprint,v_provider_calls
  ) on conflict do nothing returning * into v_analysis;
  if v_analysis.id is null then
    v_existing_id:=private.content_safety_visual_analysis_id_for_asset(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
    if v_existing_id is null then raise exception using errcode='23505',message='content_safety_visual_analysis_race_unresolved';end if;
    select * into v_analysis from private.content_safety_visual_analyses where id=v_existing_id;
  else v_inserted:=true;
  end if;
  update private.content_safety_scans set visual_provider_call_count=v_provider_calls,
    visual_frame_cursor=v_frame_count,visual_started_at=null,updated_at=pg_catalog.clock_timestamp()
  where id=v_scan.id;
  v_attach:=private.content_safety_attach_visual_analysis(v_analysis.id);
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'analysis_id',v_analysis.id,
    'visual_status','analyzed','alerts_processed',coalesce((v_attach->>'alerts_processed')::integer,0),
    'provider_call_count',v_provider_calls,'frame_count',v_frame_count,'race_reused',not v_inserted);
end;
$$;

create or replace function private.content_safety_create_visual_alerts_for_scan(
  p_scan_id uuid,p_analysis_id uuid
) returns integer language plpgsql security definer set search_path=''
as $$
declare
  v_scan private.content_safety_scans;v_analysis private.content_safety_visual_analyses;
  v_category text;v_severity text;v_description text;v_frame_indexes integer[];v_frame_times integer[];
  v_snapshot jsonb;v_total integer;v_pending integer;v_recent integer;v_latest timestamptz;
  v_warnings integer;v_reach bigint;v_priority integer;v_count integer:=0;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id;
  select * into v_analysis from private.content_safety_visual_analyses where id=p_analysis_id;
  if v_scan.id is null or v_analysis.id is null or v_scan.target_type not in('video','creator_premium') then return 0;end if;
  if not coalesce((v_analysis.analysis_result->>'review_required')::boolean,false) then return 0;end if;
  v_snapshot:=private.content_safety_target_snapshot(v_scan.target_type,v_scan.target_id);
  select count(*)::integer,count(*) filter(where report.status='pending')::integer,
    count(*) filter(where report.status='pending' and report.created_at>=pg_catalog.clock_timestamp()-interval '15 minutes')::integer,
    max(report.created_at)
  into v_total,v_pending,v_recent,v_latest
  from public.reports report
  where report.reported_content_type=v_scan.target_type and report.reported_content_id=v_scan.target_id;
  select count(*)::integer into v_warnings from private.admin_user_warnings warning
  where warning.target_user_id=v_scan.owner_user_id and warning.status='active'
    and warning.issued_at>coalesce((select max(action.completed_at)
      from private.admin_user_moderation_actions action
      where action.target_user_id=v_scan.owner_user_id and action.action='restore'
        and action.status='succeeded'),'-infinity'::timestamptz);
  v_warnings:=least(coalesce(v_warnings,0),3);
  v_reach:=greatest(coalesce((v_snapshot->>'reach')::bigint,0),0);
  for v_category in select distinct finding.value->>'category'
    from pg_catalog.jsonb_array_elements(v_analysis.analysis_result->'findings') finding(value)
  loop
    select finding.value->>'triage_level' into v_severity
    from pg_catalog.jsonb_array_elements(v_analysis.analysis_result->'findings') finding(value)
    where finding.value->>'category'=v_category
    order by case finding.value->>'triage_level' when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc limit 1;
    select left(pg_catalog.string_agg(finding.value->>'description',' · ' order by finding.ordinality),240),
      coalesce(pg_catalog.array_agg(distinct (finding.value->>'frame_index')::integer order by (finding.value->>'frame_index')::integer)
        filter(where pg_catalog.jsonb_typeof(finding.value->'frame_index')='number'),'{}'::integer[])
    into v_description,v_frame_indexes
    from pg_catalog.jsonb_array_elements(v_analysis.analysis_result->'findings') with ordinality finding(value,ordinality)
    where finding.value->>'category'=v_category;
    if v_analysis.video_asset_id is not null then
      select coalesce(pg_catalog.array_agg(v_analysis.frame_timestamps_ms[index+1] order by index),'{}'::integer[])
      into v_frame_times from pg_catalog.unnest(v_frame_indexes) index
      where index>=0 and index<pg_catalog.cardinality(v_analysis.frame_timestamps_ms);
    else v_frame_times:='{}'::integer[];
    end if;
    v_priority:=private.content_safety_priority(v_severity,v_pending,v_recent,v_warnings,v_reach);
    insert into private.content_safety_alerts(
      scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,confidence,
      priority_score,alert_fingerprint,reach,related_report_count,pending_report_count,reports_last_15m,
      latest_report_at,active_warning_count,evidence
    ) values(
      v_scan.id,v_scan.target_type,v_scan.target_id,v_scan.owner_user_id,'visual_classifier',null,
      v_category,v_severity,null,v_priority,
      private.content_safety_sha256(v_scan.id::text||'|'||v_analysis.id::text||'|visual_classifier|'||v_category||'|'||v_analysis.prompt_version),
      v_reach,v_total,v_pending,v_recent,v_latest,v_warnings,
      pg_catalog.jsonb_build_object('visual_analysis_id',v_analysis.id,'provider',v_analysis.provider,
        'model',v_analysis.model,'prompt_version',v_analysis.prompt_version,
        'sample_strategy',v_analysis.sample_strategy,'category',v_category,
        'model_triage_level',v_severity,'description',v_description,
        'frame_indexes',pg_catalog.to_jsonb(v_frame_indexes),
        'frame_timestamps_ms',pg_catalog.to_jsonb(v_frame_times),
        'analysis_fingerprint',v_analysis.analysis_fingerprint)
    ) on conflict(alert_fingerprint) do update set priority_score=excluded.priority_score,
      reach=excluded.reach,related_report_count=excluded.related_report_count,
      pending_report_count=excluded.pending_report_count,reports_last_15m=excluded.reports_last_15m,
      latest_report_at=excluded.latest_report_at,active_warning_count=excluded.active_warning_count,
      evidence=excluded.evidence,updated_at=pg_catalog.clock_timestamp();
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function private.content_safety_attach_visual_analysis(p_analysis_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_analysis private.content_safety_visual_analyses;v_scan_id uuid;
  v_scan_count integer:=0;v_story_count integer:=0;v_alert_count integer:=0;
begin
  select * into v_analysis from private.content_safety_visual_analyses where id=p_analysis_id;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_analysis_not_found';end if;
  update private.content_safety_scans scan set visual_analysis_id=v_analysis.id,
    visual_status='analyzed',visual_provider=v_analysis.provider,visual_model=v_analysis.model,
    visual_prompt_version=v_analysis.prompt_version,
    visual_completed_at=coalesce(scan.visual_completed_at,v_analysis.created_at),
    visual_started_at=null,visual_last_error_code=null,visual_attempt_count=0,
    visual_partial_result=null,updated_at=pg_catalog.clock_timestamp()
  where scan.target_type in('video','creator_premium') and (
    (v_analysis.media_asset_id is not null and scan.visual_media_asset_id=v_analysis.media_asset_id and scan.visual_source_kind='eligible_image')
    or (v_analysis.video_asset_id is not null and scan.visual_video_asset_id=v_analysis.video_asset_id and scan.visual_source_kind='eligible_stream_video')
  );
  get diagnostics v_scan_count=row_count;
  update private.content_safety_scans story set visual_analysis_id=v_analysis.id,
    visual_provider=v_analysis.provider,visual_model=v_analysis.model,
    visual_prompt_version=v_analysis.prompt_version,
    visual_source_kind=case when v_analysis.media_asset_id is not null then 'shared_image' else 'shared_stream_video' end,
    visual_video_asset_id=v_analysis.video_asset_id,visual_media_asset_id=v_analysis.media_asset_id,
    visual_status='analyzed',visual_completed_at=coalesce(story.visual_completed_at,v_analysis.created_at),
    visual_started_at=null,visual_last_error_code=null,visual_attempt_count=0,
    visual_partial_result=null,updated_at=pg_catalog.clock_timestamp()
  where story.target_type='story' and exists(
    select 1 from private.content_safety_scans source_scan
    where source_scan.id=story.media_source_scan_id and (
      (v_analysis.media_asset_id is not null and source_scan.visual_media_asset_id=v_analysis.media_asset_id)
      or (v_analysis.video_asset_id is not null and source_scan.visual_video_asset_id=v_analysis.video_asset_id)
    ));
  get diagnostics v_story_count=row_count;
  for v_scan_id in select scan.id from private.content_safety_scans scan
    where scan.target_type in('video','creator_premium') and scan.visual_analysis_id=v_analysis.id
  loop
    v_alert_count:=v_alert_count+private.content_safety_create_visual_alerts_for_scan(v_scan_id,v_analysis.id);
  end loop;
  return pg_catalog.jsonb_build_object('analysis_id',v_analysis.id,'scans_attached',v_scan_count,
    'stories_attached',v_story_count,'alerts_processed',v_alert_count);
end;
$$;

create or replace function private.preview_content_safety_rule_definition(
  p_rule_id uuid,p_rule_version bigint,p_detector_type text,p_pattern text,
  p_scopes text[],p_locale text,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_scopes text[];v_result jsonb;v_definition_fingerprint text;
begin
  v_scopes:=array(select distinct pg_catalog.btrim(value)
    from pg_catalog.unnest(pg_catalog.coalesce(p_scopes,'{}'::text[])) value order by 1);
  if p_detector_type not in('keyword','phrase')
     or pg_catalog.nullif(pg_catalog.btrim(pg_catalog.coalesce(p_pattern,'')),'') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_pattern))>200 or pg_catalog.cardinality(v_scopes)=0
     or not(v_scopes<@array[
       'video_caption','comment','story_text','live_chat','reported_message','transcript','creator_premium_text'
     ]::text[])
     or p_locale not in('und','en','es') or p_limit<1 or p_limit>20
     or (p_detector_type='keyword' and private.normalize_content_safety_text(p_pattern)~'[[:space:]]') then
    raise exception using errcode='22023',message='invalid_content_safety_rule_preview';
  end if;
  v_definition_fingerprint:=private.content_safety_rule_definition_fingerprint(
    p_rule_id,p_rule_version,p_detector_type,p_pattern,v_scopes,p_locale
  );
  with candidates as materialized (
    select 'video'::text target_type,v.id target_id,v.user_id owner_user_id,'video_caption'::text scope,
      pg_catalog.coalesce(v.caption,'') text_value,pg_catalog.coalesce(ms.visibility,'visible') current_visibility
    from public.videos v left join private.admin_content_moderation_state ms
      on ms.target_type='video' and ms.target_id=v.id
    where 'video_caption'=any(v_scopes)
    union all
    select 'comment',c.id,c.user_id,'comment',pg_catalog.coalesce(c.text,''),pg_catalog.coalesce(ms.visibility,'visible')
    from public.comments c left join private.admin_content_moderation_state ms
      on ms.target_type='comment' and ms.target_id=c.id
    where 'comment'=any(v_scopes)
    union all
    select 'story',s.id,s.user_id,'story_text',pg_catalog.coalesce((
      select pg_catalog.string_agg(pg_catalog.nullif(pg_catalog.btrim(e->>'text'),''),' ' order by ordinality)
      from pg_catalog.jsonb_array_elements(pg_catalog.coalesce(s.story_composition->'elements','[]'::jsonb))
        with ordinality x(e,ordinality)
      where e->>'type'='text'
    ),''),pg_catalog.coalesce(ms.visibility,'visible')
    from public.stories s left join private.admin_content_moderation_state ms
      on ms.target_type='story' and ms.target_id=s.id
    where 'story_text'=any(v_scopes)
    union all
    select 'live_message',m.id,m.user_id,'live_chat',pg_catalog.coalesce(m.message,''),'visible'
    from public.live_messages m where 'live_chat'=any(v_scopes)
    union all
    select 'message',m.id,m.sender_id,'reported_message',pg_catalog.coalesce(m.text,''),'reported_only'
    from public.messages m where 'reported_message'=any(v_scopes) and exists(
      select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
    )
    union all
    select 'creator_premium',content.id,content.creator_id,'creator_premium_text',
      pg_catalog.concat_ws(' ',content.title,content.description),content.lifecycle_status
    from private.creator_premium_contents content
    where 'creator_premium_text'=any(v_scopes) and content.lifecycle_status<>'deleted'
  ), matches as materialized (
    select * from candidates c
    where private.content_safety_text_matches(c.text_value,p_pattern,p_detector_type)
  ), samples as (
    select m.*,p.username,p.display_name
    from matches m left join public.user_profiles p on p.id=m.owner_user_id
    order by m.target_type,m.target_id limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'rule_id',p_rule_id,'rule_version',p_rule_version,'definition_fingerprint',v_definition_fingerprint,
    'detector_type',p_detector_type,'normalized_pattern',private.normalize_content_safety_text(p_pattern),
    'locale',p_locale,'scopes',v_scopes,'total_matching_content',(select pg_catalog.count(*) from matches),
    'counts',pg_catalog.jsonb_build_object(
      'videos',(select pg_catalog.count(*) from matches where target_type='video'),
      'stories',(select pg_catalog.count(*) from matches where target_type='story'),
      'comments',(select pg_catalog.count(*) from matches where target_type='comment'),
      'live_chat',(select pg_catalog.count(*) from matches where target_type='live_message'),
      'reported_messages',(select pg_catalog.count(*) from matches where target_type='message'),
      'creator_premium',(select pg_catalog.count(*) from matches where target_type='creator_premium')
    ),
    'samples',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'target_type',target_type,'target_id',target_id,'scope',scope,
      'author',pg_catalog.jsonb_build_object('id',owner_user_id,'username',username,'display_name',display_name),
      'excerpt',pg_catalog.left(private.normalize_content_safety_text(text_value),240),
      'current_visibility',current_visibility
    ) order by target_type,target_id) from samples),'[]'::jsonb),
    'sample_limit',p_limit,'excerpt_limit',240,'creates_alerts',false,'creates_scans',false,
    'modifies_content',false,'ordinary_private_messages_included',false,
    'private_premium_originals_included',false
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.search_admin_content_safety_alerts(
  p_severity text default null,p_status text default null,p_category text default null,
  p_target_type text default null,p_source_type text default null,p_coverage text default null,
  p_cursor_priority integer default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  if p_limit<1 or p_limit>100
     or (p_severity is not null and p_severity not in('low','medium','high','critical'))
     or (p_status is not null and p_status not in('open','in_review','dismissed','resolved'))
     or (p_target_type is not null and p_target_type not in(
       'video','comment','story','live_message','message','creator_premium'))
     or (p_source_type is not null and p_source_type not in(
       'text_rule','user_reports','audio_classifier','audio_transcript_rule','visual_classifier'))
     or (p_coverage is not null and p_coverage not in('complete','incomplete','failed','pending')) then
    raise exception using errcode='22023',message='invalid_content_safety_filter';
  end if;
  return (
    with filtered as (
      select alert.*,scan.text_status,scan.audio_status,scan.visual_status,scan.reports_status,
        scan.status scan_status,rule.code rule_code,rule.label rule_label,
        case when alert.priority_score>=85 then 'critical' when alert.priority_score>=65 then 'high'
             when alert.priority_score>=40 then 'medium' else 'low' end priority_bucket
      from private.content_safety_alerts alert
      join private.content_safety_scans scan on scan.id=alert.scan_id
      left join private.content_safety_rules rule on rule.id=alert.rule_id
      where (p_severity is null or alert.severity=p_severity)
        and (p_status is null or alert.status=p_status)
        and (p_category is null or alert.category=p_category)
        and (p_target_type is null or alert.target_type=p_target_type)
        and (p_source_type is null or alert.source_type=p_source_type)
        and (p_coverage is null
          or (p_coverage='complete' and scan.text_status='analyzed' and scan.reports_status='analyzed'
            and scan.audio_status in('analyzed','not_applicable')
            and scan.visual_status in('analyzed','not_applicable'))
          or (p_coverage='incomplete' and (scan.audio_status='not_configured' or scan.visual_status='not_configured'))
          or (p_coverage='failed' and (scan.text_status='failed' or scan.audio_status='failed'
            or scan.visual_status='failed' or scan.reports_status='failed'))
          or (p_coverage='pending' and (scan.text_status='pending' or scan.audio_status='pending'
            or scan.visual_status='pending' or scan.reports_status='pending')))
        and (p_cursor_priority is null or alert.priority_score<p_cursor_priority
          or (alert.priority_score=p_cursor_priority and alert.created_at>p_cursor_created_at)
          or (alert.priority_score=p_cursor_priority and alert.created_at=p_cursor_created_at and alert.id>p_cursor_id))
      order by alert.priority_score desc,alert.created_at,alert.id limit p_limit
    ), stats as (
      select pg_catalog.count(*) filter(where status='open') open_count,
        pg_catalog.count(*) filter(where status='in_review') in_review_count,
        pg_catalog.count(*) filter(where status='resolved') resolved_count,
        pg_catalog.count(*) filter(where status='dismissed') dismissed_count,
        pg_catalog.count(*) filter(where priority_score>=85 and status in('open','in_review')) critical_count,
        pg_catalog.count(*) filter(where priority_score between 65 and 84 and status in('open','in_review')) high_count,
        pg_catalog.count(*) filter(where priority_score between 40 and 64 and status in('open','in_review')) medium_count,
        pg_catalog.count(*) filter(where priority_score<40 and status in('open','in_review')) low_count
      from private.content_safety_alerts
    )
    select pg_catalog.jsonb_build_object(
      'stats',(select pg_catalog.to_jsonb(stats) from stats),
      'active_rule_count',(select pg_catalog.count(*) from private.content_safety_rules where enabled),
      'items',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',row.id,'target_type',row.target_type,'target_id',row.target_id,'owner_user_id',row.owner_user_id,
        'author',pg_catalog.jsonb_build_object('id',profile.id,'username',profile.username,
          'display_name',profile.display_name,'avatar_url',profile.avatar_url),
        'source_type',row.source_type,'category',row.category,'severity',row.severity,
        'priority_score',row.priority_score,'priority_bucket',row.priority_bucket,
        'status',row.status,'rule_code',row.rule_code,'rule_label',row.rule_label,
        'evidence_excerpt',pg_catalog.coalesce(row.evidence->>'matched_text_excerpt',row.evidence->>'description'),
        'reach',row.reach,'related_report_count',row.related_report_count,
        'pending_report_count',row.pending_report_count,'reports_last_15m',row.reports_last_15m,
        'active_warning_count',row.active_warning_count,
        'coverage',pg_catalog.jsonb_build_object('text',row.text_status,'audio',row.audio_status,
          'visual',row.visual_status,'reports',row.reports_status),
        'scan_status',row.scan_status,'created_at',row.created_at
      ) order by row.priority_score desc,row.created_at,row.id)
        from filtered row left join public.user_profiles profile on profile.id=row.owner_user_id),'[]'::jsonb),
      'next_cursor',(select pg_catalog.jsonb_build_object(
        'priority_score',row.priority_score,'created_at',row.created_at,'id',row.id)
        from filtered row order by row.priority_score,row.created_at desc,row.id desc limit 1)
    )
  );
end;
$$;

create or replace function private.content_safety_rule_targets(p_scopes text[])
returns table(target_type text,target_id uuid)
language sql stable security definer set search_path=''
as $$
  select eligible.target_type,eligible.target_id from (
    select 'video'::text target_type,v.id target_id from public.videos v where 'video_caption'=any(p_scopes)
    union all select 'comment',c.id from public.comments c where 'comment'=any(p_scopes)
    union all select 'story',s.id from public.stories s where 'story_text'=any(p_scopes)
    union all select 'live_message',m.id from public.live_messages m where 'live_chat'=any(p_scopes)
    union all select 'message',m.id from public.messages m
      where 'reported_message'=any(p_scopes) and exists(
        select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
      )
    union all
    select 'creator_premium',content.id
    from private.creator_premium_contents content
    where content.lifecycle_status<>'deleted'
      and ('creator_premium_text'=any(p_scopes)
        or (content.content_kind='video' and 'transcript'=any(p_scopes)))
  ) eligible
$$;

create or replace function public.fail_content_safety_visual_scan(
  p_scan_id uuid,p_error_code text,p_retryable boolean default true,
  p_provider_called boolean default false
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_scan private.content_safety_scans;v_producer_id uuid;v_calls integer;
  v_retry boolean;v_error text;v_frames_remaining integer;v_next timestamptz;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  if v_scan.visual_analysis_id is not null then
    perform private.content_safety_attach_visual_analysis(v_scan.visual_analysis_id);
    return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'visual_status','analyzed','reused',true,
      'provider_call_count',v_scan.visual_provider_call_count);
  end if;
  v_producer_id:=private.content_safety_visual_producer_scan_id(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
  if v_scan.id is distinct from v_producer_id then
    raise exception using errcode='55000',message='content_safety_visual_not_canonical_producer';
  end if;
  v_calls:=v_scan.visual_provider_call_count+case when coalesce(p_provider_called,false) then 1 else 0 end;
  v_frames_remaining:=case when v_scan.visual_source_kind='eligible_stream_video' then 5-v_scan.visual_frame_cursor else 1 end;
  v_retry:=coalesce(p_retryable,false) and v_scan.visual_attempt_count<5 and v_calls<5
    and (v_scan.visual_source_kind='eligible_image' or v_calls+v_frames_remaining<=5);
  v_error:=left(pg_catalog.lower(pg_catalog.regexp_replace(
    coalesce(nullif(pg_catalog.btrim(p_error_code),''),'visual_processing_error'),'[^a-z0-9_]+','_','g')),100);
  v_next:=case when v_retry then pg_catalog.clock_timestamp()
    +pg_catalog.least(30,pg_catalog.power(2,pg_catalog.greatest(v_scan.visual_attempt_count,1)))::integer*interval '1 minute'
    else v_scan.visual_available_at end;

  update private.content_safety_scans scan set
    visual_status=case when v_retry then 'pending' else 'failed' end,
    visual_provider_call_count=case when scan.id=v_scan.id then v_calls else scan.visual_provider_call_count end,
    visual_available_at=v_next,visual_started_at=null,
    visual_completed_at=case when v_retry then null else pg_catalog.clock_timestamp() end,
    visual_last_error_code=v_error,updated_at=pg_catalog.clock_timestamp()
  where scan.target_type in('video','creator_premium') and (
    (v_scan.visual_media_asset_id is not null and scan.visual_media_asset_id=v_scan.visual_media_asset_id
      and scan.visual_source_kind='eligible_image')
    or (v_scan.visual_video_asset_id is not null and scan.visual_video_asset_id=v_scan.visual_video_asset_id
      and scan.visual_source_kind='eligible_stream_video')
  );
  update private.content_safety_scans story set
    visual_status=case when v_retry then 'pending' else 'failed' end,
    visual_started_at=null,
    visual_completed_at=case when v_retry then null else pg_catalog.clock_timestamp() end,
    visual_last_error_code=v_error,updated_at=pg_catalog.clock_timestamp()
  where story.target_type='story' and exists(
    select 1 from private.content_safety_scans source_scan
    where source_scan.id=story.media_source_scan_id and (
      (v_scan.visual_media_asset_id is not null and source_scan.visual_media_asset_id=v_scan.visual_media_asset_id)
      or (v_scan.visual_video_asset_id is not null and source_scan.visual_video_asset_id=v_scan.visual_video_asset_id)
    )
  );
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,
    'visual_status',case when v_retry then 'pending' else 'failed' end,
    'retryable',v_retry,'provider_call_count',v_calls,'canonical_producer',true);
end;
$$;

create or replace function private.content_safety_report_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.reported_content_type in('video','comment','story','message','creator_premium') then
    perform private.enqueue_content_safety_scan(
      new.reported_content_type,new.reported_content_id,'report_signal'
    );
    begin
      perform public.wake_content_safety_scanner();
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

create function private.finalize_creator_premium_safety_scan_v1(p_scan_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_scan private.content_safety_scans;v_content private.creator_premium_contents;
  v_snapshot jsonb;v_current_fingerprint text;v_blocker text;v_alert_severity text;
  v_transcript private.content_safety_audio_transcripts;v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found or v_scan.target_type<>'creator_premium' then
    return pg_catalog.jsonb_build_object('scan_id',p_scan_id,'outcome','not_creator_premium');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:'||v_scan.target_id::text,0)
  );
  select * into v_content from private.creator_premium_contents
  where id=v_scan.target_id for update;
  if not found then return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'outcome','content_missing');end if;

  -- Published content can only move toward restriction here; a report scan can
  -- never manufacture a new PASS or overwrite its original publication proof.
  if v_content.lifecycle_status='published' then
    v_snapshot:=private.content_safety_target_snapshot('creator_premium',v_content.id);
    if v_snapshot is null then
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','snapshot_unavailable');
    end if;
    v_current_fingerprint:=private.content_safety_sha256(
      'creator_premium|'||v_content.id::text||'|'||coalesce(v_snapshot->>'content_version','')
    );
    if v_current_fingerprint<>v_scan.content_fingerprint then
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','stale_scan');
    end if;
    if exists(select 1 from private.content_safety_alerts alert where alert.scan_id=v_scan.id) then
      update private.creator_premium_contents content set
        lifecycle_status='quarantined',quarantined_at=v_now,
        reviewed_at=null,reviewed_by=null,review_reason='creator_premium_safety_signal',
        removal_reason='creator_premium_safety_signal',verification_scan_id=v_scan.id,
        verification_fingerprint=v_scan.content_fingerprint,verification_status='restricted',
        verification_error_code='creator_premium_safety_signal',verification_requested_at=coalesce(content.verification_requested_at,v_scan.created_at),
        verification_completed_at=v_now,updated_at=v_now
      where content.id=v_content.id and content.lifecycle_status='published';
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','restricted','published',false);
    end if;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','published_unchanged');
  end if;

  if v_content.lifecycle_status<>'pending_review' then
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','state_changed','lifecycle_status',v_content.lifecycle_status);
  end if;
  if v_content.verification_scan_id is distinct from v_scan.id
     or v_content.verification_fingerprint is distinct from v_scan.content_fingerprint then
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','stale_scan');
  end if;
  v_snapshot:=private.content_safety_target_snapshot('creator_premium',v_content.id);
  if v_snapshot is null then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_snapshot_unavailable',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_snapshot_unavailable');
  end if;
  v_current_fingerprint:=private.content_safety_sha256(
    'creator_premium|'||v_content.id::text||'|'||coalesce(v_snapshot->>'content_version','')
  );
  if v_current_fingerprint<>v_scan.content_fingerprint then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_stale_content_version',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_stale_content_version');
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(v_content.creator_id)
     or not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    update private.creator_premium_contents set lifecycle_status='quarantined',
      quarantined_at=v_now,review_reason='creator_premium_creator_restricted',
      removal_reason='creator_premium_creator_restricted',verification_status='restricted',
      verification_error_code='creator_premium_creator_restricted',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','restricted','error','creator_premium_creator_restricted');
  end if;

  if v_scan.status='failed' or v_scan.text_status in('failed','not_configured')
     or v_scan.visual_status in('failed','not_configured')
     or (v_content.content_kind='video' and v_scan.audio_status in('failed','not_configured')) then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_safety_provider_failed',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_safety_provider_failed');
  end if;
  if v_scan.status<>'completed' or v_scan.text_status<>'analyzed'
     or v_scan.reports_status<>'analyzed' or v_scan.visual_status<>'analyzed'
     or (v_content.content_kind='image' and v_scan.audio_status<>'not_applicable')
     or (v_content.content_kind='video' and v_scan.audio_status<>'analyzed') then
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','pending');
  end if;
  if not exists(
    select 1 from private.content_safety_rules rule
    where rule.enabled and rule.approval_state='approved' and 'creator_premium_text'=any(rule.scopes)
  ) then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='content_safety_policy_not_configured',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','content_safety_policy_not_configured');
  end if;
  if v_content.content_kind='video' then
    select transcript.* into v_transcript from private.content_safety_audio_transcripts transcript
    where transcript.source_scan_id=v_scan.id
      and transcript.source_content_fingerprint=v_scan.content_fingerprint
      and transcript.rule_eval_status='completed'
    order by transcript.created_at desc,transcript.id desc limit 1;
    if not found or not exists(
      select 1 from private.content_safety_rules rule
      where rule.enabled and rule.approval_state='approved' and 'transcript'=any(rule.scopes)
    ) then
      update private.creator_premium_contents set verification_status='failed',
        verification_error_code='content_safety_audio_policy_not_configured',verification_completed_at=v_now,
        updated_at=v_now where id=v_content.id;
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','content_safety_audio_policy_not_configured');
    end if;
  end if;
  if not exists(
    select 1 from private.content_safety_visual_analyses analysis
    where analysis.id=v_scan.visual_analysis_id
      and ((v_content.content_kind='image' and analysis.media_asset_id=v_scan.visual_media_asset_id)
        or (v_content.content_kind='video' and analysis.video_asset_id=v_scan.visual_video_asset_id))
  ) then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_visual_proof_invalid',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_visual_proof_invalid');
  end if;

  select alert.severity into v_alert_severity
  from private.content_safety_alerts alert where alert.scan_id=v_scan.id
  order by case alert.severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc limit 1;
  if found then
    -- Canonical alerts are detection evidence, not confirmed violations. Every
    -- signal therefore fails closed into exception moderation; no model/rule
    -- match is silently promoted into a human-confirmed enforcement finding.
    update private.creator_premium_contents set lifecycle_status='quarantined',published_at=null,
      quarantined_at=v_now,removed_at=null,reviewed_at=null,reviewed_by=null,
      review_reason=case when v_alert_severity in('high','critical')
        then 'creator_premium_safety_high_risk' else 'creator_premium_safety_signal' end,
      removal_reason=case when v_alert_severity in('high','critical')
        then 'creator_premium_safety_high_risk' else 'creator_premium_safety_signal' end,
      verification_status='restricted',verification_error_code=case when v_alert_severity in('high','critical')
        then 'creator_premium_safety_high_risk' else 'creator_premium_safety_signal' end,
      verification_completed_at=v_now,updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','restricted','published',false);
  end if;

  v_blocker:=private.creator_premium_publication_blocker_v1(v_content.id);
  if v_blocker is not null then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code=v_blocker,verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error',v_blocker);
  end if;
  update private.creator_premium_contents content set lifecycle_status='published',
    published_at=v_now,quarantined_at=null,removed_at=null,reviewed_at=null,reviewed_by=null,
    review_reason=null,removal_reason=null,verification_status='passed',
    verification_error_code=null,verification_completed_at=v_now,updated_at=v_now
  where content.id=v_content.id and content.lifecycle_status='pending_review'
    and content.verification_scan_id=v_scan.id
    and content.verification_fingerprint=v_scan.content_fingerprint;
  if not found then return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','state_changed');end if;
  return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','published','published',true);
end;
$$;

create function public.reconcile_creator_premium_publications_v1(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan_id uuid;v_result jsonb;v_results jsonb:='[]'::jsonb;v_count integer:=0;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',message='creator_premium_service_role_required';end if;
  if p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='creator_premium_reconcile_limit_invalid';end if;
  for v_scan_id in
    select scan.id
    from private.content_safety_scans scan
    join private.creator_premium_contents content on content.id=scan.target_id
    where scan.target_type='creator_premium' and (
      (content.lifecycle_status='pending_review'
        and content.verification_status='pending'
        and content.verification_scan_id=scan.id)
      or (content.lifecycle_status='published' and exists(
        select 1 from private.content_safety_alerts alert where alert.scan_id=scan.id))
    )
    order by scan.updated_at,scan.id limit p_limit
    for update of scan skip locked
  loop
    v_result:=private.finalize_creator_premium_safety_scan_v1(v_scan_id);
    v_results:=v_results||pg_catalog.jsonb_build_array(v_result);v_count:=v_count+1;
  end loop;
  return pg_catalog.jsonb_build_object('processed',v_count,'results',v_results);
end;
$$;

revoke all on function private.creator_premium_publication_blocker_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_internal_finance_authority_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_financial_fact_is_valid_v1(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,uuid,uuid,
  numeric,numeric,numeric,integer
) from public, anon, authenticated, service_role;
revoke all on function private.finalize_creator_premium_safety_scan_v1(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.reconcile_creator_premium_publications_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_creator_premium_publications_v1(integer)
  to service_role;

revoke all on function public.submit_my_creator_premium_content_for_review_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_my_creator_premium_content_for_review_v1(uuid)
  to authenticated;

revoke all on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  to authenticated;

revoke all on function public.get_my_creator_premium_content_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_content_v1(uuid)
  to authenticated;

revoke all on function public.reopen_my_creator_premium_rejected_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reopen_my_creator_premium_rejected_v1(uuid)
  to authenticated;

revoke all on function public.search_admin_creator_premium_content_v1(text,text,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_admin_creator_premium_content_v1(text,text,timestamptz,uuid,integer)
  to authenticated;

revoke all on function public.get_admin_creator_premium_content_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_creator_premium_content_v1(uuid)
  to authenticated;

revoke all on function public.admin_review_creator_premium_content_v1(uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_review_creator_premium_content_v1(uuid,text,text,uuid)
  to authenticated;

revoke all on function public.report_creator_premium_content_v1(uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.report_creator_premium_content_v1(uuid,text,text)
  to authenticated;

revoke all on function public.search_admin_reports(text,text,text,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_admin_reports(text,text,text,timestamptz,uuid,integer)
  to authenticated;

revoke all on function public.get_admin_report_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_report_detail(uuid)
  to authenticated;

revoke all on function public.get_creator_premium_commerce_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_creator_premium_commerce_v1(uuid)
  to authenticated;

revoke all on function public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer)
  to authenticated;

revoke all on function public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz)
  to authenticated;

revoke all on function public.get_admin_creator_premium_refund_candidates_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_creator_premium_refund_candidates_v1(uuid)
  to authenticated;

revoke all on function public.admin_refund_creator_premium_purchase_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_refund_creator_premium_purchase_v1(uuid,uuid,text)
  to authenticated;

revoke all on function public.admin_refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  to authenticated;

-- Preserve B4's external ACL even though the internal authority now also
-- recognizes a capability-gated nested admin call from the wrappers above.
revoke all on function public.refund_creator_premium_purchase_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_creator_premium_purchase_v1(uuid,uuid,text)
  to service_role;
revoke all on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_creator_premium_subscription_period_v1(uuid,uuid,text)
  to service_role;

comment on function public.get_creator_premium_commerce_v1(uuid) is
  'B7 safe consumer commerce projection. Prices are exact server strings; no private locator or financial account is returned.';
comment on function public.admin_review_creator_premium_content_v1(uuid,text,text,uuid) is
  'B7-F2 canonical, idempotent, capability-gated exception moderation. It can quarantine/remove or request an automatically verified restore, but cannot manufacture a publication PASS.';
comment on function public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz) is
  'B7 verified creator commercial summary derived from canonical snapshots, financial transactions, and exact charge/refund ledger legs. It does not allocate subscription revenue to content or invent view metrics.';

commit;

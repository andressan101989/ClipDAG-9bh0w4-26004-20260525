begin;

-- CREATOR-PREMIUM-B7
-- Complete the already-canonical Premium domain with human moderation,
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
  add column review_reason text;

alter table private.creator_premium_contents
  add constraint creator_premium_contents_reviewed_by_fkey
    foreign key (reviewed_by) references auth.users(id)
    on update restrict on delete restrict,
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
      and reviewed_by is null and review_reason is null)
    or (lifecycle_status = 'pending_review'
      and published_at is null and quarantined_at is null and removed_at is null
      and deleted_at is null and submitted_at is not null and reviewed_at is null
      and reviewed_by is null and review_reason is null)
    or (lifecycle_status = 'published'
      and published_at is not null and quarantined_at is null and removed_at is null
      and deleted_at is null and submitted_at is not null and reviewed_at is not null
      and reviewed_by is not null)
    or (lifecycle_status = 'rejected'
      and published_at is null and quarantined_at is null and removed_at is null
      and deleted_at is null and submitted_at is not null and reviewed_at is not null
      and reviewed_by is not null and review_reason is not null)
    or (lifecycle_status = 'quarantined'
      and quarantined_at is not null and removed_at is null and deleted_at is null
      and submitted_at is not null and reviewed_at is not null
      and reviewed_by is not null and review_reason is not null)
    or (lifecycle_status = 'removed'
      and removed_at is not null and deleted_at is null and submitted_at is not null
      and reviewed_at is not null and reviewed_by is not null
      and review_reason is not null)
    or (lifecycle_status = 'deleted' and deleted_at is not null)
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
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  v_blocker := private.creator_premium_submission_blocker_v1(v_content.id);
  if v_blocker is not null then
    raise exception using errcode = '55000', message = v_blocker;
  end if;

  update private.creator_premium_contents content
  set lifecycle_status = 'pending_review',
      submitted_at = pg_catalog.clock_timestamp(),
      reviewed_at = null,
      reviewed_by = null,
      review_reason = null,
      removal_reason = null,
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

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
    content.lifecycle_status = 'draft' and blocker.value is null,
    case when content.lifecycle_status = 'draft'
      then blocker.value else 'creator_premium_draft_only' end
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
  v_blocker text;
  v_now timestamptz;
  v_receipt jsonb;
begin
  v_actor := public.admin_require_capability('creator_premium.review.moderate');
  if p_content_id is null or p_idempotency_key is null
     or v_action not in ('approve','reject','quarantine','remove','restore')
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
    return v_prior.metadata -> 'receipt';
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
    when 'approve' then
      if v_content.lifecycle_status <> 'pending_review' then
        raise exception using errcode = '55000', message = 'creator_premium_admin_approve_invalid_state';
      end if;
      v_blocker := private.creator_premium_publication_blocker_v1(v_content.id);
      if v_blocker is not null then
        raise exception using errcode = '55000', message = v_blocker;
      end if;
      update private.creator_premium_contents content
      set lifecycle_status = 'published', published_at = v_now,
          quarantined_at = null, removed_at = null, reviewed_at = v_now,
          reviewed_by = v_actor, review_reason = v_reason,
          removal_reason = null, updated_at = v_now
      where content.id = v_content.id
      returning content.* into v_content;
    when 'reject' then
      if v_content.lifecycle_status <> 'pending_review' then
        raise exception using errcode = '55000', message = 'creator_premium_admin_reject_invalid_state';
      end if;
      update private.creator_premium_contents content
      set lifecycle_status = 'rejected', published_at = null,
          quarantined_at = null, removed_at = null, reviewed_at = v_now,
          reviewed_by = v_actor, review_reason = v_reason,
          removal_reason = null, updated_at = v_now
      where content.id = v_content.id
      returning content.* into v_content;
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
      set lifecycle_status = 'pending_review', submitted_at = v_now,
          published_at = null, quarantined_at = null, removed_at = null,
          reviewed_at = null, reviewed_by = null, review_reason = null,
          removal_reason = null, updated_at = v_now
      where content.id = v_content.id
      returning content.* into v_content;
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
    return v_prior.metadata->'receipt';
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
    'succeeded',true,true,pg_catalog.jsonb_build_object('receipt',v_result),
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
    return v_prior.metadata->'receipt';
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
    'succeeded',true,true,pg_catalog.jsonb_build_object('receipt',v_result),
    v_scope,p_idempotency_key,v_fingerprint);
  return v_result;
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

revoke all on function public.submit_my_creator_premium_content_for_review_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_my_creator_premium_content_for_review_v1(uuid)
  to authenticated;

revoke all on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
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
  'B7 canonical, idempotent, capability-gated human moderation authority for Creator Premium.';
comment on function public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz) is
  'B7 verified creator commercial summary derived from canonical snapshots, financial transactions, and exact charge/refund ledger legs. It does not allocate subscription revenue to content or invent view metrics.';

commit;

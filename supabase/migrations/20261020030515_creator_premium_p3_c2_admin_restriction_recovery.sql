begin;

-- The mutation authority already enforces the correct fail-closed transition:
-- every alert on the current scan must be dismissed as no_violation before a
-- restricted item can request a new P3 evaluation. Surface that same
-- server-derived precondition in the existing bounded detail projection so the
-- Admin Web never presents a knowingly impossible command.
create or replace function public.get_admin_creator_premium_content_v1(p_content_id uuid)
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
    'reverification', pg_catalog.jsonb_build_object(
      'lifecycle_eligible', content.lifecycle_status in ('rejected','quarantined','removed'),
      'ready', content.lifecycle_status in ('rejected','quarantined','removed')
        and recovery.blocking_alert_count = 0,
      'reason_code', case
        when content.lifecycle_status not in ('rejected','quarantined','removed')
          then 'creator_premium_admin_restore_invalid_state'
        when recovery.blocking_alert_count > 0
          then 'creator_premium_safety_alert_resolution_required'
        else null
      end,
      'current_scan_alert_count', recovery.current_scan_alert_count,
      'favorable_alert_count', recovery.favorable_alert_count,
      'blocking_alert_count', recovery.blocking_alert_count,
      'actionable_alert_count', recovery.actionable_alert_count,
      'terminal_unfavorable_alert_count', recovery.terminal_unfavorable_alert_count
    ),
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
  cross join lateral (
    select
      pg_catalog.count(*)::integer as current_scan_alert_count,
      pg_catalog.count(*) filter (
        where alert.status = 'dismissed' and alert.resolution = 'no_violation'
      )::integer as favorable_alert_count,
      pg_catalog.count(*) filter (
        where not (
          alert.status = 'dismissed' and alert.resolution = 'no_violation'
        )
      )::integer as blocking_alert_count,
      pg_catalog.count(*) filter (
        where alert.status in ('open','in_review')
      )::integer as actionable_alert_count,
      pg_catalog.count(*) filter (
        where alert.status not in ('open','in_review')
          and not (
            alert.status = 'dismissed' and alert.resolution = 'no_violation'
          )
      )::integer as terminal_unfavorable_alert_count
    from private.content_safety_alerts alert
    where alert.target_type = 'creator_premium'
      and alert.target_id = content.id
      and alert.scan_id = content.verification_scan_id
  ) recovery
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

-- Closed alert decisions are historical moderation evidence. The legacy
-- authority allowed a second command with a different idempotency key to
-- rewrite a resolved violation as no_violation (or the reverse). Keep exact
-- replay available through admin_action_audit, but make the first terminal
-- decision win under the existing row lock.
create or replace function public.admin_review_content_safety_alert(
  p_alert_id uuid,
  p_action text,
  p_resolution text,
  p_note text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_scope text;
  v_fingerprint text;
  v_existing private.admin_action_audit;
  v_alert private.content_safety_alerts;
  v_audit_action text;
  v_status text;
  v_resolution text;
  v_note text;
begin
  v_actor := public.admin_require_capability('content.items.moderate');
  if p_action not in ('take_review','dismiss','resolve') then
    raise exception using errcode = '22023', message = 'invalid_content_safety_alert_action';
  end if;
  v_note := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  if p_action in ('dismiss','resolve')
     and (v_note is null or pg_catalog.char_length(v_note) < 2) then
    raise exception using errcode = '22023', message = 'content_safety_resolution_note_required';
  end if;
  v_resolution := case
    when p_action = 'dismiss' then 'no_violation'
    when p_action = 'resolve'
      and p_resolution in ('reviewed','content_action_taken','user_action_taken') then p_resolution
    else null
  end;
  if p_action = 'resolve' and v_resolution is null then
    raise exception using errcode = '22023', message = 'invalid_content_safety_resolution';
  end if;

  v_scope := 'v1|human|' || v_actor::text
    || '|content.items.moderate|content_safety.alert.' || p_action;
  v_fingerprint := private.content_safety_sha256(pg_catalog.jsonb_build_object(
    'alert_id', p_alert_id,
    'action', p_action,
    'resolution', v_resolution,
    'note', v_note
  )::text);

  -- Serialize an exact command before reading its audit receipt so two
  -- concurrent replays cannot both miss the first committed result.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_scope || ':' || p_idempotency_key::text,
    0
  ));

  select * into v_existing
  from private.admin_action_audit
  where idempotency_scope = v_scope and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'admin_idempotency_conflict';
    end if;
    return v_existing.metadata || pg_catalog.jsonb_build_object('idempotent', true);
  end if;

  select * into v_alert
  from private.content_safety_alerts
  where id = p_alert_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'content_safety_alert_not_found';
  end if;

  if p_action in ('dismiss','resolve')
     and v_alert.status not in ('open','in_review') then
    raise exception using errcode = '55000', message = 'content_safety_alert_already_closed';
  end if;

  if p_action = 'take_review' then
    if v_alert.status not in ('open','in_review') then
      raise exception using errcode = '55000', message = 'content_safety_alert_already_closed';
    end if;
    update private.content_safety_alerts
    set status = 'in_review', assigned_to = v_actor, updated_at = clock_timestamp()
    where id = p_alert_id
    returning * into v_alert;
    v_audit_action := 'content_safety.alert.review';
    v_status := 'in_review';
  elsif p_action = 'dismiss' then
    update private.content_safety_alerts
    set status = 'dismissed', assigned_to = coalesce(assigned_to, v_actor),
      reviewed_by = v_actor, reviewed_at = clock_timestamp(),
      resolution = 'no_violation', resolution_note = v_note,
      updated_at = clock_timestamp()
    where id = p_alert_id
    returning * into v_alert;
    v_audit_action := 'content_safety.alert.dismiss';
    v_status := 'dismissed';
  else
    update private.content_safety_alerts
    set status = 'resolved', assigned_to = coalesce(assigned_to, v_actor),
      reviewed_by = v_actor, reviewed_at = clock_timestamp(),
      resolution = v_resolution, resolution_note = v_note,
      updated_at = clock_timestamp()
    where id = p_alert_id
    returning * into v_alert;
    v_audit_action := 'content_safety.alert.resolve';
    v_status := 'resolved';
  end if;

  insert into private.admin_action_audit(
    actor_id, actor_kind, actor_role_snapshot, actor_capability,
    domain, action, target_type, target_id, target_ref, outcome, reason,
    financial_effect, contains_pii, idempotency_scope, idempotency_key,
    request_fingerprint, metadata
  ) values (
    v_actor, 'human_admin', private.admin_active_role_codes(v_actor),
    'content.items.moderate', 'content_safety', v_audit_action,
    'content_safety_alert', v_alert.id,
    v_alert.target_type || ':' || v_alert.target_id::text,
    'succeeded', v_note, false, true, v_scope, p_idempotency_key,
    v_fingerprint, pg_catalog.jsonb_build_object(
      'alert_id', v_alert.id,
      'status', v_status,
      'resolution', v_alert.resolution
    )
  );
  return pg_catalog.jsonb_build_object(
    'alert_id', v_alert.id,
    'status', v_status,
    'resolution', v_alert.resolution,
    'idempotent', false
  );
end;
$$;

revoke all on function public.get_admin_creator_premium_content_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_creator_premium_content_v1(uuid)
  to authenticated;

revoke all on function public.admin_review_content_safety_alert(uuid,text,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_review_content_safety_alert(uuid,text,text,text,uuid)
  to authenticated;

comment on function public.get_admin_creator_premium_content_v1(uuid) is
  'Capability-gated bounded Creator Premium review detail; P3-C2 projects current-scan human-review readiness without mutating content, alerts, or policy.';

comment on function public.admin_review_content_safety_alert(uuid,text,text,text,uuid) is
  'Capability-gated Content Safety alert review; P3-C2 makes terminal human decisions immutable while preserving exact idempotent replay.';

commit;

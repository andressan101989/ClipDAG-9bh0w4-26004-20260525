begin;

-- The RPC is deliberately owned by postgres. Some disposable baselines retain
-- the canonical operational predicate under the migration role, so grant the
-- RPC owner the narrow internal execute capability it needs as well.
grant execute on function private.creator_premium_actor_is_operational_v1(uuid)
  to postgres;
grant select on table private.creator_premium_contents to postgres;
grant update (
  lifecycle_status,
  submitted_at,
  reviewed_at,
  reviewed_by,
  review_reason,
  removal_reason,
  verification_generation,
  verification_scan_id,
  verification_fingerprint,
  verification_status,
  verification_error_code,
  verification_requested_at,
  verification_completed_at,
  updated_at
) on table private.creator_premium_contents to postgres;

create function public.cancel_my_creator_premium_submission_v1(p_content_id uuid)
returns table (
  content_id uuid,
  lifecycle_status text,
  verification_generation bigint,
  cancelled boolean,
  updated_at timestamptz
)
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
  if v_content.lifecycle_status = 'draft' then
    cancelled := false;
    return query select v_content.id, v_content.lifecycle_status,
      v_content.verification_generation, cancelled, v_content.updated_at;
    return;
  end if;
  if v_content.lifecycle_status <> 'pending_review' then
    raise exception using errcode = '55000', message = 'creator_premium_submission_cancel_invalid_state';
  end if;

  update private.creator_premium_contents content
  set lifecycle_status = 'draft',
      submitted_at = null,
      reviewed_at = null,
      reviewed_by = null,
      review_reason = null,
      removal_reason = null,
      verification_generation = content.verification_generation + 1,
      verification_scan_id = null,
      verification_fingerprint = null,
      verification_status = 'not_requested',
      verification_error_code = null,
      verification_requested_at = null,
      verification_completed_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

  cancelled := true;
  return query select v_content.id, v_content.lifecycle_status,
    v_content.verification_generation, cancelled, v_content.updated_at;
end;
$$;

comment on function public.cancel_my_creator_premium_submission_v1(uuid) is
  'Owner-only pending-review cancellation. Preserves media, offers, plans, scan history and financial records while advancing the verification generation to fence stale workers.';

revoke all on function public.cancel_my_creator_premium_submission_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_my_creator_premium_submission_v1(uuid)
  to authenticated;
alter function public.cancel_my_creator_premium_submission_v1(uuid) owner to postgres;

commit;

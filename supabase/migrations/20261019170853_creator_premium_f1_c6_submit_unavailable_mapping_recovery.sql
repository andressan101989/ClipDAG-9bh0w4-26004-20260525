begin;

-- Forward-only C6 repair of the canonical submission authority. The RPC keeps
-- its signature, ownership, ACL, lock ordering, idempotency, and safety gate.
create or replace function public.submit_my_creator_premium_content_with_plans_v1(
  p_content_id uuid,
  p_plan_ids uuid[],
  p_client_request_id uuid
)
returns table (
  content_id uuid,
  lifecycle_status text,
  submission_ready boolean,
  active_plan_ids uuid[],
  versioned_plan_ids uuid[],
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_command public.idempotency_keys;
  v_selected_plan_ids uuid[];
  v_affected_plan_ids uuid[] := '{}'::uuid[];
  v_affected_plan_keys text[] := '{}'::text[];
  v_selected_plan_keys text[] := '{}'::text[];
  v_actual_plan_keys text[] := '{}'::text[];
  v_actual_active_plan_ids uuid[] := '{}'::uuid[];
  v_versioned_plan_ids uuid[] := '{}'::uuid[];
  v_activate_plan_ids uuid[] := '{}'::uuid[];
  v_retire_plan_ids uuid[] := '{}'::uuid[];
  v_next_content_ids uuid[];
  v_plan record;
  v_clone record;
  v_submission record;
  v_plan_id uuid;
  v_plan_key text;
  v_clone_request_id uuid;
  v_selected boolean;
  v_mapped boolean;
  v_count bigint;
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
  if p_content_id is null or p_client_request_id is null
     or coalesce(pg_catalog.cardinality(p_plan_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'creator_premium_plan_selection_invalid';
  end if;

  select coalesce(pg_catalog.array_agg(distinct item order by item), '{}'::uuid[])
  into v_selected_plan_ids
  from pg_catalog.unnest(coalesce(p_plan_ids, '{}'::uuid[])) item;
  if exists (
    select 1 from pg_catalog.unnest(v_selected_plan_ids) item where item is null
  ) then
    raise exception using errcode = '22023', message = 'creator_premium_plan_selection_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_object(
      'operation', 'creator_premium_submission_with_plans',
      'actor_id', v_actor,
      'content_id', p_content_id,
      'plan_ids', v_selected_plan_ids
    )::text,
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-submission-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );

  select command.* into v_command
  from public.idempotency_keys command
  where command.idempotency_key = p_client_request_id::text
    and command.operation_type = 'creator_premium_submission_with_plans'
    and command.user_id = v_actor
  for update;

  if found then
    if v_command.request_hash is distinct from v_fingerprint
       or v_command.status <> 'completed'
       or v_command.response_body is null then
      raise exception using errcode = '23505', message = 'creator_premium_submission_idempotency_conflict';
    end if;
    return query select
      (v_command.response_body ->> 'content_id')::uuid,
      v_command.response_body ->> 'lifecycle_status',
      (v_command.response_body ->> 'submission_ready')::boolean,
      array(
        select value::uuid
        from pg_catalog.jsonb_array_elements_text(
          v_command.response_body -> 'active_plan_ids'
        ) item(value)
      ),
      array(
        select value::uuid
        from pg_catalog.jsonb_array_elements_text(
          v_command.response_body -> 'versioned_plan_ids'
        ) item(value)
      ),
      true;
    return;
  end if;

  -- Canonical plan commands take the plan-family lock, then the concrete plan,
  -- and only then content rows. Match that order so submit cannot deadlock with
  -- clone/activate/retire/set-contents during a concurrent plan change.
  select coalesce(pg_catalog.array_agg(affected.plan_key order by affected.plan_key), '{}'::text[])
  into v_affected_plan_keys
  from (
    select distinct plan.plan_key
    from private.creator_premium_plans plan
    where plan.creator_id = v_actor
      and (
        plan.id = any(v_selected_plan_ids)
        or (
          plan.status = 'active'
          and exists (
            select 1
            from private.creator_premium_plan_contents mapping
            where mapping.plan_id = plan.id
              and mapping.creator_id = v_actor
              and mapping.content_id = p_content_id
          )
        )
      )
  ) affected;
  foreach v_plan_key in array v_affected_plan_keys loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'creator-premium-plan-version:' || v_actor::text || ':' || v_plan_key,
        0
      )
    );
  end loop;

  select coalesce(pg_catalog.array_agg(plan.id order by plan.id), '{}'::uuid[])
  into v_affected_plan_ids
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and (
      plan.id = any(v_selected_plan_ids)
      or (
        plan.status = 'active'
        and exists (
          select 1
          from private.creator_premium_plan_contents mapping
          where mapping.plan_id = plan.id
            and mapping.creator_id = v_actor
            and mapping.content_id = p_content_id
        )
      )
    );
  foreach v_plan_id in array v_affected_plan_ids loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('creator-premium-plan:' || v_plan_id::text, 0)
    );
  end loop;

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
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_content.access_mode in ('subscription','purchase_or_subscription')
     and pg_catalog.cardinality(v_selected_plan_ids) = 0 then
    raise exception using errcode = '55000', message = 'creator_premium_active_plan_required';
  end if;
  if v_content.access_mode = 'purchase'
     and pg_catalog.cardinality(v_selected_plan_ids) <> 0 then
    raise exception using errcode = '22023', message = 'creator_premium_plan_selection_not_allowed';
  end if;

  select count(*) into v_count
  from private.creator_premium_plans plan
  where plan.id = any(v_selected_plan_ids)
    and plan.creator_id = v_actor
    and plan.status = 'active';
  if v_count <> pg_catalog.cardinality(v_selected_plan_ids) then
    raise exception using errcode = '55000', message = 'creator_premium_active_plan_required';
  end if;
  select coalesce(pg_catalog.array_agg(distinct plan.plan_key order by plan.plan_key), '{}'::text[])
  into v_selected_plan_keys
  from private.creator_premium_plans plan
  where plan.id = any(v_selected_plan_ids)
    and plan.creator_id = v_actor
    and plan.status = 'active';

  perform plan.id
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.status = 'active'
    and (
      plan.id = any(v_selected_plan_ids)
      or exists (
        select 1
        from private.creator_premium_plan_contents mapping
        where mapping.plan_id = plan.id
          and mapping.creator_id = v_actor
          and mapping.content_id = p_content_id
      )
    )
  order by plan.id
  for update;

  for v_plan in
    select
      plan.id,
      coalesce(
        pg_catalog.array_agg(mapping.content_id order by mapping.content_id)
          filter (where mapping.content_id is not null),
        '{}'::uuid[]
      ) as mapped_content_ids
    from private.creator_premium_plans plan
    left join private.creator_premium_plan_contents mapping
      on mapping.plan_id = plan.id
     and mapping.creator_id = plan.creator_id
    where plan.creator_id = v_actor
      and plan.status = 'active'
      and (
        plan.id = any(v_selected_plan_ids)
        or exists (
          select 1
          from private.creator_premium_plan_contents target_mapping
          where target_mapping.plan_id = plan.id
            and target_mapping.creator_id = v_actor
            and target_mapping.content_id = p_content_id
        )
      )
    group by plan.id
    order by plan.id
  loop
    v_selected := v_plan.id = any(v_selected_plan_ids);
    v_mapped := p_content_id = any(v_plan.mapped_content_ids);
    if v_selected = v_mapped then
      continue;
    end if;

    if v_selected then
      select pg_catalog.array_agg(distinct item order by item)
      into v_next_content_ids
      from pg_catalog.unnest(pg_catalog.array_append(v_plan.mapped_content_ids, p_content_id)) item;
    else
      select coalesce(pg_catalog.array_agg(item order by item), '{}'::uuid[])
      into v_next_content_ids
      from pg_catalog.unnest(v_plan.mapped_content_ids) item
      where item <> p_content_id;
    end if;

    -- C6: published plan versions intentionally retain historical mappings,
    -- including creator-deleted tombstones. A new version must inherit only
    -- content that remains eligible for plan membership; the retired source
    -- version keeps every historical mapping for audit and acquired rights.
    select coalesce(
      pg_catalog.array_agg(candidate.content_id order by candidate.content_id),
      '{}'::uuid[]
    )
    into v_next_content_ids
    from (
      select distinct item as content_id
      from pg_catalog.unnest(v_next_content_ids) item
      join private.creator_premium_contents content
        on content.id = item
       and content.creator_id = v_actor
      where content.lifecycle_status not in ('quarantined','removed','deleted')
    ) candidate;

    if pg_catalog.cardinality(v_next_content_ids) = 0 then
      v_retire_plan_ids := pg_catalog.array_append(v_retire_plan_ids, v_plan.id);
      continue;
    end if;

    v_clone_request_id := pg_catalog.md5(
      p_client_request_id::text || ':' || v_plan.id::text
        || case when v_selected then ':add' else ':remove' end
    )::uuid;
    select clone.* into v_clone
    from public.clone_my_creator_premium_plan_version_v1(
      v_plan.id,
      v_clone_request_id
    ) clone;
    perform 1
    from public.set_my_creator_premium_plan_contents_v1(
      v_clone.id,
      v_next_content_ids
    );
    v_activate_plan_ids := pg_catalog.array_append(v_activate_plan_ids, v_clone.id);
    v_versioned_plan_ids := pg_catalog.array_append(v_versioned_plan_ids, v_clone.id);
  end loop;

  select submission.* into v_submission
  from public.submit_my_creator_premium_content_for_review_v1(p_content_id) submission;

  foreach v_plan_id in array v_activate_plan_ids loop
    perform 1 from public.activate_my_creator_premium_plan_v1(v_plan_id);
  end loop;
  foreach v_plan_id in array v_retire_plan_ids loop
    perform 1 from public.retire_my_creator_premium_plan_v1(v_plan_id);
  end loop;

  select coalesce(pg_catalog.array_agg(plan.id order by plan.id), '{}'::uuid[])
  into v_actual_active_plan_ids
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_plans plan
    on plan.id = mapping.plan_id
   and plan.creator_id = mapping.creator_id
  where mapping.content_id = p_content_id
    and mapping.creator_id = v_actor
    and plan.status = 'active';

  select coalesce(pg_catalog.array_agg(distinct plan.plan_key order by plan.plan_key), '{}'::text[])
  into v_actual_plan_keys
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_plans plan
    on plan.id = mapping.plan_id
   and plan.creator_id = mapping.creator_id
  where mapping.content_id = p_content_id
    and mapping.creator_id = v_actor
    and plan.status = 'active';
  if v_actual_plan_keys is distinct from v_selected_plan_keys then
    raise exception using errcode = '40001', message = 'creator_premium_plan_selection_stale';
  end if;

  if v_content.access_mode in ('subscription','purchase_or_subscription')
     and pg_catalog.cardinality(v_actual_active_plan_ids) = 0 then
    raise exception using errcode = '55000', message = 'creator_premium_active_plan_required';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'content_id', v_submission.content_id,
    'lifecycle_status', v_submission.lifecycle_status,
    'submission_ready', v_submission.submission_ready,
    'active_plan_ids', v_actual_active_plan_ids,
    'versioned_plan_ids', v_versioned_plan_ids
  );
  insert into public.idempotency_keys(
    idempotency_key, operation_type, user_id, request_hash, status, response_body
  ) values (
    p_client_request_id::text,
    'creator_premium_submission_with_plans',
    v_actor,
    v_fingerprint,
    'completed',
    v_response
  );

  return query select
    v_submission.content_id,
    v_submission.lifecycle_status,
    v_submission.submission_ready,
    v_actual_active_plan_ids,
    v_versioned_plan_ids,
    false;
end;
$$;


revoke all on function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)
  to authenticated;
alter function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)
  owner to postgres;
comment on function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid) is
  'Canonical atomic Premium submission with active plan versioning; unavailable historical memberships remain only on retired source versions.';

notify pgrst, 'reload schema';

commit;

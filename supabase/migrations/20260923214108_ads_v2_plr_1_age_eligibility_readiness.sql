-- PLR-1 makes the existing canonical age authority complete for legacy users.
-- It never persists DOB and never grants eligibility without classifier evidence.
begin;

do $$
begin
  if (select count(*) from private.age_eligibility_policy) <> 1 then
    raise exception 'age_policy_singleton_invalid';
  end if;
  if not exists (
    select 1
    from private.age_eligibility_policy
    where singleton
      and minimum_age = 13
      and creator_exclusive_minimum_age = 18
      and policy_version = 'nelyon-age-v2'
  ) then
    raise exception 'age_policy_version_invalid';
  end if;
  if to_regprocedure('private.age_classify_dob(text,date)') is null
     or to_regprocedure('private.ads_actor_is_advertiser_age_eligible(uuid)') is null then
    raise exception 'canonical_age_helpers_missing';
  end if;
end;
$$;

create or replace function public.get_my_age_eligibility()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_policy private.age_eligibility_policy%rowtype;
  v_eligibility private.user_age_eligibility%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select * into strict v_policy
  from private.age_eligibility_policy
  where singleton;

  select * into v_eligibility
  from private.user_age_eligibility
  where user_id = v_actor;

  return pg_catalog.jsonb_build_object(
    'status', coalesce(v_eligibility.status, 'unknown_legacy'),
    'age_band', coalesce(v_eligibility.age_band, 'unknown_legacy'),
    'evaluated', coalesce(v_eligibility.evaluated_at is not null, false),
    'advertiser_18_plus_eligible', private.ads_actor_is_advertiser_age_eligible(v_actor),
    'policy_version', v_policy.policy_version,
    'minimum_age', v_policy.minimum_age
  );
end;
$$;

create or replace function public.remediate_my_age_eligibility(
  p_date_of_birth text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_policy private.age_eligibility_policy%rowtype;
  v_existing private.user_age_eligibility%rowtype;
  v_band text;
  v_status text;
  v_evaluated_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  -- The canonical classifier owns strict format, calendar and future-date checks.
  v_band := private.age_classify_dob(p_date_of_birth);
  if v_band = 'unknown_legacy' then
    raise exception using errcode = '22023', message = 'age_eligibility_invalid_date_of_birth';
  end if;

  v_status := case v_band
    when 'age_18_plus' then 'eligible'
    when 'age_13_17' then 'eligible'
    when 'under_13' then 'ineligible'
    else null
  end;
  if v_status is null then
    raise exception using errcode = '22023', message = 'age_eligibility_invalid_date_of_birth';
  end if;

  select * into strict v_policy
  from private.age_eligibility_policy
  where singleton;

  -- Covers an unexpected missing row without making absence an eligibility grant.
  insert into private.user_age_eligibility (
    user_id, status, age_band, minimum_age, policy_version,
    evaluated_at, source
  ) values (
    v_actor, 'unknown_legacy', 'unknown_legacy', v_policy.minimum_age,
    v_policy.policy_version, null, 'legacy_unknown'
  ) on conflict (user_id) do nothing;

  select * into strict v_existing
  from private.user_age_eligibility
  where user_id = v_actor
  for update;

  if v_existing.status <> 'unknown_legacy' then
    return pg_catalog.jsonb_build_object(
      'status', v_existing.status,
      'age_band', v_existing.age_band,
      'evaluated', v_existing.evaluated_at is not null,
      'advertiser_18_plus_eligible', private.ads_actor_is_advertiser_age_eligible(v_actor),
      'policy_version', v_existing.policy_version,
      'minimum_age', v_existing.minimum_age,
      'already_evaluated', true
    );
  end if;

  v_evaluated_at := pg_catalog.clock_timestamp();
  update private.user_age_eligibility
  set status = v_status,
      age_band = v_band,
      minimum_age = v_policy.minimum_age,
      policy_version = v_policy.policy_version,
      evaluated_at = v_evaluated_at,
      source = 'legacy_remediation',
      updated_at = v_evaluated_at
  where user_id = v_actor
    and status = 'unknown_legacy';

  return pg_catalog.jsonb_build_object(
    'status', v_status,
    'age_band', v_band,
    'evaluated', true,
    'advertiser_18_plus_eligible', v_band = 'age_18_plus',
    'policy_version', v_policy.policy_version,
    'minimum_age', v_policy.minimum_age,
    'already_evaluated', false
  );
end;
$$;

-- Missing legacy authority is materialized as an explicit, non-assertive state.
insert into private.user_age_eligibility (
  user_id, status, age_band, minimum_age, policy_version,
  evaluated_at, source
)
select
  users.id,
  'unknown_legacy',
  'unknown_legacy',
  policy.minimum_age,
  policy.policy_version,
  null,
  'legacy_unknown'
from auth.users as users
cross join private.age_eligibility_policy as policy
left join private.user_age_eligibility as eligibility
  on eligibility.user_id = users.id
where policy.singleton
  and eligibility.user_id is null
on conflict (user_id) do nothing;

comment on function public.get_my_age_eligibility() is
  'Self-only canonical age eligibility projection. Returns no DOB and accepts no user identifier.';
comment on function public.remediate_my_age_eligibility(text) is
  'One-time self remediation through the canonical DOB classifier; stores classification only, never DOB.';

revoke all on function public.get_my_age_eligibility()
  from public, anon, authenticated, service_role;
revoke all on function public.remediate_my_age_eligibility(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_age_eligibility() to authenticated;
grant execute on function public.remediate_my_age_eligibility(text) to authenticated;

commit;

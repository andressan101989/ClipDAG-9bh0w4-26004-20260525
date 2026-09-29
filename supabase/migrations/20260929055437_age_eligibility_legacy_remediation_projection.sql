begin;

do $$
begin
  if pg_catalog.to_regclass('private.user_age_eligibility') is null
    or pg_catalog.to_regclass('private.age_eligibility_policy') is null
    or pg_catalog.to_regprocedure('public.remediate_my_age_eligibility(text)') is null
  then
    raise exception using
      errcode = '55000',
      message = 'age_eligibility_canonical_authority_missing';
  end if;
end;
$$;

create or replace function public.get_my_age_eligibility_status_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_policy private.age_eligibility_policy%rowtype;
  v_eligibility private.user_age_eligibility%rowtype;
  v_state text;
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

  v_state := case
    when v_eligibility.user_id is null then 'unavailable'
    when v_eligibility.status = 'ineligible' then 'ineligible'
    when v_eligibility.status = 'eligible'
      and v_eligibility.birth_date is null then 'remediation_required'
    when v_eligibility.status = 'eligible'
      and v_eligibility.birth_date is not null then 'complete'
    else 'unavailable'
  end;

  return pg_catalog.jsonb_build_object(
    'authority', 'private.user_age_eligibility',
    'state', v_state,
    'evaluated', coalesce(v_eligibility.evaluated_at is not null, false),
    'birth_date_present', coalesce(v_eligibility.birth_date is not null, false),
    'remediation_required', v_state = 'remediation_required',
    'policy_version', v_policy.policy_version,
    'minimum_age', v_policy.minimum_age
  );
end;
$$;

comment on function public.get_my_age_eligibility_status_v2() is
  'Self-only minimal age-authority status projection. Returns no date of birth or exact age.';

revoke all on function public.get_my_age_eligibility_status_v2()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_age_eligibility_status_v2() to authenticated;

commit;

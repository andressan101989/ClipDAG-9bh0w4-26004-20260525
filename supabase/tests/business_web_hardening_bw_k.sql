begin;

create or replace function pg_temp.bwk_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'bwk_assertion_failed: %', p_message;
  end if;
end;
$$;

select pg_temp.bwk_assert(
  private.business_team_protected_capabilities() = array[
    'business.team.manage',
    'business.settings.manage',
    'business.finance.read',
    'business.payouts.read',
    'business.payouts.manage'
  ]::text[],
  'protected capability authority preserves the exact J2 set'
);

select pg_temp.bwk_assert(
  position(
    'private.business_team_protected_capabilities()'
    in pg_get_functiondef('public.get_my_business_team(uuid)'::regprocedure)
  ) > 0,
  'Team projection consumes the protected capability authority'
);

select pg_temp.bwk_assert(
  position(
    'private.business_team_protected_capabilities()'
    in pg_get_functiondef('public.manage_business_team(text,jsonb)'::regprocedure)
  ) > 0,
  'Team mutation enforcement consumes the protected capability authority'
);

select pg_temp.bwk_assert(
  not has_function_privilege('public', 'private.business_team_protected_capabilities()', 'execute')
  and not has_function_privilege('anon', 'private.business_team_protected_capabilities()', 'execute')
  and not has_function_privilege('authenticated', 'private.business_team_protected_capabilities()', 'execute')
  and not has_function_privilege('service_role', 'private.business_team_protected_capabilities()', 'execute'),
  'private authority has no client or service API grant'
);

select pg_temp.bwk_assert(
  has_function_privilege('authenticated', 'public.get_my_business_team(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.manage_business_team(text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.get_my_business_team(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.manage_business_team(text,jsonb)', 'execute'),
  'public Team contracts preserve authenticated-only grants'
);

rollback;

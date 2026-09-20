-- B1 is a non-blocking foundation. No Auth Hook is configured here, no
-- auth.users trigger is attached, and no existing user or access policy changes.

create table private.age_eligibility_policy (
  singleton boolean primary key default true check (singleton),
  minimum_age smallint not null check (minimum_age = 18),
  policy_version text not null check (policy_version ~ '^nelyon-age-v[0-9]+$')
);

insert into private.age_eligibility_policy (singleton, minimum_age, policy_version)
values (true, 18, 'nelyon-age-v1');

create table private.user_age_eligibility (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('eligible', 'unknown_legacy', 'ineligible')),
  minimum_age smallint not null check (minimum_age = 18),
  policy_version text not null,
  evaluated_at timestamptz,
  source text not null check (source in ('signup_metadata', 'legacy_remediation', 'legacy_unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint age_eligibility_evaluation_check check (
    (status = 'unknown_legacy' and evaluated_at is null)
    or (status in ('eligible', 'ineligible') and evaluated_at is not null)
  )
);

create index user_age_eligibility_status_idx
  on private.user_age_eligibility (status, policy_version);

alter table private.age_eligibility_policy enable row level security;
alter table private.age_eligibility_policy force row level security;
alter table private.user_age_eligibility enable row level security;
alter table private.user_age_eligibility force row level security;

revoke all on table private.age_eligibility_policy from public, anon, authenticated;
revoke all on table private.user_age_eligibility from public, anon, authenticated;

-- One server-side calculation, shared by the future signup hook and
-- materialization/remediation code. A Feb 29 birthday reaches the boundary
-- on Mar 1 in a non-leap anniversary year. UTC fixes the calendar boundary.
create function private.age_evaluate_dob(
  p_dob text,
  p_as_of date default (now() at time zone 'UTC')::date
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_birth_date date;
  v_minimum_age smallint;
begin
  if p_dob is null or p_dob !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_as_of is null then
    return 'unknown_legacy';
  end if;

  begin
    v_birth_date := p_dob::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return 'unknown_legacy';
  end;

  if to_char(v_birth_date, 'YYYY-MM-DD') <> p_dob or v_birth_date > p_as_of then
    return 'unknown_legacy';
  end if;

  select minimum_age into v_minimum_age
  from private.age_eligibility_policy
  where singleton = true;

  if v_minimum_age is null then
    return 'unknown_legacy';
  end if;

  if v_birth_date <= (p_as_of - make_interval(years => v_minimum_age::integer))::date then
    return 'eligible';
  end if;
  return 'ineligible';
end;
$$;

-- This helper is deliberately NOT wired into current policies. At B3 its
-- EXECUTE privilege must be granted only for the server-side policy context.
create function private.current_user_is_age_eligible() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from private.user_age_eligibility e
    join private.age_eligibility_policy p on p.singleton = true
    where e.user_id = auth.uid()
      and e.status = 'eligible'
      and e.minimum_age = p.minimum_age
      and e.policy_version = p.policy_version
      and e.evaluated_at is not null
  ), false);
$$;

-- Prepared for B2 only. The remote Before User Created setting is NOT
-- enabled by this migration. The hook's input metadata is untrusted; the
-- calculation is server-side and the hook cannot create an auth.users FK row.
create function private.age_before_user_created(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.age_evaluate_dob(event->'user'->'user_metadata'->>'date_of_birth') = 'eligible' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 400,
    'message', 'You must be at least 18 years old to create a Nelyon account.'
  ));
end;
$$;

revoke all on function private.age_evaluate_dob(text, date) from public, anon, authenticated;
revoke all on function private.current_user_is_age_eligible() from public, anon, authenticated;
revoke all on function private.age_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.age_before_user_created(jsonb) to supabase_auth_admin;

comment on table private.user_age_eligibility is
  'B1 eligibility authority. Missing row means unknown legacy, not eligible. No current access policy consumes it.';
comment on function private.age_before_user_created(jsonb) is
  'Prepared only; enable Auth Hook in a separately approved phase after compatibility and race verification.';

-- C1 supersedes account eligibility v1. The Auth Hook remains disabled until
-- every distributed signup client carries the new 13+ contract.
-- Existing users and age rows are deliberately not backfilled or reclassified.
begin;

lock table private.age_eligibility_policy in access exclusive mode;
lock table private.user_age_eligibility in access exclusive mode;

do $$
begin
  if (select count(*) from private.age_eligibility_policy) <> 1 then
    raise exception 'age_policy_singleton_invalid';
  end if;
  if exists (select 1 from private.user_age_eligibility) then
    raise exception 'age_policy_c1_requires_age_row_review';
  end if;
end;
$$;

alter table private.age_eligibility_policy
  drop constraint age_eligibility_policy_minimum_age_check;
alter table private.age_eligibility_policy
  add column creator_exclusive_minimum_age smallint;
update private.age_eligibility_policy
set minimum_age = 13,
    creator_exclusive_minimum_age = 18,
    policy_version = 'nelyon-age-v2'
where singleton = true;
alter table private.age_eligibility_policy
  alter column creator_exclusive_minimum_age set not null,
  add constraint age_eligibility_policy_minimum_age_check check (minimum_age = 13),
  add constraint age_eligibility_policy_creator_exclusive_minimum_age_check
    check (creator_exclusive_minimum_age = 18 and creator_exclusive_minimum_age > minimum_age);

alter table private.user_age_eligibility
  drop constraint user_age_eligibility_minimum_age_check;
alter table private.user_age_eligibility
  add column age_band text not null,
  add constraint user_age_eligibility_minimum_age_check check (minimum_age = 13),
  add constraint user_age_eligibility_age_band_check check (
    (age_band = 'unknown_legacy' and status = 'unknown_legacy')
    or (age_band = 'under_13' and status = 'ineligible')
    or (age_band in ('age_13_17', 'age_18_plus') and status = 'eligible')
  );

-- One strict UTC-calendar calculation supplies both account and creator-age
-- decisions. A Feb 29 birth reaches either threshold on March 1 in a
-- non-leap anniversary year.
create or replace function private.age_classify_dob(
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
  v_account_minimum smallint;
  v_exclusive_minimum smallint;
begin
  if p_dob is null or p_dob !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p_as_of is null then
    return 'unknown_legacy';
  end if;

  begin
    v_birth_date := p_dob::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    return 'unknown_legacy';
  end;

  if pg_catalog.to_char(v_birth_date, 'YYYY-MM-DD') <> p_dob or v_birth_date > p_as_of then
    return 'unknown_legacy';
  end if;

  select minimum_age, creator_exclusive_minimum_age
    into v_account_minimum, v_exclusive_minimum
  from private.age_eligibility_policy
  where singleton = true;

  if v_account_minimum is null or v_exclusive_minimum is null then
    return 'unknown_legacy';
  end if;
  if v_birth_date <= (p_as_of - pg_catalog.make_interval(years => v_exclusive_minimum::integer))::date then
    return 'age_18_plus';
  end if;
  if v_birth_date <= (p_as_of - pg_catalog.make_interval(years => v_account_minimum::integer))::date then
    return 'age_13_17';
  end if;
  return 'under_13';
end;
$$;

-- Keep the B1 function name for its existing callers, without a second
-- calendar algorithm. Status now means account eligibility under v2.
create or replace function private.age_evaluate_dob(
  p_dob text,
  p_as_of date default (now() at time zone 'UTC')::date
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case private.age_classify_dob(p_dob, p_as_of)
    when 'age_13_17' then 'eligible'
    when 'age_18_plus' then 'eligible'
    when 'under_13' then 'ineligible'
    else 'unknown_legacy'
  end;
$$;

create or replace function private.current_user_is_age_eligible() returns boolean
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
      and e.age_band in ('age_13_17', 'age_18_plus')
      and e.minimum_age = p.minimum_age
      and e.policy_version = p.policy_version
      and e.evaluated_at is not null
  ), false);
$$;

-- Server-side predicate for the future canonical creator-exclusive access
-- boundary. No direct anon/authenticated EXECUTE grant is made in C1.
create or replace function private.current_user_is_creator_exclusive_age_eligible() returns boolean
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
      and e.age_band = 'age_18_plus'
      and e.minimum_age = p.minimum_age
      and e.policy_version = p.policy_version
      and e.evaluated_at is not null
  ), false);
$$;

create or replace function private.age_before_user_created(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.age_evaluate_dob(event->'user'->'user_metadata'->>'date_of_birth') = 'eligible' then
    return '{}'::jsonb;
  end if;
  return pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 400,
    'message', 'You must be at least 13 years old to create a Nelyon account.'
  ));
end;
$$;

-- The existing auth.users AFTER INSERT trigger retains its function OID.
-- Any unexpected insert failure propagates and rolls back user creation.
create or replace function private.materialize_user_age_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.age_eligibility_policy%rowtype;
  v_band text;
  v_status text;
begin
  select * into strict v_policy
  from private.age_eligibility_policy
  where singleton = true;

  v_band := private.age_classify_dob(new.raw_user_meta_data->>'date_of_birth');
  v_status := case v_band
    when 'age_13_17' then 'eligible'
    when 'age_18_plus' then 'eligible'
    when 'under_13' then 'ineligible'
    else 'unknown_legacy'
  end;

  insert into private.user_age_eligibility (
    user_id, status, age_band, minimum_age, policy_version, evaluated_at, source
  ) values (
    new.id,
    v_status,
    v_band,
    v_policy.minimum_age,
    v_policy.policy_version,
    case when v_band = 'unknown_legacy' then null else now() end,
    case when v_band = 'unknown_legacy' then 'legacy_unknown' else 'signup_metadata' end
  );

  return new;
end;
$$;

revoke all on function private.age_classify_dob(text, date) from public, anon, authenticated;
revoke all on function private.age_evaluate_dob(text, date) from public, anon, authenticated;
revoke all on function private.current_user_is_age_eligible() from public, anon, authenticated;
revoke all on function private.current_user_is_creator_exclusive_age_eligible() from public, anon, authenticated;
revoke all on function private.age_before_user_created(jsonb) from public, anon, authenticated;
revoke all on function private.materialize_user_age_eligibility() from public, anon, authenticated;
grant execute on function private.age_before_user_created(jsonb) to supabase_auth_admin;

comment on table private.age_eligibility_policy is
  'Single v2 policy: account minimum 13; creator-exclusive age minimum 18.';
comment on table private.user_age_eligibility is
  'Single private account/creator-age classification; no DOB or public profile data. Missing row is not eligible.';
comment on function private.current_user_is_creator_exclusive_age_eligible() is
  'Age predicate only. Creator-exclusive entitlement and media delivery must also be authorized by their canonical server boundary.';

commit;

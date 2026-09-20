-- B2 materializes eligibility in the auth.users insert transaction.
-- The Before User Created hook is enabled separately after client release.
create function private.materialize_user_age_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.age_eligibility_policy%rowtype;
  v_status text;
begin
  select * into strict v_policy
  from private.age_eligibility_policy
  where singleton = true;

  v_status := private.age_evaluate_dob(new.raw_user_meta_data->>'date_of_birth');

  insert into private.user_age_eligibility (
    user_id, status, minimum_age, policy_version, evaluated_at, source
  ) values (
    new.id,
    v_status,
    v_policy.minimum_age,
    v_policy.policy_version,
    case when v_status = 'unknown_legacy' then null else now() end,
    case when v_status = 'unknown_legacy' then 'legacy_unknown' else 'signup_metadata' end
  );

  return new;
end;
$$;

revoke all on function private.materialize_user_age_eligibility()
  from public, anon, authenticated;

create trigger on_auth_user_age_eligibility
after insert on auth.users
for each row execute function private.materialize_user_age_eligibility();

comment on function private.materialize_user_age_eligibility() is
  'B2: recompute untrusted Auth DOB against the B1 policy during auth.users insertion. Privileged creation without valid DOB remains unknown.';

-- MKT-B8S: protect server-managed profile privilege and integrity columns.
-- Admin provisioning remains a database-operator/service-role responsibility.

create or replace function public.protect_user_profile_server_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_trusted_role boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
begin
  if v_trusted_role then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.is_admin then
      raise exception using errcode = '42501', message = 'user_profile_admin_privilege_forbidden';
    end if;
    if new.dag_balance <> 0
      or new.followers_count <> 0
      or new.following_count <> 0 then
      raise exception using errcode = '42501', message = 'user_profile_server_field_forbidden';
    end if;
  else
    if new.is_admin is distinct from old.is_admin then
      raise exception using errcode = '42501', message = 'user_profile_admin_privilege_forbidden';
    end if;
    if new.dag_balance is distinct from old.dag_balance
      or new.followers_count is distinct from old.followers_count
      or new.following_count is distinct from old.following_count
      or new.id is distinct from old.id
      or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'user_profile_server_field_forbidden';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists protect_user_profile_server_fields on public.user_profiles;
create trigger protect_user_profile_server_fields
before insert or update on public.user_profiles
for each row execute function public.protect_user_profile_server_fields();

drop policy if exists user_profiles_insert_self on public.user_profiles;
create policy user_profiles_insert_self
on public.user_profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and is_admin = false
  and dag_balance = 0
  and followers_count = 0
  and following_count = 0
);

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self
on public.user_profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Remove the historical table-wide DML grants before introducing a bounded
-- column contract. SELECT remains public for the existing social profile model.
revoke insert, update, delete, truncate, references, trigger
on table public.user_profiles from anon, authenticated;

grant select on table public.user_profiles to anon, authenticated;

grant insert (
  id,
  email,
  username,
  display_name,
  avatar_url,
  bio,
  profession,
  website,
  location,
  dag_balance,
  wallet_address,
  is_private,
  hide_activity,
  allow_comments_from,
  allow_messages_from,
  push_token
) on public.user_profiles to authenticated;

grant update (
  username,
  display_name,
  avatar_url,
  bio,
  profession,
  website,
  location,
  dag_balance,
  wallet_address,
  is_private,
  hide_activity,
  allow_comments_from,
  allow_messages_from,
  push_token
) on public.user_profiles to authenticated;

revoke all on function public.protect_user_profile_server_fields()
from public, anon, authenticated;
grant execute on function public.protect_user_profile_server_fields()
to service_role;

comment on function public.protect_user_profile_server_fields() is
  'B8S row trigger: rejects authenticated changes to admin privilege, legacy balance cache, social counters, and immutable profile identity fields. Trusted provisioning is database-operator/service-role only.';

-- SUPERUSER-A1S: harden the existing admin, profile, social, and financial
-- boundaries without introducing a second authority or moving any money.

-- ---------------------------------------------------------------------------
-- SEC-A1: expose only the public profile contract to runtime clients.
-- ---------------------------------------------------------------------------

create or replace view public.public_user_profiles
with (security_invoker = true, security_barrier = true)
as
select
  id,
  username,
  display_name,
  avatar_url,
  bio,
  profession,
  website,
  location,
  followers_count,
  following_count,
  is_private,
  created_at,
  updated_at
from public.user_profiles;

comment on view public.public_user_profiles is
  'A1S public profile projection. Excludes email, wallet, balance, admin privilege, push token, and private preference fields.';

revoke all on table public.public_user_profiles from public, anon, authenticated;
grant select on table public.public_user_profiles to anon, authenticated, service_role;

revoke select on table public.user_profiles from public, anon, authenticated;
grant select (
  id,
  username,
  display_name,
  avatar_url,
  bio,
  profession,
  website,
  location,
  followers_count,
  following_count,
  is_private,
  created_at,
  updated_at
) on public.user_profiles to anon, authenticated;

revoke insert (email, dag_balance, is_admin),
  update (email, dag_balance, is_admin)
on public.user_profiles from authenticated;

create or replace function public.get_my_user_profile_private()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.user_profiles;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'user_profile_auth_required';
  end if;

  select * into strict v_profile
  from public.user_profiles
  where id = v_actor;

  return jsonb_build_object(
    'wallet_address', v_profile.wallet_address,
    'is_private', v_profile.is_private,
    'hide_activity', v_profile.hide_activity,
    'allow_comments_from', v_profile.allow_comments_from,
    'allow_messages_from', v_profile.allow_messages_from
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'user_profile_not_found';
end
$$;

revoke all on function public.get_my_user_profile_private()
from public, anon, authenticated, service_role;
grant execute on function public.get_my_user_profile_private() to authenticated;

comment on function public.get_my_user_profile_private() is
  'A1S authenticated self-only projection for wallet address and private profile preferences; intentionally excludes email, balance, admin privilege, and push token.';

-- ---------------------------------------------------------------------------
-- SEC-A2: bind social mutation actors and make counters derived from events.
-- ---------------------------------------------------------------------------

create or replace function public.follow_user(p_follower_id uuid, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_inserted boolean;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'follow_auth_required';
  end if;
  if p_follower_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'follow_actor_mismatch';
  end if;
  if p_target_id is null or p_follower_id = p_target_id then
    raise exception using errcode = '22023', message = 'self_follow_not_allowed';
  end if;

  insert into public.follows (follower_id, following_id)
  values (v_actor, p_target_id)
  on conflict (follower_id, following_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted then
    update public.user_profiles
    set following_count = following_count + 1
    where id = v_actor;
    update public.user_profiles
    set followers_count = followers_count + 1
    where id = p_target_id;
  end if;
end
$$;

create or replace function public.unfollow_user(p_follower_id uuid, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_deleted boolean;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'unfollow_auth_required';
  end if;
  if p_follower_id is distinct from v_actor then
    raise exception using errcode = '42501', message = 'unfollow_actor_mismatch';
  end if;
  if p_target_id is null or p_follower_id = p_target_id then
    raise exception using errcode = '22023', message = 'self_follow_not_allowed';
  end if;

  delete from public.follows
  where follower_id = v_actor and following_id = p_target_id;
  get diagnostics v_deleted = row_count;

  if v_deleted then
    update public.user_profiles
    set following_count = greatest(0, following_count - 1)
    where id = v_actor;
    update public.user_profiles
    set followers_count = greatest(0, followers_count - 1)
    where id = p_target_id;
  end if;
end
$$;

revoke all on function public.follow_user(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.unfollow_user(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.follow_user(uuid, uuid) to authenticated;
grant execute on function public.unfollow_user(uuid, uuid) to authenticated;

create or replace function public.increment_comment_likes(
  p_comment_id uuid,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'comment_like_auth_required';
  end if;
  if p_comment_id is null then
    raise exception using errcode = '22023', message = 'comment_like_invalid_input';
  end if;

  -- p_delta remains only for wire compatibility. The stored counter is always
  -- recomputed from the canonical comment_likes rows, so callers cannot forge it.
  update public.comments c
  set likes_count = (
    select count(*)::integer
    from public.comment_likes cl
    where cl.comment_id = p_comment_id
  )
  where c.id = p_comment_id;
end
$$;

create or replace function public.increment_video_counter(
  p_video_id uuid,
  p_field text,
  p_delta integer default 1
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if auth.uid() is null
    and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'video_counter_auth_required';
  end if;
  if p_video_id is null or p_field not in ('likes_count', 'comments_count', 'saves_count') then
    raise exception using errcode = '22023', message = 'video_counter_invalid_input';
  end if;

  -- p_delta remains only for wire compatibility. Every supported counter is
  -- derived from its canonical event table and cannot be changed arbitrarily.
  update public.videos v
  set
    likes_count = case when p_field = 'likes_count' then (
      select count(*)::integer from public.likes l where l.video_id = p_video_id
    ) else v.likes_count end,
    comments_count = case when p_field = 'comments_count' then (
      select count(*)::integer from public.comments c where c.video_id = p_video_id
    ) else v.comments_count end,
    saves_count = case when p_field = 'saves_count' then (
      select count(*)::integer from public.video_saves s where s.video_id = p_video_id
    ) else v.saves_count end
  where v.id = p_video_id;
end
$$;

revoke all on function public.increment_comment_likes(uuid, integer)
from public, anon, authenticated, service_role;
revoke all on function public.increment_video_counter(uuid, text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.increment_comment_likes(uuid, integer) to authenticated;
grant execute on function public.increment_video_counter(uuid, text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seller moderation: keep the canonical wrapper client-facing and make the
-- historical status wrappers internal implementation details only.
-- ---------------------------------------------------------------------------

alter function public.approve_marketplace_seller(uuid)
set search_path to 'pg_catalog', 'public';
alter function public.reject_marketplace_seller(uuid, text)
set search_path to 'pg_catalog', 'public';
alter function public.suspend_marketplace_seller(uuid, text)
set search_path to 'pg_catalog', 'public';
alter function public.restore_marketplace_seller(uuid)
set search_path to 'pg_catalog', 'public';
alter function public.set_marketplace_seller_status(uuid, text, text)
set search_path to 'pg_catalog', 'public';

revoke all on function public.approve_marketplace_seller(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.reject_marketplace_seller(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.suspend_marketplace_seller(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.restore_marketplace_seller(uuid)
from public, anon, authenticated, service_role;

-- admin_moderate_marketplace_seller is SECURITY DEFINER owned by postgres, so
-- it can continue to invoke the wrappers without runtime EXECUTE grants.
grant execute on function public.admin_moderate_marketplace_seller(uuid, text, text, uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Financial runtime ACL and mutation guarantees.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
on table public.ledger_entries from anon, authenticated, service_role;
revoke select on table public.ledger_entries from anon;
grant select on table public.ledger_entries to authenticated, service_role;

create or replace function public.reject_ledger_entry_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  raise exception using errcode = '55000', message = 'ledger_entries_are_append_only';
end
$$;

drop trigger if exists ledger_entries_immutable on public.ledger_entries;
create trigger ledger_entries_immutable
before update or delete on public.ledger_entries
for each row execute function public.reject_ledger_entry_mutation();

revoke all on function public.reject_ledger_entry_mutation()
from public, anon, authenticated, service_role;

revoke insert, update, delete, truncate, references, trigger
on table public.financial_transactions from anon, authenticated, service_role;
revoke select on table public.financial_transactions from anon;
grant select on table public.financial_transactions to authenticated, service_role;
grant update (status, blockchain_txid)
on public.financial_transactions to service_role;

create or replace function public.protect_financial_transaction_mutation()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'financial_transaction_delete_forbidden';
  end if;

  -- Canonical SECURITY DEFINER financial functions are owned by postgres and
  -- perform legitimate lifecycle transitions atomically with their domain rows.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  -- The only remaining direct service-role update is bdag-withdraw after an
  -- on-chain broadcast. It may mark a withdrawal processing and attach its hash.
  if current_user = 'service_role'
    and old.operation_type = 'withdrawal'
    and new.status = 'processing'
    and new.blockchain_txid is not null
    and new.id is not distinct from old.id
    and new.from_account_id is not distinct from old.from_account_id
    and new.to_account_id is not distinct from old.to_account_id
    and new.operation_type is not distinct from old.operation_type
    and new.amount is not distinct from old.amount
    and new.fee_amount is not distinct from old.fee_amount
    and new.currency is not distinct from old.currency
    and new.reference_type is not distinct from old.reference_type
    and new.reference_id is not distinct from old.reference_id
    and new.created_at is not distinct from old.created_at
    and new.idempotency_key is not distinct from old.idempotency_key
    and new.initiated_by is not distinct from old.initiated_by
    and new.chain_id is not distinct from old.chain_id then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'financial_transaction_update_forbidden';
end
$$;

drop trigger if exists financial_transactions_runtime_guard
on public.financial_transactions;
create trigger financial_transactions_runtime_guard
before update or delete on public.financial_transactions
for each row execute function public.protect_financial_transaction_mutation();

revoke all on function public.protect_financial_transaction_mutation()
from public, anon, authenticated, service_role;

comment on function public.protect_financial_transaction_mutation() is
  'A1S guard: deletes are forbidden; runtime service_role may only record the processing/hash withdrawal broadcast transition; canonical owner functions retain lifecycle updates.';

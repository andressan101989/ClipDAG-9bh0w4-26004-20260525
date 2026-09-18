-- BUSINESS-WEB-BW-J2
-- Invitations are a pre-membership adapter only. BW-J1 memberships and
-- membership capabilities remain the sole runtime authorization authority.

create table private.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_owner_id uuid not null
    references public.marketplace_sellers(user_id) on delete cascade,
  invited_email text not null,
  invited_email_normalized text not null,
  status text not null default 'pending',
  created_by uuid not null
    references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  declined_at timestamptz,
  revoked_at timestamptz,
  accepted_by uuid references public.user_profiles(id) on delete restrict,
  constraint business_invitations_email_chk check (
    char_length(invited_email_normalized) between 3 and 320
    and invited_email_normalized = lower(btrim(invited_email))
    and invited_email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint business_invitations_status_chk check (
    status in ('pending', 'accepted', 'declined', 'revoked')
  ),
  constraint business_invitations_expiry_chk check (expires_at > created_at),
  constraint business_invitations_lifecycle_chk check (
    (status = 'pending' and accepted_at is null and declined_at is null and revoked_at is null and accepted_by is null)
    or (status = 'accepted' and accepted_at is not null and declined_at is null and revoked_at is null and accepted_by is not null)
    or (status = 'declined' and accepted_at is null and declined_at is not null and revoked_at is null and accepted_by is null)
    or (status = 'revoked' and accepted_at is null and declined_at is null and revoked_at is not null and accepted_by is null)
  )
);

create unique index business_invitations_pending_email_uidx
  on private.business_invitations (business_owner_id, invited_email_normalized)
  where (status = 'pending');
create index business_invitations_owner_created_idx
  on private.business_invitations (business_owner_id, created_at desc, id desc);
create index business_invitations_email_pending_idx
  on private.business_invitations (invited_email_normalized, status, expires_at);
create index business_invitations_created_by_idx
  on private.business_invitations (created_by);
create index business_invitations_accepted_by_idx
  on private.business_invitations (accepted_by)
  where accepted_by is not null;

create table private.business_invitation_capabilities (
  invitation_id uuid not null
    references private.business_invitations(id) on delete cascade,
  capability_code text not null
    references private.business_capability_catalog(code) on delete restrict,
  granted_by uuid not null
    references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (invitation_id, capability_code)
);

create index business_invitation_capabilities_code_idx
  on private.business_invitation_capabilities (capability_code);
create index business_invitation_capabilities_granted_by_idx
  on private.business_invitation_capabilities (granted_by);

create table private.business_team_audit_events (
  id uuid primary key default gen_random_uuid(),
  business_owner_id uuid not null
    references public.marketplace_sellers(user_id) on delete cascade,
  actor_user_id uuid not null
    references public.user_profiles(id) on delete restrict,
  action text not null,
  membership_id uuid references private.business_memberships(id) on delete restrict,
  invitation_id uuid references private.business_invitations(id) on delete restrict,
  target_user_id uuid references public.user_profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint business_team_audit_action_chk check (action in (
    'invitation_created',
    'invitation_revoked',
    'invitation_accepted',
    'invitation_declined',
    'member_capabilities_changed',
    'member_revoked'
  )),
  constraint business_team_audit_metadata_chk check (jsonb_typeof(metadata) = 'object')
);

create index business_team_audit_owner_created_idx
  on private.business_team_audit_events (business_owner_id, created_at desc, id desc);
create index business_team_audit_actor_idx
  on private.business_team_audit_events (actor_user_id);
create index business_team_audit_membership_idx
  on private.business_team_audit_events (membership_id)
  where membership_id is not null;
create index business_team_audit_invitation_idx
  on private.business_team_audit_events (invitation_id)
  where invitation_id is not null;
create index business_team_audit_target_idx
  on private.business_team_audit_events (target_user_id)
  where target_user_id is not null;

alter table private.business_invitations enable row level security;
alter table private.business_invitations force row level security;
alter table private.business_invitation_capabilities enable row level security;
alter table private.business_invitation_capabilities force row level security;
alter table private.business_team_audit_events enable row level security;
alter table private.business_team_audit_events force row level security;

create policy business_invitations_deny_clients
on private.business_invitations for all to anon, authenticated
using (false) with check (false);
create policy business_invitation_capabilities_deny_clients
on private.business_invitation_capabilities for all to anon, authenticated
using (false) with check (false);
create policy business_team_audit_events_deny_clients
on private.business_team_audit_events for all to anon, authenticated
using (false) with check (false);

revoke all privileges on table private.business_invitations from public, anon, authenticated, service_role;
revoke all privileges on table private.business_invitation_capabilities from public, anon, authenticated, service_role;
revoke all privileges on table private.business_team_audit_events from public, anon, authenticated, service_role;

create or replace function private.business_team_reject_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'business_team_audit_immutable';
end;
$$;

create trigger business_team_audit_immutable
before update or delete on private.business_team_audit_events
for each row execute function private.business_team_reject_audit_mutation();

create or replace function private.business_team_capability_codes(p_value jsonb)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_codes text[];
  v_count integer;
  v_distinct_count integer;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    raise exception using errcode = '22023', message = 'business_team_capabilities_invalid';
  end if;

  select
    coalesce(array_agg(v.code order by v.code), array[]::text[]),
    count(*)::integer,
    count(distinct v.code)::integer
  into v_codes, v_count, v_distinct_count
  from jsonb_array_elements_text(p_value) as v(code);

  if v_count = 0 then
    raise exception using errcode = '22023', message = 'business_team_capabilities_empty';
  end if;
  if v_count <> v_distinct_count then
    raise exception using errcode = '22023', message = 'business_team_capability_duplicate';
  end if;
  if v_count > (
    select count(*)::integer
    from private.business_capability_catalog as catalog
    where catalog.active
  ) then
    raise exception using errcode = '22023', message = 'business_team_capabilities_invalid';
  end if;
  if exists (
    select 1
    from unnest(v_codes) as requested(code)
    left join private.business_capability_catalog as catalog
      on catalog.code = requested.code
     and catalog.active
    where catalog.code is null
  ) then
    raise exception using errcode = '22023', message = 'business_team_capability_invalid';
  end if;

  return v_codes;
end;
$$;

revoke all on function private.business_team_reject_audit_mutation() from public, anon, authenticated, service_role;
revoke all on function private.business_team_capability_codes(jsonb) from public, anon, authenticated, service_role;

create or replace function public.get_my_business_team(
  p_business_owner_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_is_owner boolean;
  v_can_manage boolean;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  v_is_owner := v_actor = p_business_owner_id;
  v_can_manage := v_is_owner
    or private.business_actor_has_capability(p_business_owner_id, 'business.team.manage');

  if not (
    v_can_manage
    or private.business_actor_has_capability(p_business_owner_id, 'business.team.read')
  ) then
    raise exception using errcode = '42501', message = 'business_capability_required';
  end if;

  if not exists (
    select 1 from public.marketplace_sellers as seller
    where seller.user_id = p_business_owner_id and seller.status = 'approved'
  ) then
    raise exception using errcode = '42501', message = 'business_scope_denied';
  end if;

  return jsonb_build_object(
    'business_owner_id', p_business_owner_id,
    'actor', jsonb_build_object(
      'user_id', v_actor,
      'is_owner', v_is_owner,
      'can_manage', v_can_manage,
      'can_manage_protected', v_is_owner
    ),
    'owner', (
      select jsonb_build_object(
        'user_id', seller.user_id,
        'display_name', coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(seller.display_name), ''), profile.username, 'Propietario'),
        'username', profile.username,
        'avatar_url', profile.avatar_url,
        'email', case when v_can_manage then account.email else null end,
        'status', 'active'
      )
      from public.marketplace_sellers as seller
      left join public.user_profiles as profile on profile.id = seller.user_id
      left join auth.users as account on account.id = seller.user_id
      where seller.user_id = p_business_owner_id
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', membership.id,
        'user_id', membership.member_user_id,
        'display_name', coalesce(nullif(btrim(profile.display_name), ''), profile.username, 'Miembro'),
        'username', profile.username,
        'avatar_url', profile.avatar_url,
        'email', case when v_can_manage then account.email else null end,
        'status', membership.status,
        'created_at', membership.created_at,
        'updated_at', membership.updated_at,
        'revoked_at', membership.revoked_at,
        'capabilities', coalesce((
          select jsonb_agg(capability.capability_code order by capability.capability_code)
          from private.business_membership_capabilities as capability
          where capability.membership_id = membership.id
        ), '[]'::jsonb)
      ) order by (membership.status = 'active') desc, lower(coalesce(profile.display_name, profile.username, '')), membership.id)
      from private.business_memberships as membership
      join public.user_profiles as profile on profile.id = membership.member_user_id
      left join auth.users as account on account.id = membership.member_user_id
      where membership.business_owner_id = p_business_owner_id
    ), '[]'::jsonb),
    'invitations_authorized', v_can_manage,
    'invitations', case when v_can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invitation.id,
        'email', invitation.invited_email_normalized,
        'status', case when invitation.expires_at <= now() then 'expired' else invitation.status end,
        'created_at', invitation.created_at,
        'expires_at', invitation.expires_at,
        'invited_by', jsonb_build_object(
          'user_id', invitation.created_by,
          'display_name', coalesce(nullif(btrim(inviter.display_name), ''), inviter.username, 'Miembro'),
          'username', inviter.username
        ),
        'capabilities', coalesce((
          select jsonb_agg(snapshot.capability_code order by snapshot.capability_code)
          from private.business_invitation_capabilities as snapshot
          where snapshot.invitation_id = invitation.id
        ), '[]'::jsonb)
      ) order by invitation.created_at desc, invitation.id desc)
      from private.business_invitations as invitation
      join public.user_profiles as inviter on inviter.id = invitation.created_by
      where invitation.business_owner_id = p_business_owner_id
        and invitation.status = 'pending'
    ), '[]'::jsonb) else null end,
    'capability_catalog_authorized', v_can_manage,
    'capability_catalog', case when v_can_manage then coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', catalog.code,
        'domain', catalog.domain,
        'label', catalog.label,
        'description', catalog.description,
        'protected', catalog.code = any(array[
          'business.team.manage',
          'business.settings.manage',
          'business.finance.read',
          'business.payouts.read',
          'business.payouts.manage'
        ]::text[])
      ) order by catalog.domain, catalog.code)
      from private.business_capability_catalog as catalog
      where catalog.active
    ), '[]'::jsonb) else null end
  );
end;
$$;

create or replace function public.get_my_pending_business_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select lower(btrim(account.email))
  into v_actor_email
  from auth.users as account
  where account.id = v_actor
    and account.email_confirmed_at is not null;

  if v_actor_email is null then
    raise exception using errcode = '42501', message = 'business_invitation_verified_email_required';
  end if;

  return jsonb_build_object(
    'actor_user_id', v_actor,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invitation.id,
        'business_owner_id', invitation.business_owner_id,
        'business_name', coalesce(store.name, seller.display_name),
        'created_at', invitation.created_at,
        'expires_at', invitation.expires_at,
        'invited_by', jsonb_build_object(
          'display_name', coalesce(nullif(btrim(inviter.display_name), ''), inviter.username, 'Miembro'),
          'username', inviter.username
        ),
        'capabilities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', catalog.code,
            'domain', catalog.domain,
            'label', catalog.label,
            'description', catalog.description
          ) order by catalog.domain, catalog.code)
          from private.business_invitation_capabilities as snapshot
          join private.business_capability_catalog as catalog
            on catalog.code = snapshot.capability_code
          where snapshot.invitation_id = invitation.id
        ), '[]'::jsonb)
      ) order by invitation.created_at desc, invitation.id desc)
      from private.business_invitations as invitation
      join public.marketplace_sellers as seller
        on seller.user_id = invitation.business_owner_id
       and seller.status = 'approved'
      left join public.marketplace_stores as store
        on store.seller_id = invitation.business_owner_id
      join public.user_profiles as inviter on inviter.id = invitation.created_by
      where invitation.invited_email_normalized = v_actor_email
        and invitation.status = 'pending'
        and invitation.expires_at > now()
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.manage_business_team(
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_protected constant text[] := array[
    'business.team.manage',
    'business.settings.manage',
    'business.finance.read',
    'business.payouts.read',
    'business.payouts.manage'
  ]::text[];
  v_business_owner_id uuid;
  v_invitation_id uuid;
  v_membership_id uuid;
  v_email text;
  v_actor_email text;
  v_owner_email text;
  v_codes text[];
  v_old_codes text[];
  v_is_owner boolean;
  v_is_manager boolean;
  v_invitation private.business_invitations;
  v_membership private.business_memberships;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'business_team_payload_invalid';
  end if;
  if not exists (select 1 from public.user_profiles as profile where profile.id = v_actor) then
    raise exception using errcode = '42501', message = 'business_profile_required';
  end if;

  if v_action = 'create_invitation' then
    if coalesce(p_payload ->> 'business_owner_id', '') !~* v_uuid_pattern then
      raise exception using errcode = '22023', message = 'business_scope_invalid';
    end if;
    v_business_owner_id := (p_payload ->> 'business_owner_id')::uuid;
    v_is_owner := v_actor = v_business_owner_id;
    v_is_manager := private.business_actor_has_capability(v_business_owner_id, 'business.team.manage');
    if not (v_is_owner or v_is_manager) then
      raise exception using errcode = '42501', message = 'business_team_manage_required';
    end if;
    if not exists (
      select 1 from public.marketplace_sellers as seller
      where seller.user_id = v_business_owner_id and seller.status = 'approved'
    ) then
      raise exception using errcode = '42501', message = 'business_scope_denied';
    end if;

    v_email := lower(btrim(coalesce(p_payload ->> 'email', '')));
    if char_length(v_email) not between 3 and 320
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'business_invitation_email_invalid';
    end if;
    v_codes := private.business_team_capability_codes(p_payload -> 'capability_codes');

    if not v_is_owner then
      if v_codes && v_protected then
        raise exception using errcode = '42501', message = 'business_team_protected_capability_required';
      end if;
      if exists (
        select 1 from unnest(v_codes) as requested(code)
        where not private.business_actor_has_capability(v_business_owner_id, requested.code)
      ) then
        raise exception using errcode = '42501', message = 'business_team_capability_delegation_denied';
      end if;
    end if;

    select lower(btrim(account.email)) into v_actor_email
    from auth.users as account where account.id = v_actor;
    select lower(btrim(account.email)) into v_owner_email
    from auth.users as account where account.id = v_business_owner_id;
    if v_email = v_actor_email then
      raise exception using errcode = '22023', message = 'business_invitation_self_denied';
    end if;
    if v_email = v_owner_email then
      raise exception using errcode = '22023', message = 'business_invitation_owner_denied';
    end if;
    if exists (
      select 1
      from private.business_memberships as membership
      join auth.users as account on account.id = membership.member_user_id
      where membership.business_owner_id = v_business_owner_id
        and membership.status = 'active'
        and lower(btrim(account.email)) = v_email
    ) then
      raise exception using errcode = '23505', message = 'business_invitation_active_member';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_business_owner_id::text || '|' || v_email, 0));

    for v_invitation in
      select invitation.*
      from private.business_invitations as invitation
      where invitation.business_owner_id = v_business_owner_id
        and invitation.invited_email_normalized = v_email
        and invitation.status = 'pending'
      for update
    loop
      if v_invitation.expires_at > now() then
        raise exception using errcode = '23505', message = 'business_invitation_duplicate';
      end if;
      update private.business_invitations
      set status = 'revoked', revoked_at = now()
      where id = v_invitation.id;
      insert into private.business_team_audit_events (
        business_owner_id, actor_user_id, action, invitation_id, metadata
      ) values (
        v_business_owner_id, v_actor, 'invitation_revoked', v_invitation.id,
        jsonb_build_object('reason', 'expired_replaced')
      );
    end loop;

    begin
      insert into private.business_invitations (
        business_owner_id, invited_email, invited_email_normalized, created_by
      ) values (
        v_business_owner_id, v_email, v_email, v_actor
      ) returning * into v_invitation;
    exception when unique_violation then
      raise exception using errcode = '23505', message = 'business_invitation_duplicate';
    end;

    insert into private.business_invitation_capabilities (
      invitation_id, capability_code, granted_by
    )
    select v_invitation.id, requested.code, v_actor
    from unnest(v_codes) as requested(code);

    insert into private.business_team_audit_events (
      business_owner_id, actor_user_id, action, invitation_id, metadata
    ) values (
      v_business_owner_id, v_actor, 'invitation_created', v_invitation.id,
      jsonb_build_object('capability_codes', to_jsonb(v_codes))
    );

    return jsonb_build_object(
      'action', v_action,
      'invitation', jsonb_build_object(
        'id', v_invitation.id,
        'email', v_invitation.invited_email_normalized,
        'status', v_invitation.status,
        'created_at', v_invitation.created_at,
        'expires_at', v_invitation.expires_at,
        'capabilities', to_jsonb(v_codes)
      )
    );

  elsif v_action in ('revoke_invitation', 'accept_invitation', 'decline_invitation') then
    if coalesce(p_payload ->> 'invitation_id', '') !~* v_uuid_pattern then
      raise exception using errcode = '22023', message = 'business_invitation_id_invalid';
    end if;
    v_invitation_id := (p_payload ->> 'invitation_id')::uuid;

    select invitation.* into v_invitation
    from private.business_invitations as invitation
    where invitation.id = v_invitation_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'business_invitation_not_found';
    end if;
    v_business_owner_id := v_invitation.business_owner_id;

    if v_action = 'revoke_invitation' then
      v_is_owner := v_actor = v_business_owner_id;
      v_is_manager := private.business_actor_has_capability(v_business_owner_id, 'business.team.manage');
      if not (v_is_owner or v_is_manager) then
        raise exception using errcode = '42501', message = 'business_team_manage_required';
      end if;
      select coalesce(array_agg(snapshot.capability_code order by snapshot.capability_code), array[]::text[])
      into v_codes
      from private.business_invitation_capabilities as snapshot
      where snapshot.invitation_id = v_invitation.id;

      if not v_is_owner then
        if v_codes && v_protected then
          raise exception using errcode = '42501', message = 'business_team_protected_capability_required';
        end if;
        if exists (
          select 1 from unnest(v_codes) as requested(code)
          where not private.business_actor_has_capability(v_business_owner_id, requested.code)
        ) then
          raise exception using errcode = '42501', message = 'business_team_capability_delegation_denied';
        end if;
      end if;
      if v_invitation.status = 'revoked' then
        return jsonb_build_object('action', v_action, 'invitation_id', v_invitation.id, 'status', 'revoked');
      end if;
      if v_invitation.status <> 'pending' then
        raise exception using errcode = '55000', message = 'business_invitation_not_pending';
      end if;

      update private.business_invitations
      set status = 'revoked', revoked_at = now()
      where id = v_invitation.id;
      insert into private.business_team_audit_events (
        business_owner_id, actor_user_id, action, invitation_id, metadata
      ) values (
        v_business_owner_id, v_actor, 'invitation_revoked', v_invitation.id,
        jsonb_build_object('capability_codes', to_jsonb(v_codes))
      );
      return jsonb_build_object('action', v_action, 'invitation_id', v_invitation.id, 'status', 'revoked');
    end if;

    select lower(btrim(account.email)) into v_actor_email
    from auth.users as account
    where account.id = v_actor
      and account.email_confirmed_at is not null;
    if v_actor_email is null then
      raise exception using errcode = '42501', message = 'business_invitation_verified_email_required';
    end if;
    if v_actor_email <> v_invitation.invited_email_normalized then
      raise exception using errcode = '42501', message = 'business_invitation_wrong_email';
    end if;

    if v_action = 'accept_invitation' then
      if v_invitation.status = 'accepted' and v_invitation.accepted_by = v_actor then
        select membership.* into v_membership
        from private.business_memberships as membership
        where membership.business_owner_id = v_business_owner_id
          and membership.member_user_id = v_actor;
        return jsonb_build_object(
          'action', v_action,
          'invitation_id', v_invitation.id,
          'status', 'accepted',
          'membership_id', v_membership.id,
          'membership_status', v_membership.status
        );
      end if;
      if v_invitation.status = 'revoked' then
        raise exception using errcode = '55000', message = 'business_invitation_revoked';
      end if;
      if v_invitation.status <> 'pending' then
        raise exception using errcode = '55000', message = 'business_invitation_not_pending';
      end if;
      if v_invitation.expires_at <= now() then
        raise exception using errcode = '55000', message = 'business_invitation_expired';
      end if;
      if v_actor = v_business_owner_id then
        raise exception using errcode = '22023', message = 'business_invitation_owner_denied';
      end if;
      if exists (
        select 1
        from private.business_invitation_capabilities as snapshot
        left join private.business_capability_catalog as catalog
          on catalog.code = snapshot.capability_code and catalog.active
        where snapshot.invitation_id = v_invitation.id and catalog.code is null
      ) then
        raise exception using errcode = '55000', message = 'business_invitation_capability_inactive';
      end if;

      insert into private.business_memberships (
        business_owner_id, member_user_id, status, created_by, revoked_at
      ) values (
        v_business_owner_id, v_actor, 'active', v_invitation.created_by, null
      )
      on conflict (business_owner_id, member_user_id) do update
      set status = 'active',
          created_by = excluded.created_by,
          updated_at = now(),
          revoked_at = null
      returning * into v_membership;

      delete from private.business_membership_capabilities
      where membership_id = v_membership.id;
      insert into private.business_membership_capabilities (
        membership_id, capability_code, granted_by
      )
      select v_membership.id, snapshot.capability_code, v_invitation.created_by
      from private.business_invitation_capabilities as snapshot
      where snapshot.invitation_id = v_invitation.id;

      update private.business_invitations
      set status = 'accepted', accepted_at = now(), accepted_by = v_actor
      where id = v_invitation.id;
      insert into private.business_team_audit_events (
        business_owner_id, actor_user_id, action, membership_id, invitation_id, target_user_id, metadata
      ) values (
        v_business_owner_id, v_actor, 'invitation_accepted', v_membership.id, v_invitation.id, v_actor,
        jsonb_build_object('reactivated', v_membership.created_at < v_invitation.created_at)
      );

      select coalesce(jsonb_agg(capability.capability_code order by capability.capability_code), '[]'::jsonb)
      into v_result
      from private.business_membership_capabilities as capability
      where capability.membership_id = v_membership.id;
      return jsonb_build_object(
        'action', v_action,
        'invitation_id', v_invitation.id,
        'status', 'accepted',
        'membership_id', v_membership.id,
        'membership_status', v_membership.status,
        'capabilities', v_result
      );
    end if;

    if v_invitation.status = 'declined' then
      return jsonb_build_object('action', v_action, 'invitation_id', v_invitation.id, 'status', 'declined');
    end if;
    if v_invitation.status = 'revoked' then
      raise exception using errcode = '55000', message = 'business_invitation_revoked';
    end if;
    if v_invitation.status <> 'pending' then
      raise exception using errcode = '55000', message = 'business_invitation_not_pending';
    end if;
    if v_invitation.expires_at <= now() then
      raise exception using errcode = '55000', message = 'business_invitation_expired';
    end if;

    update private.business_invitations
    set status = 'declined', declined_at = now()
    where id = v_invitation.id;
    insert into private.business_team_audit_events (
      business_owner_id, actor_user_id, action, invitation_id, target_user_id
    ) values (
      v_business_owner_id, v_actor, 'invitation_declined', v_invitation.id, v_actor
    );
    return jsonb_build_object('action', v_action, 'invitation_id', v_invitation.id, 'status', 'declined');

  elsif v_action in ('set_member_capabilities', 'revoke_member') then
    if coalesce(p_payload ->> 'membership_id', '') !~* v_uuid_pattern then
      raise exception using errcode = '22023', message = 'business_membership_id_invalid';
    end if;
    v_membership_id := (p_payload ->> 'membership_id')::uuid;
    select membership.* into v_membership
    from private.business_memberships as membership
    where membership.id = v_membership_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'business_membership_not_found';
    end if;
    v_business_owner_id := v_membership.business_owner_id;
    v_is_owner := v_actor = v_business_owner_id;
    v_is_manager := private.business_actor_has_capability(v_business_owner_id, 'business.team.manage');
    if not (v_is_owner or v_is_manager) then
      raise exception using errcode = '42501', message = 'business_team_manage_required';
    end if;
    if v_actor = v_membership.member_user_id then
      raise exception using errcode = '42501', message = 'business_team_self_management_denied';
    end if;
    if v_membership.status <> 'active' then
      raise exception using errcode = '55000', message = 'business_membership_not_active';
    end if;

    select coalesce(array_agg(capability.capability_code order by capability.capability_code), array[]::text[])
    into v_old_codes
    from private.business_membership_capabilities as capability
    where capability.membership_id = v_membership.id;

    if not v_is_owner and 'business.team.manage' = any(v_old_codes) then
      raise exception using errcode = '42501', message = 'business_team_manager_target_denied';
    end if;

    if v_action = 'set_member_capabilities' then
      v_codes := private.business_team_capability_codes(p_payload -> 'capability_codes');
      if not v_is_owner then
        if (v_old_codes && v_protected) or (v_codes && v_protected) then
          raise exception using errcode = '42501', message = 'business_team_protected_capability_required';
        end if;
        if exists (
          select 1 from unnest(v_codes) as requested(code)
          where not private.business_actor_has_capability(v_business_owner_id, requested.code)
        ) then
          raise exception using errcode = '42501', message = 'business_team_capability_delegation_denied';
        end if;
      end if;

      delete from private.business_membership_capabilities
      where membership_id = v_membership.id;
      insert into private.business_membership_capabilities (
        membership_id, capability_code, granted_by
      )
      select v_membership.id, requested.code, v_actor
      from unnest(v_codes) as requested(code);
      update private.business_memberships
      set updated_at = now()
      where id = v_membership.id;
      insert into private.business_team_audit_events (
        business_owner_id, actor_user_id, action, membership_id, target_user_id, metadata
      ) values (
        v_business_owner_id, v_actor, 'member_capabilities_changed', v_membership.id,
        v_membership.member_user_id,
        jsonb_build_object('previous_capability_codes', to_jsonb(v_old_codes), 'capability_codes', to_jsonb(v_codes))
      );
      return jsonb_build_object(
        'action', v_action,
        'membership_id', v_membership.id,
        'status', 'active',
        'capabilities', to_jsonb(v_codes)
      );
    end if;

    if not v_is_owner and v_old_codes && v_protected then
      raise exception using errcode = '42501', message = 'business_team_protected_capability_required';
    end if;
    update private.business_memberships
    set status = 'revoked', revoked_at = now(), updated_at = now()
    where id = v_membership.id;
    insert into private.business_team_audit_events (
      business_owner_id, actor_user_id, action, membership_id, target_user_id, metadata
    ) values (
      v_business_owner_id, v_actor, 'member_revoked', v_membership.id,
      v_membership.member_user_id,
      jsonb_build_object('capability_codes', to_jsonb(v_old_codes))
    );
    return jsonb_build_object('action', v_action, 'membership_id', v_membership.id, 'status', 'revoked');
  end if;

  raise exception using errcode = '22023', message = 'business_team_action_invalid';
end;
$$;

revoke all on function public.get_my_business_team(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_my_pending_business_invitations() from public, anon, authenticated, service_role;
revoke all on function public.manage_business_team(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_my_business_team(uuid) to authenticated;
grant execute on function public.get_my_pending_business_invitations() to authenticated;
grant execute on function public.manage_business_team(text, jsonb) to authenticated;

comment on table private.business_invitations is
  'Business invitation lifecycle before membership. It never grants runtime access.';
comment on table private.business_invitation_capabilities is
  'Immutable invitation capability snapshot copied atomically into BW-J1 membership capabilities on acceptance.';
comment on table private.business_team_audit_events is
  'Append-only, sanitized Business Team command audit scoped to the canonical seller owner.';
comment on function public.get_my_business_team(uuid) is
  'Capability-scoped Team projection. business.team.manage implies read only for this Team surface.';
comment on function public.get_my_pending_business_invitations() is
  'Authenticated invitation inbox derived exclusively from the verified auth.users email.';
comment on function public.manage_business_team(text, jsonb) is
  'Single authenticated Business Team command authority with owner and delegated-manager enforcement.';

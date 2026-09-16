-- BUSINESS-WEB-BW-J1
-- Business scope remains public.marketplace_sellers(user_id). Owners are implicit;
-- only non-owner member access is stored here.

create table private.business_capability_catalog (
  code text primary key,
  domain text not null,
  label text not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint business_capability_code_format_chk
    check (code ~ '^business\.[a-z_]+\.[a-z_]+$'),
  constraint business_capability_domain_chk
    check (domain ~ '^[a-z_]+$')
);

create table private.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_owner_id uuid not null
    references public.marketplace_sellers(user_id) on delete cascade,
  member_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  status text not null default 'active',
  created_by uuid not null
    references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint business_memberships_not_owner_chk
    check (business_owner_id <> member_user_id),
  constraint business_memberships_status_chk
    check (status in ('active', 'revoked')),
  constraint business_memberships_revocation_chk
    check (
      (status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null)
    ),
  constraint business_memberships_owner_member_key
    unique (business_owner_id, member_user_id)
);

create index business_memberships_member_status_idx
  on private.business_memberships (member_user_id, status, business_owner_id);
create index business_memberships_created_by_idx
  on private.business_memberships (created_by);

create table private.business_membership_capabilities (
  membership_id uuid not null
    references private.business_memberships(id) on delete cascade,
  capability_code text not null
    references private.business_capability_catalog(code) on delete restrict,
  granted_by uuid not null
    references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (membership_id, capability_code)
);

create index business_membership_capabilities_code_idx
  on private.business_membership_capabilities (capability_code);
create index business_membership_capabilities_granted_by_idx
  on private.business_membership_capabilities (granted_by);

insert into private.business_capability_catalog (code, domain, label, description)
values
  ('business.home.read', 'home', 'Ver inicio', 'Ver el resumen del espacio empresarial.'),
  ('business.store.read', 'store', 'Ver tienda', 'Ver la identidad y el estado de la tienda.'),
  ('business.store.manage', 'store', 'Gestionar tienda', 'Editar el perfil básico de la tienda.'),
  ('business.catalog.read', 'catalog', 'Ver catálogo', 'Ver productos y variantes del negocio.'),
  ('business.catalog.manage', 'catalog', 'Gestionar catálogo', 'Crear y editar productos y variantes.'),
  ('business.inventory.read', 'inventory', 'Ver inventario', 'Ver existencias y reservas.'),
  ('business.inventory.manage', 'inventory', 'Gestionar inventario', 'Modificar existencias y configuración de inventario.'),
  ('business.orders.read', 'orders', 'Ver pedidos', 'Ver pedidos del negocio.'),
  ('business.orders.fulfill', 'orders', 'Preparar pedidos', 'Gestionar preparación y fulfillment de pedidos.'),
  ('business.returns.read', 'returns', 'Ver devoluciones', 'Ver solicitudes de devolución.'),
  ('business.returns.manage', 'returns', 'Gestionar devoluciones', 'Responder y operar devoluciones autorizadas.'),
  ('business.disputes.read', 'disputes', 'Ver disputas', 'Ver disputas del negocio.'),
  ('business.disputes.respond', 'disputes', 'Responder disputas', 'Responder disputas y aportar evidencia.'),
  ('business.ads.read', 'ads', 'Ver publicidad', 'Ver campañas y resultados publicitarios.'),
  ('business.ads.manage', 'ads', 'Gestionar publicidad', 'Crear y administrar campañas publicitarias.'),
  ('business.media.read', 'media', 'Ver media', 'Ver la biblioteca canónica de medios.'),
  ('business.media.manage', 'media', 'Gestionar media', 'Gestionar medios empresariales.'),
  ('business.finance.read', 'finance', 'Ver finanzas', 'Ver información financiera empresarial autorizada.'),
  ('business.payouts.read', 'payouts', 'Ver payouts', 'Ver payouts empresariales.'),
  ('business.payouts.manage', 'payouts', 'Gestionar payouts', 'Operar payouts mediante su autoridad canónica.'),
  ('business.analytics.read', 'analytics', 'Ver analítica', 'Ver analítica empresarial.'),
  ('business.team.read', 'team', 'Ver equipo', 'Ver miembros del negocio.'),
  ('business.team.manage', 'team', 'Gestionar equipo', 'Gestionar miembros y permisos empresariales.'),
  ('business.settings.manage', 'settings', 'Gestionar configuración', 'Administrar configuración empresarial permitida.');

alter table private.business_capability_catalog enable row level security;
alter table private.business_capability_catalog force row level security;
alter table private.business_memberships enable row level security;
alter table private.business_memberships force row level security;
alter table private.business_membership_capabilities enable row level security;
alter table private.business_membership_capabilities force row level security;

create policy business_capability_catalog_deny_clients
on private.business_capability_catalog for all to anon, authenticated
using (false) with check (false);
create policy business_memberships_deny_clients
on private.business_memberships for all to anon, authenticated
using (false) with check (false);
create policy business_membership_capabilities_deny_clients
on private.business_membership_capabilities for all to anon, authenticated
using (false) with check (false);

revoke all on table private.business_capability_catalog from public, anon, authenticated, service_role;
revoke all on table private.business_memberships from public, anon, authenticated, service_role;
revoke all on table private.business_membership_capabilities from public, anon, authenticated, service_role;

create or replace function private.business_membership_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'revoked' and new.revoked_at is null then
    new.revoked_at := now();
  elsif new.status = 'active' then
    new.revoked_at := null;
  end if;
  return new;
end;
$$;

create trigger business_memberships_set_updated_at
before update on private.business_memberships
for each row execute function private.business_membership_set_updated_at();

create or replace function private.business_effective_capabilities(
  p_business_owner_id uuid
)
returns table (capability_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code
  from private.business_capability_catalog as c
  where c.active
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.marketplace_sellers as s
      where s.user_id = p_business_owner_id
        and s.status = 'approved'
    )
    and (
      p_business_owner_id = (select auth.uid())
      or exists (
        select 1
        from private.business_memberships as m
        join private.business_membership_capabilities as mc
          on mc.membership_id = m.id
        where m.business_owner_id = p_business_owner_id
          and m.member_user_id = (select auth.uid())
          and m.status = 'active'
          and mc.capability_code = c.code
      )
    )
  order by c.code;
$$;

create or replace function private.business_actor_has_capability(
  p_business_owner_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.business_effective_capabilities(p_business_owner_id) as e
    where e.capability_code = p_capability
  );
$$;

create or replace function private.business_require_capability(
  p_business_owner_id uuid,
  p_capability text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.business_actor_has_capability(p_business_owner_id, p_capability) then
    raise exception using errcode = '42501', message = 'business_capability_required';
  end if;
end;
$$;

revoke all on function private.business_membership_set_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.business_effective_capabilities(uuid) from public, anon, authenticated, service_role;
revoke all on function private.business_actor_has_capability(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.business_require_capability(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.get_my_business_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owned_seller jsonb;
  v_businesses jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select jsonb_build_object(
    'user_id', s.user_id,
    'status', s.status,
    'display_name', s.display_name,
    'application_note', s.application_note,
    'suspension_reason', s.suspension_reason,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  )
  into v_owned_seller
  from public.marketplace_sellers as s
  where s.user_id = v_actor;

  with access_rows as (
    select
      s.user_id as business_owner_id,
      'owner'::text as access_type,
      null::uuid as membership_id,
      s.display_name,
      s.status as seller_status
    from public.marketplace_sellers as s
    where s.user_id = v_actor
      and s.status = 'approved'

    union all

    select
      s.user_id,
      'member'::text,
      m.id,
      s.display_name,
      s.status
    from private.business_memberships as m
    join public.marketplace_sellers as s
      on s.user_id = m.business_owner_id
    where m.member_user_id = v_actor
      and m.status = 'active'
      and s.status = 'approved'
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'business_owner_id', a.business_owner_id,
      'access_type', a.access_type,
      'membership_id', a.membership_id,
      'capabilities', coalesce((
        select jsonb_agg(e.capability_code order by e.capability_code)
        from private.business_effective_capabilities(a.business_owner_id) as e
      ), '[]'::jsonb),
      'seller', jsonb_build_object(
        'user_id', a.business_owner_id,
        'status', a.seller_status,
        'display_name', a.display_name
      ),
      'store', case
        when a.access_type = 'owner'
          or private.business_actor_has_capability(a.business_owner_id, 'business.store.read')
          or private.business_actor_has_capability(a.business_owner_id, 'business.store.manage')
        then (
          select jsonb_build_object(
            'id', st.id,
            'seller_id', st.seller_id,
            'name', st.name,
            'slug', st.slug,
            'description', st.description,
            'logo_asset_id', st.logo_asset_id,
            'banner_asset_id', st.banner_asset_id,
            'status', st.status,
            'created_at', st.created_at,
            'updated_at', st.updated_at
          )
          from public.marketplace_stores as st
          where st.seller_id = a.business_owner_id
        )
        else null
      end
    ) order by (a.access_type = 'owner') desc, lower(a.display_name), a.business_owner_id
  ), '[]'::jsonb)
  into v_businesses
  from access_rows as a;

  return jsonb_build_object(
    'actor_user_id', v_actor,
    'owned_seller', v_owned_seller,
    'businesses', v_businesses
  );
end;
$$;

revoke all on function public.get_my_business_access() from public, anon;
grant execute on function public.get_my_business_access() to authenticated;

create or replace function public.update_marketplace_store(
  p_store_id uuid,
  p_name text,
  p_slug text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_owner_id uuid;
  v_store_status text;
  v_slug text;
begin
  select st.seller_id, st.status
  into v_business_owner_id, v_store_status
  from public.marketplace_stores as st
  where st.id = p_store_id
  for update;

  if v_business_owner_id is null or v_store_status = 'suspended' then
    raise exception using errcode = '42501', message = 'store_not_editable';
  end if;

  perform private.business_require_capability(
    v_business_owner_id,
    'business.store.manage'
  );

  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 100 then
    raise exception using errcode = '22023', message = 'invalid_store_name';
  end if;
  if p_description is not null and char_length(p_description) > 1000 then
    raise exception using errcode = '22023', message = 'invalid_store_description';
  end if;

  v_slug := public.marketplace_normalize_slug(p_slug);
  if char_length(v_slug) not between 3 and 80 then
    raise exception using errcode = '22023', message = 'invalid_store_slug';
  end if;

  update public.marketplace_stores
  set
    name = btrim(p_name),
    slug = v_slug,
    description = nullif(btrim(p_description), '')
  where id = p_store_id
    and seller_id = v_business_owner_id
    and status <> 'suspended';

  if not found then
    raise exception using errcode = '42501', message = 'store_not_editable';
  end if;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'store_slug_exists';
end;
$$;

revoke all on function public.update_marketplace_store(uuid, text, text, text) from public, anon;
grant execute on function public.update_marketplace_store(uuid, text, text, text) to authenticated;

comment on table private.business_memberships is
  'Non-owner access to a canonical seller business. Owner authority remains marketplace_sellers.user_id.';
comment on table private.business_capability_catalog is
  'Stable business-scoped capability catalog; active rows are implicit owner capabilities.';
comment on table private.business_membership_capabilities is
  'Explicit capability grants for active non-owner business memberships.';
comment on function public.get_my_business_access() is
  'Authenticated projection of owned and member business scopes with effective capabilities.';

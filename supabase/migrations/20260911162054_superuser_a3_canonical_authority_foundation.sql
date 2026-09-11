-- SUPERUSER-A3 — canonical human admin authority foundation.
-- This migration intentionally provisions no SUPER_ADMIN assignment and performs
-- no financial operation. Reports continue to use user_profiles.is_admin until A4.

create temp table a3_precheck_counts on commit drop as
select
  (select count(*)::bigint from public.ledger_accounts) as ledger_accounts,
  (select count(*)::bigint from public.financial_transactions) as financial_transactions,
  (select count(*)::bigint from public.ledger_entries) as ledger_entries;

create temp table a3_legacy_audit_ids on commit drop as
select id from public.marketplace_admin_action_audit;

do $precheck$
begin
  if (select count(*) from public.user_profiles where is_admin=true) <> 1 then
    raise exception using errcode='55000',message='a3_legacy_admin_count_changed';
  end if;
  if (select count(*) from public.marketplace_admin_action_audit) <> 6 then
    raise exception using errcode='55000',message='a3_legacy_audit_count_changed';
  end if;
  if to_regclass('private.admin_roles') is not null
     or to_regclass('private.admin_capabilities') is not null
     or to_regclass('private.admin_role_capabilities') is not null
     or to_regclass('private.admin_role_grant_rules') is not null
     or to_regclass('private.admin_user_roles') is not null
     or to_regclass('private.admin_action_audit') is not null then
    raise exception using errcode='55000',message='a3_canonical_authority_already_exists';
  end if;
  if not exists(select 1 from pg_extension where extname='pgcrypto') then
    raise exception using errcode='55000',message='a3_pgcrypto_required';
  end if;
end
$precheck$;

create table private.admin_roles(
  role_code text primary key,
  display_name text not null,
  description text not null,
  is_assignable boolean not null,
  is_root boolean not null,
  is_exclusive boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_roles_code_check check(role_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint admin_roles_root_check check(not is_root or(not is_assignable and is_exclusive))
);

create table private.admin_capabilities(
  capability_code text primary key,
  domain text not null,
  effect text not null,
  description text not null,
  is_sensitive boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_capabilities_code_check check(capability_code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$'),
  constraint admin_capabilities_domain_check check(domain ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint admin_capabilities_effect_check check(effect in('read','write','workflow'))
);

create table private.admin_role_capabilities(
  role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  capability_code text not null references private.admin_capabilities(capability_code) on update restrict on delete restrict,
  primary key(role_code,capability_code)
);

create table private.admin_role_grant_rules(
  actor_role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  target_role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  can_assign boolean not null,
  can_revoke boolean not null,
  primary key(actor_role_code,target_role_code),
  constraint admin_role_grant_rules_nonempty_check check(can_assign or can_revoke),
  constraint admin_role_grant_rules_no_self_check check(actor_role_code<>target_role_code),
  constraint admin_role_grant_rules_no_root_target_check check(target_role_code<>'SUPER_ADMIN')
);

create table private.admin_user_roles(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on update restrict on delete restrict,
  role_code text not null references private.admin_roles(role_code) on update restrict on delete restrict,
  grant_actor_kind text not null,
  granted_by_user_id uuid references auth.users(id) on update restrict on delete restrict,
  grant_operator_reference text,
  granted_at timestamptz not null default clock_timestamp(),
  grant_reason text not null,
  revoke_actor_kind text,
  revoked_by_user_id uuid references auth.users(id) on update restrict on delete restrict,
  revoke_operator_reference text,
  revoked_at timestamptz,
  revoke_reason text,
  version bigint not null default 1,
  constraint admin_user_roles_grant_actor_kind_check check(grant_actor_kind in('human_admin','trusted_operator')),
  constraint admin_user_roles_revoke_actor_kind_check check(revoke_actor_kind is null or revoke_actor_kind in('human_admin','trusted_operator')),
  constraint admin_user_roles_grant_provenance_check check(
    (grant_actor_kind='human_admin' and granted_by_user_id is not null and grant_operator_reference is null)
    or
    (grant_actor_kind='trusted_operator' and granted_by_user_id is null and grant_operator_reference is not null)
  ),
  constraint admin_user_roles_revoke_provenance_check check(
    (revoked_at is null and revoke_actor_kind is null and revoked_by_user_id is null
      and revoke_operator_reference is null and revoke_reason is null)
    or
    (revoked_at is not null and revoke_actor_kind='human_admin' and revoked_by_user_id is not null
      and revoke_operator_reference is null and revoke_reason is not null)
    or
    (revoked_at is not null and revoke_actor_kind='trusted_operator' and revoked_by_user_id is null
      and revoke_operator_reference is not null and revoke_reason is not null)
  ),
  constraint admin_user_roles_grant_reason_check check(grant_reason=btrim(grant_reason) and char_length(grant_reason) between 2 and 500),
  constraint admin_user_roles_revoke_reason_check check(revoke_reason is null or(revoke_reason=btrim(revoke_reason) and char_length(revoke_reason) between 2 and 500)),
  constraint admin_user_roles_grant_operator_check check(grant_operator_reference is null or(grant_operator_reference=btrim(grant_operator_reference) and char_length(grant_operator_reference) between 8 and 200)),
  constraint admin_user_roles_revoke_operator_check check(revoke_operator_reference is null or(revoke_operator_reference=btrim(revoke_operator_reference) and char_length(revoke_operator_reference) between 8 and 200)),
  constraint admin_user_roles_version_check check(version>0)
);

create unique index admin_user_roles_active_uidx
  on private.admin_user_roles(user_id,role_code)
  where revoked_at is null;
create index admin_user_roles_user_active_idx
  on private.admin_user_roles(user_id,granted_at,id)
  where revoked_at is null;

insert into private.admin_roles(role_code,display_name,description,is_assignable,is_root,is_exclusive) values
('SUPER_ADMIN','Super Admin','Root application authority; never database superuser.',false,true,true),
('PLATFORM_ADMIN','Platform Admin','Broad non-root platform operations without finance audit or dispute resolution.',true,false,true),
('MODERATOR','Moderator','Cross-domain safety and moderation authority.',true,false,false),
('SUPPORT','Support','Bounded customer support and case triage authority.',true,false,false),
('MARKETPLACE_ADMIN','Marketplace Admin','Canonical Marketplace administration and dispute workflow authority.',true,false,true),
('FINANCE_AUDITOR','Finance Auditor','Read-only financial investigation and reconciliation authority.',true,false,true);

insert into private.admin_capabilities(capability_code,domain,effect,description,is_sensitive) values
('admin.shell.access','admin','read','Access the global admin shell.',false),
('admin.roles.read','admin','read','Read canonical role assignments.',true),
('admin.roles.assign','admin','write','Assign permitted non-root roles.',true),
('admin.roles.revoke','admin','write','Revoke permitted non-root roles.',true),
('admin.audit.read','admin','read','Read non-financial platform administration audit.',true),
('users.accounts.read','users','read','Read bounded user administration projections.',true),
('users.accounts.moderate','users','write','Perform bounded user moderation.',true),
('users.accounts.suspend','users','write','Suspend an account through its canonical workflow.',true),
('users.accounts.restore','users','write','Restore an account through its canonical workflow.',true),
('reports.cases.read','reports','read','Read report cases.',true),
('reports.cases.review','reports','write','Review report cases.',true),
('reports.cases.resolve','reports','write','Resolve report cases.',true),
('content.items.read','content','read','Read content administration projections.',false),
('content.items.moderate','content','write','Moderate content.',true),
('content.items.hide','content','write','Hide content through a canonical workflow.',true),
('content.items.restore','content','write','Restore hidden content.',true),
('stories.items.read','stories','read','Read Stories administration projections.',false),
('stories.items.moderate','stories','write','Moderate Stories.',true),
('chat.abuse_reports.read','chat','read','Read case-bounded Chat abuse context.',true),
('chat.abuse_reports.moderate','chat','write','Moderate Chat abuse cases.',true),
('live.sessions.read','live','read','Read LIVE administration projections.',false),
('live.sessions.moderate','live','write','Moderate LIVE sessions.',true),
('live.sessions.terminate','live','write','Terminate LIVE sessions through a canonical workflow.',true),
('battles.sessions.read','battles','read','Read Battle administration projections.',false),
('battles.sessions.moderate','battles','write','Moderate Battles.',true),
('marketplace.overview.read','marketplace','read','Read Marketplace overview.',false),
('marketplace.orders.read','marketplace','read','Read Marketplace orders.',true),
('marketplace.sellers.read','marketplace','read','Read Marketplace sellers.',true),
('marketplace.sellers.moderate','marketplace','write','Moderate Marketplace sellers.',true),
('marketplace.products.read','marketplace','read','Read Marketplace products.',false),
('marketplace.products.moderate','marketplace','write','Moderate Marketplace products.',true),
('marketplace.disputes.read','marketplace','read','Read Marketplace disputes.',true),
('marketplace.disputes.resolve','marketplace','workflow','Invoke the canonical Marketplace dispute workflow.',true),
('marketplace.promotions.read','marketplace','read','Read Marketplace promotions.',false),
('marketplace.ads.read','marketplace','read','Read Marketplace advertising.',true),
('marketplace.creators.read','marketplace','read','Read creator commerce projections.',true),
('marketplace.health.read','marketplace','read','Read Marketplace health.',false),
('marketplace.audit.read','marketplace','read','Read capability-scoped Marketplace audit.',true),
('finance.ledger.read','finance','read','Read bounded ledger projections.',true),
('finance.reconciliation.read','finance','read','Read reconciliation projections.',true),
('finance.anomalies.read','finance','read','Read financial anomaly projections.',true),
('finance.audit.read','finance','read','Read redacted financial audit.',true),
('system.health.read','system','read','Read system health.',false),
('system.jobs.read','system','read','Read jobs and cron status.',false),
('system.audit.read','system','read','Read system and security audit.',true),
('media.assets.read','media','read','Read media administration projections.',true),
('media.assets.moderate','media','write','Moderate media assets.',true);

insert into private.admin_role_capabilities(role_code,capability_code)
select 'SUPER_ADMIN',capability_code from private.admin_capabilities;

insert into private.admin_role_capabilities(role_code,capability_code)
select 'PLATFORM_ADMIN',capability_code from private.admin_capabilities
where capability_code not in(
  'marketplace.disputes.resolve','finance.ledger.read','finance.reconciliation.read',
  'finance.anomalies.read','finance.audit.read');

insert into private.admin_role_capabilities(role_code,capability_code) values
('MODERATOR','admin.shell.access'),
('MODERATOR','users.accounts.read'),('MODERATOR','users.accounts.moderate'),
('MODERATOR','users.accounts.suspend'),('MODERATOR','users.accounts.restore'),
('MODERATOR','reports.cases.read'),('MODERATOR','reports.cases.review'),('MODERATOR','reports.cases.resolve'),
('MODERATOR','content.items.read'),('MODERATOR','content.items.moderate'),
('MODERATOR','content.items.hide'),('MODERATOR','content.items.restore'),
('MODERATOR','stories.items.read'),('MODERATOR','stories.items.moderate'),
('MODERATOR','chat.abuse_reports.read'),('MODERATOR','chat.abuse_reports.moderate'),
('MODERATOR','live.sessions.read'),('MODERATOR','live.sessions.moderate'),('MODERATOR','live.sessions.terminate'),
('MODERATOR','battles.sessions.read'),('MODERATOR','battles.sessions.moderate'),
('MODERATOR','media.assets.read'),('MODERATOR','media.assets.moderate'),
('SUPPORT','admin.shell.access'),('SUPPORT','users.accounts.read'),
('SUPPORT','reports.cases.read'),('SUPPORT','reports.cases.review'),
('SUPPORT','marketplace.orders.read'),('SUPPORT','marketplace.disputes.read'),
('MARKETPLACE_ADMIN','admin.shell.access'),
('MARKETPLACE_ADMIN','marketplace.overview.read'),('MARKETPLACE_ADMIN','marketplace.orders.read'),
('MARKETPLACE_ADMIN','marketplace.sellers.read'),('MARKETPLACE_ADMIN','marketplace.sellers.moderate'),
('MARKETPLACE_ADMIN','marketplace.products.read'),('MARKETPLACE_ADMIN','marketplace.products.moderate'),
('MARKETPLACE_ADMIN','marketplace.disputes.read'),('MARKETPLACE_ADMIN','marketplace.disputes.resolve'),
('MARKETPLACE_ADMIN','marketplace.promotions.read'),('MARKETPLACE_ADMIN','marketplace.ads.read'),
('MARKETPLACE_ADMIN','marketplace.creators.read'),('MARKETPLACE_ADMIN','marketplace.health.read'),
('MARKETPLACE_ADMIN','marketplace.audit.read'),
('FINANCE_AUDITOR','admin.shell.access'),('FINANCE_AUDITOR','marketplace.orders.read'),
('FINANCE_AUDITOR','marketplace.disputes.read'),('FINANCE_AUDITOR','marketplace.health.read'),
('FINANCE_AUDITOR','marketplace.audit.read'),('FINANCE_AUDITOR','finance.ledger.read'),
('FINANCE_AUDITOR','finance.reconciliation.read'),('FINANCE_AUDITOR','finance.anomalies.read'),
('FINANCE_AUDITOR','finance.audit.read'),('FINANCE_AUDITOR','system.health.read');

insert into private.admin_role_grant_rules(actor_role_code,target_role_code,can_assign,can_revoke) values
('SUPER_ADMIN','PLATFORM_ADMIN',true,true),
('SUPER_ADMIN','MODERATOR',true,true),
('SUPER_ADMIN','SUPPORT',true,true),
('SUPER_ADMIN','MARKETPLACE_ADMIN',true,true),
('SUPER_ADMIN','FINANCE_AUDITOR',true,true),
('PLATFORM_ADMIN','MODERATOR',true,true),
('PLATFORM_ADMIN','SUPPORT',true,true);

alter table private.admin_roles enable row level security;
alter table private.admin_capabilities enable row level security;
alter table private.admin_role_capabilities enable row level security;
alter table private.admin_role_grant_rules enable row level security;
alter table private.admin_user_roles enable row level security;

revoke all privileges on table private.admin_roles from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_capabilities from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_role_capabilities from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_role_grant_rules from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_user_roles from public,anon,authenticated,service_role;
revoke all on schema private from public,anon,authenticated,service_role;

create function private.admin_active_role_codes(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select coalesce(array_agg(role_code order by role_code),'{}'::text[])
  from private.admin_user_roles
  where user_id=p_user_id and revoked_at is null;
$$;

create function private.admin_role_set_is_valid(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  with normalized as(
    select coalesce(array_agg(distinct role_code order by role_code),'{}'::text[]) roles
    from unnest(coalesce(p_roles,'{}'::text[])) role_code
  )
  select cardinality(roles)<=1 or roles=array['MODERATOR','SUPPORT']::text[]
  from normalized;
$$;

create function private.admin_effective_capabilities(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_roles text[];
begin
  v_roles:=private.admin_active_role_codes(p_user_id);
  if not private.admin_role_set_is_valid(v_roles) then return '{}'::text[];end if;
  return coalesce((
    select array_agg(distinct rc.capability_code order by rc.capability_code)
    from private.admin_role_capabilities rc
    where rc.role_code=any(v_roles)
  ),'{}'::text[]);
end;
$$;

create function private.admin_authority_version(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select encode(extensions.digest(coalesce(string_agg(
    id::text||':'||role_code||':'||version::text,'|' order by role_code,id
  ),''),'sha256'),'hex')
  from private.admin_user_roles
  where user_id=p_user_id and revoked_at is null;
$$;

create function private.admin_request_fingerprint(p_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path to 'pg_catalog','private','public'
as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex');
$$;

create function private.admin_guard_user_role_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='42501',message='admin_user_roles_delete_forbidden';
  end if;
  if (new.id,new.user_id,new.role_code,new.grant_actor_kind,new.granted_by_user_id,
      new.grant_operator_reference,new.granted_at,new.grant_reason)
     is distinct from
     (old.id,old.user_id,old.role_code,old.grant_actor_kind,old.granted_by_user_id,
      old.grant_operator_reference,old.granted_at,old.grant_reason) then
    raise exception using errcode='42501',message='admin_user_roles_grant_immutable';
  end if;
  if old.revoked_at is not null or new.revoked_at is null or new.version<>old.version+1 then
    raise exception using errcode='42501',message='admin_user_roles_invalid_transition';
  end if;
  return new;
end;
$$;

create trigger admin_user_roles_guard
before update or delete on private.admin_user_roles
for each row execute function private.admin_guard_user_role_mutation();

revoke all on function private.admin_active_role_codes(uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_role_set_is_valid(text[]) from public,anon,authenticated,service_role;
revoke all on function private.admin_effective_capabilities(uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_authority_version(uuid) from public,anon,authenticated,service_role;
revoke all on function private.admin_request_fingerprint(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.admin_guard_user_role_mutation() from public,anon,authenticated,service_role;

-- Evolve the existing physical audit table in place and preserve its OID/history.
drop trigger marketplace_admin_action_audit_immutable on public.marketplace_admin_action_audit;
alter table public.marketplace_admin_action_audit set schema private;
alter table private.marketplace_admin_action_audit rename to admin_action_audit;
alter table private.admin_action_audit rename column reason_code to reason;

alter table private.admin_action_audit drop constraint marketplace_admin_action_audit_action_check;
alter table private.admin_action_audit drop constraint marketplace_admin_action_audit_target_type_check;
alter table private.admin_action_audit drop constraint marketplace_admin_action_audit_reason_code_check;
alter table private.admin_action_audit alter column actor_id drop not null;

alter table private.admin_action_audit
  add column actor_kind text,
  add column actor_role_snapshot text[],
  add column actor_capability text,
  add column domain text,
  add column target_ref text,
  add column outcome text,
  add column financial_effect boolean,
  add column contains_pii boolean,
  add column idempotency_scope text,
  add column request_fingerprint text;

update private.admin_action_audit
set actor_kind='human_admin',
    actor_role_snapshot=array['LEGACY_MARKETPLACE_ADMIN']::text[],
    actor_capability=case
      when action like 'seller_%' then 'marketplace.sellers.moderate'
      when action like 'product_%' then 'marketplace.products.moderate'
      when action like 'dispute_%' then 'marketplace.disputes.resolve'
    end,
    domain='marketplace',
    target_ref=null,
    outcome='succeeded',
    financial_effect=action like 'dispute_%',
    contains_pii=target_type in('seller','dispute'),
    idempotency_scope='v1|human|'||actor_id::text||'|'||case
      when action like 'seller_%' then 'marketplace.sellers.moderate'
      when action like 'product_%' then 'marketplace.products.moderate'
      else 'marketplace.disputes.resolve' end||'|'||action,
    request_fingerprint=metadata->>'request_fingerprint';

alter table private.admin_action_audit
  alter column actor_kind set not null,
  alter column actor_role_snapshot set not null,
  alter column domain set not null,
  alter column outcome set not null,
  alter column financial_effect set not null,
  alter column contains_pii set not null,
  alter column idempotency_scope set not null,
  alter column request_fingerprint set not null;

alter table private.admin_action_audit
  add constraint admin_action_audit_actor_kind_check check(actor_kind in('human_admin','trusted_operator','system_workflow')),
  add constraint admin_action_audit_outcome_check check(outcome in('succeeded','no_op','denied','failed')),
  add constraint admin_action_audit_actor_contract_check check(
    (actor_kind='human_admin' and actor_id is not null and actor_capability is not null and cardinality(actor_role_snapshot)>0)
    or(actor_kind in('trusted_operator','system_workflow') and actor_capability is null and cardinality(actor_role_snapshot)=0)
  ),
  add constraint admin_action_audit_capability_fkey foreign key(actor_capability)
    references private.admin_capabilities(capability_code) on update restrict on delete restrict,
  add constraint admin_action_audit_domain_check check(domain ~ '^[a-z][a-z0-9_]{1,31}$'),
  add constraint admin_action_audit_action_check check(action ~ '^[a-z][a-z0-9_.]{2,100}$'),
  add constraint admin_action_audit_target_type_check check(target_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  add constraint admin_action_audit_reason_check check(reason is null or(reason=btrim(reason) and char_length(reason) between 2 and 500)),
  add constraint admin_action_audit_metadata_check_v2 check(jsonb_typeof(metadata)='object'),
  add constraint admin_action_audit_scope_check check(idempotency_scope=btrim(idempotency_scope) and char_length(idempotency_scope) between 8 and 300),
  add constraint admin_action_audit_fingerprint_check check(request_fingerprint ~ '^[0-9a-f]{64}$');

create unique index admin_action_audit_scope_key_uidx
  on private.admin_action_audit(idempotency_scope,idempotency_key);
create index admin_action_audit_domain_created_idx
  on private.admin_action_audit(domain,created_at desc,id desc);

alter table private.admin_action_audit rename constraint marketplace_admin_action_audit_pkey to admin_action_audit_pkey;
alter table private.admin_action_audit rename constraint marketplace_admin_action_audit_actor_id_fkey to admin_action_audit_actor_id_fkey;
alter table private.admin_action_audit rename constraint marketplace_admin_action_audit_actor_id_idempotency_key_key to admin_action_audit_actor_key_key;
alter table private.admin_action_audit rename constraint marketplace_admin_action_audit_metadata_check to admin_action_audit_metadata_check_legacy;
alter index private.marketplace_admin_action_audit_target_idx rename to admin_action_audit_target_idx;
alter index private.marketplace_admin_activity_created_idx rename to admin_action_audit_created_idx;

create function private.admin_prepare_action_audit()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  if new.actor_kind is null then new.actor_kind:='human_admin';end if;
  if new.actor_kind='human_admin' then
    if new.actor_id is null or new.actor_id is distinct from auth.uid() then
      raise exception using errcode='42501',message='admin_audit_actor_mismatch';
    end if;
    if new.actor_capability is null then
      new.actor_capability:=case
        when new.action like 'seller_%' then 'marketplace.sellers.moderate'
        when new.action like 'product_%' then 'marketplace.products.moderate'
        when new.action like 'dispute_%' then 'marketplace.disputes.resolve'
      end;
    end if;
    if new.actor_capability is null then
      raise exception using errcode='22023',message='admin_audit_capability_required';
    end if;
    if not public.admin_actor_has_capability(new.actor_capability) then
      raise exception using errcode='42501',message='admin_audit_capability_forbidden';
    end if;
    new.actor_role_snapshot:=coalesce(new.actor_role_snapshot,private.admin_active_role_codes(new.actor_id));
    if cardinality(new.actor_role_snapshot)=0 then
      raise exception using errcode='42501',message='admin_audit_role_snapshot_required';
    end if;
    new.domain:=coalesce(new.domain,'marketplace');
    new.outcome:=coalesce(new.outcome,'succeeded');
    new.financial_effect:=coalesce(new.financial_effect,new.action like 'dispute_%');
    new.contains_pii:=coalesce(new.contains_pii,new.target_type in('seller','dispute','user'));
    new.idempotency_scope:=coalesce(new.idempotency_scope,
      'v1|human|'||new.actor_id::text||'|'||new.actor_capability||'|'||new.action);
  end if;
  new.actor_role_snapshot:=coalesce(new.actor_role_snapshot,'{}'::text[]);
  new.request_fingerprint:=coalesce(new.request_fingerprint,new.metadata->>'request_fingerprint');
  if coalesce(new.request_fingerprint,'')!~'^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='admin_audit_fingerprint_required';
  end if;
  return new;
end;
$$;

create function private.admin_reject_action_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  raise exception using errcode='42501',message='admin_action_audit_immutable';
end;
$$;

create trigger admin_action_audit_prepare
before insert on private.admin_action_audit
for each row execute function private.admin_prepare_action_audit();
create trigger admin_action_audit_immutable
before update or delete on private.admin_action_audit
for each row execute function private.admin_reject_action_audit_mutation();

alter table private.admin_action_audit enable row level security;
revoke all privileges on table private.admin_action_audit from public,anon,authenticated,service_role;
revoke all on function private.admin_prepare_action_audit() from public,anon,authenticated,service_role;
revoke all on function private.admin_reject_action_audit_mutation() from public,anon,authenticated,service_role;
drop function public.marketplace_reject_admin_action_audit_mutation();

-- Migrate legacy Marketplace administrators only. No root/global role is granted.
do $legacy$
declare
  v_user record;
  v_assignment_id uuid;
  v_key uuid;
  v_fingerprint text;
  v_receipt jsonb;
begin
  for v_user in select id from public.user_profiles where is_admin=true order by id loop
    v_assignment_id:=gen_random_uuid();
    v_key:=md5('20260911160134:legacy_is_admin:'||v_user.id::text)::uuid;
    v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
      'contract_version',1,'actor_kind','trusted_operator',
      'operator_reference','migration:20260911160134:legacy_is_admin',
      'action','admin.role.legacy_migrate','target_type','user','target_id',v_user.id,
      'role_code','MARKETPLACE_ADMIN'));
    insert into private.admin_user_roles(
      id,user_id,role_code,grant_actor_kind,granted_by_user_id,grant_operator_reference,
      grant_reason
    ) values(
      v_assignment_id,v_user.id,'MARKETPLACE_ADMIN','trusted_operator',null,
      'migration:20260911160134:legacy_is_admin','Legacy Marketplace authority migration'
    );
    v_receipt:=jsonb_build_object('assignment_id',v_assignment_id,'user_id',v_user.id,
      'role_code','MARKETPLACE_ADMIN','version',1);
    insert into private.admin_action_audit(
      actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
      target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
      idempotency_scope,idempotency_key,request_fingerprint
    ) values(
      null,'trusted_operator','{}'::text[],null,'admin','admin.role.legacy_migrate','user',
      v_user.id,'MARKETPLACE_ADMIN','Legacy Marketplace authority migration','succeeded',
      false,true,jsonb_build_object('operator_reference','migration:20260911160134:legacy_is_admin','receipt',v_receipt),
      'v1|trusted_operator|admin.role.legacy_migrate',v_key,v_fingerprint
    );
  end loop;
end
$legacy$;

create function public.admin_actor_has_capability(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_roles text[];
begin
  if v_actor is null or p_capability is null then return false;end if;
  if not exists(select 1 from private.admin_capabilities where capability_code=p_capability) then return false;end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then return false;end if;
  return p_capability=any(private.admin_effective_capabilities(v_actor));
end;
$$;

create function public.admin_require_capability(p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_roles text[];
begin
  if v_actor is null then raise exception using errcode='28000',message='admin_auth_required';end if;
  if p_capability is null or not exists(select 1 from private.admin_capabilities where capability_code=p_capability) then
    raise exception using errcode='22023',message='admin_capability_invalid';
  end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then
    raise exception using errcode='42501',message='admin_role_set_invalid';
  end if;
  if not p_capability=any(private.admin_effective_capabilities(v_actor)) then
    raise exception using errcode='42501',message='admin_capability_forbidden';
  end if;
  return v_actor;
end;
$$;

create function public.get_my_admin_access()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid:=auth.uid();v_roles text[];v_capabilities text[];v_profile record;v_admin boolean;
begin
  if v_actor is null then raise exception using errcode='28000',message='admin_auth_required';end if;
  v_roles:=private.admin_active_role_codes(v_actor);
  if not private.admin_role_set_is_valid(v_roles) then
    raise exception using errcode='42501',message='admin_role_set_invalid';
  end if;
  v_capabilities:=private.admin_effective_capabilities(v_actor);
  v_admin:='admin.shell.access'=any(v_capabilities);
  if not v_admin then
    return jsonb_build_object('admin',false,'roles','[]'::jsonb,'capabilities','[]'::jsonb,
      'effective_capabilities','[]'::jsonb,'authority_version',private.admin_authority_version(v_actor));
  end if;
  select id,username,display_name,avatar_url into v_profile
  from public.public_user_profiles where id=v_actor;
  return jsonb_build_object(
    'user_id',v_actor,'username',v_profile.username,'display_name',v_profile.display_name,
    'avatar_url',v_profile.avatar_url,'admin',true,'roles',to_jsonb(v_roles),
    'capabilities',to_jsonb(v_capabilities),'effective_capabilities',to_jsonb(v_capabilities),
    'authority_version',private.admin_authority_version(v_actor));
end;
$$;

create function public.admin_assign_role(
  p_user_id uuid,p_role_code text,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_role private.admin_roles;
  v_scope text;v_fingerprint text;v_prior private.admin_action_audit;v_roles text[];
  v_assignment private.admin_user_roles;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('admin.roles.assign');
  if p_user_id is null or p_role_code is null or p_idempotency_key is null
     or v_reason is null or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_role_assignment_invalid';
  end if;
  if v_actor=p_user_id then raise exception using errcode='42501',message='admin_self_elevation_forbidden';end if;
  select * into v_role from private.admin_roles where role_code=p_role_code;
  if not found or not v_role.is_assignable or v_role.is_root then
    raise exception using errcode='42501',message='admin_role_not_assignable';
  end if;
  if not exists(
    select 1 from private.admin_user_roles ar
    join private.admin_role_grant_rules gr on gr.actor_role_code=ar.role_code
    where ar.user_id=v_actor and ar.revoked_at is null and gr.target_role_code=p_role_code and gr.can_assign
  ) then raise exception using errcode='42501',message='admin_role_grant_forbidden';end if;
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null) then
    raise exception using errcode='P0002',message='admin_role_target_not_found';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|admin.roles.assign|admin.role.assign';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','admin.roles.assign','action','admin.role.assign','target_type','user',
    'target_id',p_user_id,'role_code',p_role_code,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-role-target:'||p_user_id::text,0));
  if exists(select 1 from private.admin_user_roles where user_id=p_user_id and role_code=p_role_code and revoked_at is null) then
    raise exception using errcode='23505',message='admin_role_already_active';
  end if;
  v_roles:=private.admin_active_role_codes(p_user_id);
  if not private.admin_role_set_is_valid(array_append(v_roles,p_role_code)) then
    raise exception using errcode='55000',message='admin_role_combination_forbidden';
  end if;
  insert into private.admin_user_roles(
    user_id,role_code,grant_actor_kind,granted_by_user_id,grant_operator_reference,grant_reason
  ) values(p_user_id,p_role_code,'human_admin',v_actor,null,v_reason)
  returning * into v_assignment;
  v_receipt:=jsonb_build_object('assignment_id',v_assignment.id,'user_id',p_user_id,
    'role_code',p_role_code,'version',v_assignment.version,'granted_at',v_assignment.granted_at);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,
    target_ref,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'admin.roles.assign',
    'admin','admin.role.assign','user',p_user_id,p_role_code,v_reason,'succeeded',false,true,
    jsonb_build_object('receipt',v_receipt),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function public.admin_revoke_role(
  p_assignment_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_assignment private.admin_user_roles;
  v_scope text;v_fingerprint text;v_prior private.admin_action_audit;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('admin.roles.revoke');
  if p_assignment_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_role_revocation_invalid';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|admin.roles.revoke|admin.role.revoke';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','admin.roles.revoke','action','admin.role.revoke',
    'assignment_id',p_assignment_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  select * into v_assignment from private.admin_user_roles where id=p_assignment_id for update;
  if not found or v_assignment.revoked_at is not null then
    raise exception using errcode='P0002',message='admin_role_assignment_not_active';
  end if;
  if v_assignment.user_id=v_actor then
    raise exception using errcode='42501',message='admin_self_revocation_forbidden';
  end if;
  if not exists(
    select 1 from private.admin_user_roles ar
    join private.admin_role_grant_rules gr on gr.actor_role_code=ar.role_code
    where ar.user_id=v_actor and ar.revoked_at is null
      and gr.target_role_code=v_assignment.role_code and gr.can_revoke
  ) then raise exception using errcode='42501',message='admin_role_revoke_forbidden';end if;
  update private.admin_user_roles set
    revoke_actor_kind='human_admin',revoked_by_user_id=v_actor,revoke_operator_reference=null,
    revoked_at=clock_timestamp(),revoke_reason=v_reason,version=version+1
  where id=v_assignment.id returning * into v_assignment;
  v_receipt:=jsonb_build_object('assignment_id',v_assignment.id,'user_id',v_assignment.user_id,
    'role_code',v_assignment.role_code,'version',v_assignment.version,'revoked_at',v_assignment.revoked_at);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,
    target_ref,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'admin.roles.revoke',
    'admin','admin.role.revoke','user',v_assignment.user_id,v_assignment.role_code,v_reason,
    'succeeded',false,true,jsonb_build_object('receipt',v_receipt),v_scope,
    p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function public.admin_trusted_provision_super_admin(
  p_user_id uuid,p_reason text,p_operator_reference text,p_idempotency_key uuid,
  p_replace_existing_roles boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_reason text:=nullif(btrim(p_reason),'');v_operator text:=nullif(btrim(p_operator_reference),'');
  v_scope text:='v1|trusted_operator|admin.root.provision';v_fingerprint text;
  v_prior private.admin_action_audit;v_existing private.admin_user_roles;v_assignment private.admin_user_roles;
  v_receipt jsonb;v_child_key uuid;v_child_fingerprint text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='admin_trusted_operator_required';
  end if;
  if p_user_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 or v_operator is null
     or char_length(v_operator) not between 8 and 200 then
    raise exception using errcode='22023',message='admin_root_provision_invalid';
  end if;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','trusted_operator','operator_reference',v_operator,
    'action','admin.root.provision','target_type','user','target_id',p_user_id,
    'role_code','SUPER_ADMIN','reason',v_reason,'replace_existing_roles',p_replace_existing_roles));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-super-admin-roster',0));
  perform pg_advisory_xact_lock(hashtextextended('admin-role-target:'||p_user_id::text,0));
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null) then
    raise exception using errcode='P0002',message='admin_root_target_not_found';
  end if;
  if exists(select 1 from private.admin_user_roles where user_id=p_user_id
    and role_code='SUPER_ADMIN' and revoked_at is null) then
    raise exception using errcode='23505',message='admin_root_already_active';
  end if;
  if exists(select 1 from private.admin_user_roles where user_id=p_user_id and revoked_at is null)
     and not p_replace_existing_roles then
    raise exception using errcode='55000',message='admin_root_requires_atomic_role_replacement';
  end if;
  if p_replace_existing_roles then
    for v_existing in select * from private.admin_user_roles
      where user_id=p_user_id and revoked_at is null for update
    loop
      update private.admin_user_roles set
        revoke_actor_kind='trusted_operator',revoked_by_user_id=null,
        revoke_operator_reference=v_operator,revoked_at=clock_timestamp(),
        revoke_reason='Atomic replacement for SUPER_ADMIN: '||v_reason,version=version+1
      where id=v_existing.id returning * into v_existing;
      v_child_key:=md5(p_idempotency_key::text||':'||v_existing.id::text)::uuid;
      v_child_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
        'contract_version',1,'actor_kind','trusted_operator','operator_reference',v_operator,
        'action','admin.role.revoke_for_root','assignment_id',v_existing.id,
        'target_id',p_user_id,'role_code',v_existing.role_code,'reason',v_reason));
      insert into private.admin_action_audit(
        actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
        target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
        idempotency_scope,idempotency_key,request_fingerprint
      ) values(null,'trusted_operator','{}'::text[],null,'admin','admin.role.revoke_for_root',
        'user',p_user_id,v_existing.role_code,'Atomic replacement for SUPER_ADMIN: '||v_reason,
        'succeeded',false,true,jsonb_build_object('operator_reference',v_operator,
          'assignment_id',v_existing.id,'version',v_existing.version),
        'v1|trusted_operator|admin.role.revoke_for_root',v_child_key,v_child_fingerprint);
    end loop;
  end if;
  insert into private.admin_user_roles(
    user_id,role_code,grant_actor_kind,granted_by_user_id,grant_operator_reference,grant_reason
  ) values(p_user_id,'SUPER_ADMIN','trusted_operator',null,v_operator,v_reason)
  returning * into v_assignment;
  v_receipt:=jsonb_build_object('assignment_id',v_assignment.id,'user_id',p_user_id,
    'role_code','SUPER_ADMIN','version',v_assignment.version,'granted_at',v_assignment.granted_at);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,
    target_ref,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(null,'trusted_operator','{}'::text[],null,'admin','admin.root.provision','user',
    p_user_id,'SUPER_ADMIN',v_reason,'succeeded',false,true,
    jsonb_build_object('operator_reference',v_operator,'receipt',v_receipt),v_scope,
    p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function public.admin_trusted_revoke_super_admin(
  p_assignment_id uuid,p_reason text,p_operator_reference text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_reason text:=nullif(btrim(p_reason),'');v_operator text:=nullif(btrim(p_operator_reference),'');
  v_scope text:='v1|trusted_operator|admin.root.revoke';v_fingerprint text;
  v_prior private.admin_action_audit;v_assignment private.admin_user_roles;v_receipt jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='admin_trusted_operator_required';
  end if;
  if p_assignment_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 or v_operator is null
     or char_length(v_operator) not between 8 and 200 then
    raise exception using errcode='22023',message='admin_root_revocation_invalid';
  end if;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','trusted_operator','operator_reference',v_operator,
    'action','admin.root.revoke','assignment_id',p_assignment_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-super-admin-roster',0));
  select * into v_assignment from private.admin_user_roles
    where id=p_assignment_id and role_code='SUPER_ADMIN' for update;
  if not found or v_assignment.revoked_at is not null then
    raise exception using errcode='P0002',message='admin_root_assignment_not_active';
  end if;
  if (select count(*) from private.admin_user_roles
      where role_code='SUPER_ADMIN' and revoked_at is null)<=1 then
    raise exception using errcode='55000',message='admin_last_super_admin';
  end if;
  update private.admin_user_roles set
    revoke_actor_kind='trusted_operator',revoked_by_user_id=null,revoke_operator_reference=v_operator,
    revoked_at=clock_timestamp(),revoke_reason=v_reason,version=version+1
  where id=v_assignment.id returning * into v_assignment;
  v_receipt:=jsonb_build_object('assignment_id',v_assignment.id,'user_id',v_assignment.user_id,
    'role_code','SUPER_ADMIN','version',v_assignment.version,'revoked_at',v_assignment.revoked_at);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,
    target_ref,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(null,'trusted_operator','{}'::text[],null,'admin','admin.root.revoke','user',
    v_assignment.user_id,'SUPER_ADMIN',v_reason,'succeeded',false,true,
    jsonb_build_object('operator_reference',v_operator,'receipt',v_receipt),v_scope,
    p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

revoke all on function public.admin_actor_has_capability(text) from public,anon,authenticated,service_role;
revoke all on function public.admin_require_capability(text) from public,anon,authenticated,service_role;
revoke all on function public.get_my_admin_access() from public,anon,authenticated,service_role;
revoke all on function public.admin_assign_role(uuid,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_revoke_role(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_trusted_provision_super_admin(uuid,text,text,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.admin_trusted_revoke_super_admin(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_actor_has_capability(text) to authenticated;
grant execute on function public.admin_require_capability(text) to authenticated;
grant execute on function public.get_my_admin_access() to authenticated;
grant execute on function public.admin_assign_role(uuid,text,text,uuid) to authenticated;
grant execute on function public.admin_revoke_role(uuid,text,uuid) to authenticated;
grant execute on function public.admin_trusted_provision_super_admin(uuid,text,text,uuid,boolean) to service_role;
grant execute on function public.admin_trusted_revoke_super_admin(uuid,text,text,uuid) to service_role;

-- Rewrite every function that holds a textual dependency on the moved audit table.
do $rewrite_audit_references$
declare v_oid oid;v_definition text;
begin
  for v_oid in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f' and n.nspname='public'
      and p.proname<>'marketplace_reject_admin_action_audit_mutation'
      and pg_get_functiondef(p.oid) ilike '%marketplace_admin_action_audit%'
  loop
    v_definition:=pg_get_functiondef(v_oid);
    v_definition:=replace(v_definition,'public.marketplace_admin_action_audit','private.admin_action_audit');
    v_definition:=replace(v_definition,'marketplace_admin_action_audit','private.admin_action_audit');
    v_definition:=regexp_replace(v_definition,'idempotency_key\s*,\s*reason_code\s*,\s*metadata','idempotency_key,reason,metadata','g');
    v_definition:=replace(v_definition,'.reason_code','.reason');
    v_definition:=replace(v_definition,'v_prior.metadata->>''request_fingerprint''','v_prior.request_fingerprint');
    v_definition:=replace(v_definition,'SET search_path TO ''pg_catalog'', ''public''',
      'SET search_path TO ''pg_catalog'', ''private'', ''public''');
    execute v_definition;
  end loop;
end
$rewrite_audit_references$;

-- Replace the generic Marketplace boolean guard with an exact capability per RPC.
do $rewrite_marketplace_guards$
declare r record;v_oid oid;v_definition text;
begin
  for r in select * from(values
    ('public.get_marketplace_admin_overview(text)','marketplace.overview.read'),
    ('public.search_marketplace_admin_orders(text,text,text,uuid,text,timestamptz,uuid,integer)','marketplace.orders.read'),
    ('public.get_marketplace_admin_order_detail(uuid)','marketplace.orders.read'),
    ('public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer)','marketplace.sellers.read'),
    ('public.get_marketplace_admin_seller_detail(uuid)','marketplace.sellers.read'),
    ('public.admin_moderate_marketplace_seller(uuid,text,text,uuid)','marketplace.sellers.moderate'),
    ('public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer)','marketplace.products.read'),
    ('public.get_marketplace_admin_product_detail(uuid)','marketplace.products.read'),
    ('public.admin_moderate_marketplace_product(uuid,text,text,uuid)','marketplace.products.moderate'),
    ('public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer)','marketplace.disputes.read'),
    ('public.get_marketplace_admin_dispute_detail(uuid)','marketplace.disputes.read'),
    ('public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)','marketplace.disputes.resolve'),
    ('public.get_my_marketplace_admin_dispute_resolution_result(uuid,uuid)','marketplace.disputes.resolve'),
    ('public.search_marketplace_admin_promotions(text,text,timestamptz,uuid,integer)','marketplace.promotions.read'),
    ('public.get_marketplace_admin_promotion_detail(uuid)','marketplace.promotions.read'),
    ('public.search_marketplace_admin_ads(text,text,boolean,timestamptz,uuid,integer)','marketplace.ads.read'),
    ('public.get_marketplace_admin_ad_detail(uuid)','marketplace.ads.read'),
    ('public.get_marketplace_admin_creator_commerce_overview(text)','marketplace.creators.read'),
    ('public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)','marketplace.creators.read'),
    ('public.get_marketplace_admin_creator_detail(uuid,text)','marketplace.creators.read'),
    ('public.get_marketplace_admin_health()','marketplace.health.read'),
    ('public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)','marketplace.audit.read')
  ) as m(signature,capability)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then
      raise exception using errcode='55000',message='a3_marketplace_rpc_missing',detail=r.signature;
    end if;
    v_definition:=pg_get_functiondef(v_oid);
    if position('public.marketplace_require_admin()' in v_definition)=0 then
      raise exception using errcode='55000',message='a3_marketplace_legacy_guard_missing',detail=r.signature;
    end if;
    v_definition:=replace(v_definition,'public.marketplace_require_admin()',
      format('public.admin_require_capability(%L)',r.capability));
    v_definition:=replace(v_definition,'SET search_path TO ''pg_catalog'', ''public''',
      'SET search_path TO ''pg_catalog'', ''private'', ''public''');
    execute v_definition;
  end loop;
end
$rewrite_marketplace_guards$;

create or replace function public.marketplace_actor_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select public.admin_actor_has_capability('marketplace.overview.read');
$$;

create or replace function public.marketplace_require_admin()
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select public.admin_require_capability('marketplace.overview.read');
$$;

create or replace function public.get_my_marketplace_admin_access()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;v_profile record;
begin
  v_actor:=public.admin_require_capability('marketplace.overview.read');
  select id,username,display_name into v_profile from public.public_user_profiles where id=v_actor;
  return jsonb_build_object(
    'user_id',v_profile.id,'username',v_profile.username,'display_name',v_profile.display_name,
    'admin',true,'authority_version',private.admin_authority_version(v_actor),
    'capabilities',jsonb_build_array(
      'marketplace:read','marketplace:disputes','marketplace:sellers','marketplace:products',
      'marketplace:creator-commerce','marketplace:promotions','marketplace:ads',
      'marketplace:health','marketplace:audit'));
end;
$$;

create or replace function public.set_marketplace_seller_status(
  p_user_id uuid,p_status text,p_reason text default null
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    v_actor:=public.admin_require_capability('marketplace.sellers.moderate');
  end if;
  if v_actor is not null and v_actor=p_user_id then
    raise exception using errcode='42501',message='seller_self_moderation_forbidden';
  end if;
  if p_status not in('approved','rejected','suspended') then
    raise exception using errcode='22023',message='invalid_seller_status';
  end if;
  update public.marketplace_sellers
  set status=p_status,
      approved_at=case when p_status='approved' then now() else approved_at end,
      approved_by=case when p_status='approved' then v_actor else approved_by end,
      suspended_at=case when p_status='suspended' then now() else null end,
      suspension_reason=case when p_status in('rejected','suspended')
        then left(nullif(btrim(p_reason),''),500) else null end
  where user_id=p_user_id;
  if not found then raise exception using errcode='P0002',message='seller_not_found';end if;
end;
$$;

create or replace function public.restore_marketplace_seller(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;
begin
  v_actor:=public.admin_require_capability('marketplace.sellers.moderate');
  if v_actor=p_user_id then
    raise exception using errcode='42501',message='seller_self_moderation_forbidden';
  end if;
  update public.marketplace_sellers
  set status='approved',approved_at=coalesce(approved_at,now()),approved_by=v_actor,
      suspended_at=null,suspension_reason=null
  where user_id=p_user_id and status='suspended';
  if not found then raise exception using errcode='P0002',message='suspended_seller_not_found';end if;
  update public.marketplace_stores set status='active'
  where seller_id=p_user_id and status='suspended';
end;
$$;

drop policy marketplace_categories_read_active on public.marketplace_categories;
create policy marketplace_categories_read_active on public.marketplace_categories
for select to anon,authenticated using(status='active');
create policy marketplace_categories_read_admin on public.marketplace_categories
for select to authenticated using(public.admin_actor_has_capability('marketplace.overview.read'));

drop policy marketplace_sellers_read_own_or_admin on public.marketplace_sellers;
create policy marketplace_sellers_read_own_or_admin on public.marketplace_sellers
for select to authenticated using(
  user_id=auth.uid() or public.admin_actor_has_capability('marketplace.sellers.read')
);

-- Remove the unused v1 creator search. The v2 RPC is the sole runtime caller contract.
drop function public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer);

-- Human Marketplace RPCs are authenticated-only. service_role calls private/domain cores.
do $marketplace_grants$
declare v_signature text;v_oid oid;
begin
  foreach v_signature in array array[
    'public.admin_moderate_marketplace_product(uuid,text,text,uuid)',
    'public.admin_moderate_marketplace_seller(uuid,text,text,uuid)',
    'public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)',
    'public.get_marketplace_admin_ad_detail(uuid)',
    'public.get_marketplace_admin_creator_commerce_overview(text)',
    'public.get_marketplace_admin_creator_detail(uuid,text)',
    'public.get_marketplace_admin_dispute_detail(uuid)',
    'public.get_marketplace_admin_health()',
    'public.get_marketplace_admin_order_detail(uuid)',
    'public.get_marketplace_admin_overview(text)',
    'public.get_marketplace_admin_product_detail(uuid)',
    'public.get_marketplace_admin_promotion_detail(uuid)',
    'public.get_marketplace_admin_seller_detail(uuid)',
    'public.get_my_marketplace_admin_access()',
    'public.get_my_marketplace_admin_dispute_resolution_result(uuid,uuid)',
    'public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)',
    'public.search_marketplace_admin_ads(text,text,boolean,timestamptz,uuid,integer)',
    'public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)',
    'public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer)',
    'public.search_marketplace_admin_orders(text,text,text,uuid,text,timestamptz,uuid,integer)',
    'public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer)',
    'public.search_marketplace_admin_promotions(text,text,timestamptz,uuid,integer)',
    'public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer)'
  ] loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null then raise exception using errcode='55000',message='a3_grant_rpc_missing',detail=v_signature;end if;
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_oid::regprocedure);
    execute format('grant execute on function %s to authenticated',v_oid::regprocedure);
  end loop;
end
$marketplace_grants$;

revoke all on function public.marketplace_actor_is_admin() from public,anon,authenticated,service_role;
grant execute on function public.marketplace_actor_is_admin() to authenticated;
revoke all on function public.marketplace_require_admin() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_admin_health_failure_count(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_admin_health_failure_count(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_admin_health_group(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_admin_range_start(text) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_marketplace_admin_operations() from public,anon,authenticated,service_role;

-- Final migration invariants. Any mismatch aborts the whole transaction.
do $postcheck$
declare v_counts record;
begin
  if (select count(*) from private.admin_roles)<>6 then raise exception 'a3_role_count';end if;
  if (select count(*) from private.admin_capabilities)<>47 then raise exception 'a3_capability_count';end if;
  if (select count(*) from private.admin_role_capabilities)<>142 then raise exception 'a3_mapping_count';end if;
  if (select count(*) from private.admin_role_grant_rules)<>7 then raise exception 'a3_grant_rule_count';end if;
  if (select count(*) from private.admin_user_roles where revoked_at is null and role_code='MARKETPLACE_ADMIN')<>1 then
    raise exception 'a3_marketplace_assignment_count';
  end if;
  if exists(select 1 from private.admin_user_roles where revoked_at is null and role_code<>'MARKETPLACE_ADMIN') then
    raise exception 'a3_unexpected_automatic_role';
  end if;
  if exists(select 1 from private.admin_user_roles where revoked_at is null and role_code='SUPER_ADMIN') then
    raise exception 'a3_super_admin_must_not_be_provisioned';
  end if;
  if (select count(*) from private.admin_action_audit)<>7 then raise exception 'a3_audit_count';end if;
  if exists(select 1 from a3_legacy_audit_ids i left join private.admin_action_audit a using(id) where a.id is null) then
    raise exception 'a3_legacy_audit_id_missing';
  end if;
  select * into v_counts from a3_precheck_counts;
  if (select count(*) from public.ledger_accounts)<>v_counts.ledger_accounts
     or(select count(*) from public.financial_transactions)<>v_counts.financial_transactions
     or(select count(*) from public.ledger_entries)<>v_counts.ledger_entries then
    raise exception 'a3_financial_counts_changed';
  end if;
  if to_regclass('public.marketplace_admin_action_audit') is not null then
    raise exception 'a3_parallel_audit_remaining';
  end if;
end
$postcheck$;

comment on table private.admin_roles is 'Canonical closed human application-admin role catalog.';
comment on table private.admin_capabilities is 'Canonical closed server-enforced admin capability catalog.';
comment on table private.admin_user_roles is 'Canonical human admin role assignments with explicit immutable provenance and revocation.';
comment on table private.admin_action_audit is 'Single immutable global admin command/audit history evolved from Marketplace audit.';

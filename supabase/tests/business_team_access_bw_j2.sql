begin;

create or replace function pg_temp.j2_actor(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
end;
$$;

create or replace function pg_temp.j2_assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'j2_assertion_failed: %', p_message; end if;
end;
$$;

create or replace function pg_temp.j2_expect_error(p_action text, p_payload jsonb, p_message text)
returns void language plpgsql as $$
begin
  perform public.manage_business_team(p_action, p_payload);
  raise exception 'j2_expected_error_missing: %', p_message;
exception when others then
  if sqlerrm like 'j2_expected_error_missing:%' then raise; end if;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  ('b2020000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@j2.test', '', now(), now(), now()),
  ('b2020000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@j2.test', '', now(), now(), now()),
  ('b2020000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@j2.test', '', now(), now(), now()),
  ('b2020000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reader@j2.test', '', now(), now(), now()),
  ('b2020000-0000-4000-8000-000000000105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'target@j2.test', '', now(), now(), now()),
  ('b2020000-0000-4000-8000-000000000106', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager-two@j2.test', '', now(), now(), now()),
  ('b2020000-0000-4000-8000-000000000107', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wrong@j2.test', '', now(), now(), now()),
  ('b2020000-0000-4000-8000-000000000108', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'decline@j2.test', '', now(), now(), now());

insert into public.user_profiles (id, username, display_name) values
  ('b2020000-0000-4000-8000-000000000101', 'j2_owner_a', 'Owner A'),
  ('b2020000-0000-4000-8000-000000000102', 'j2_owner_b', 'Owner B'),
  ('b2020000-0000-4000-8000-000000000103', 'j2_manager', 'Manager'),
  ('b2020000-0000-4000-8000-000000000104', 'j2_reader', 'Reader'),
  ('b2020000-0000-4000-8000-000000000105', 'j2_target', 'Target'),
  ('b2020000-0000-4000-8000-000000000106', 'j2_manager_two', 'Manager Two'),
  ('b2020000-0000-4000-8000-000000000107', 'j2_wrong', 'Wrong Email'),
  ('b2020000-0000-4000-8000-000000000108', 'j2_decline', 'Decline');

insert into public.marketplace_sellers (user_id, status, display_name, approved_at) values
  ('b2020000-0000-4000-8000-000000000101', 'approved', 'Business A', now()),
  ('b2020000-0000-4000-8000-000000000102', 'approved', 'Business B', now());

insert into private.business_memberships (id, business_owner_id, member_user_id, status, created_by) values
  ('b2020000-0000-4000-8000-000000000201', 'b2020000-0000-4000-8000-000000000101', 'b2020000-0000-4000-8000-000000000103', 'active', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000202', 'b2020000-0000-4000-8000-000000000101', 'b2020000-0000-4000-8000-000000000104', 'active', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000203', 'b2020000-0000-4000-8000-000000000101', 'b2020000-0000-4000-8000-000000000106', 'active', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000204', 'b2020000-0000-4000-8000-000000000102', 'b2020000-0000-4000-8000-000000000107', 'active', 'b2020000-0000-4000-8000-000000000102');

insert into private.business_membership_capabilities (membership_id, capability_code, granted_by) values
  ('b2020000-0000-4000-8000-000000000201', 'business.team.manage', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000201', 'business.home.read', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000201', 'business.ads.read', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000202', 'business.team.read', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000203', 'business.team.manage', 'b2020000-0000-4000-8000-000000000101'),
  ('b2020000-0000-4000-8000-000000000204', 'business.home.read', 'b2020000-0000-4000-8000-000000000102');

select pg_temp.j2_assert(has_function_privilege('authenticated', 'public.get_my_business_team(uuid)', 'execute'), 'team read grant');
select pg_temp.j2_assert(has_function_privilege('authenticated', 'public.manage_business_team(text,jsonb)', 'execute'), 'command grant');
select pg_temp.j2_assert(not has_table_privilege('authenticated', 'private.business_invitations', 'select'), 'no direct invitation select');
create temporary table j2_receipts (key text primary key, id uuid not null);

-- Owner sees the full active catalog and can grant protected capabilities.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
select pg_temp.j2_assert(
  jsonb_array_length(public.get_my_business_team('b2020000-0000-4000-8000-000000000101')->'capability_catalog') =
    (select count(*) from private.business_capability_catalog where active),
  'owner full catalog'
);

-- Reader lists but cannot mutate.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000104');
select pg_temp.j2_assert(public.get_my_business_team('b2020000-0000-4000-8000-000000000101')->'actor'->>'can_manage' = 'false', 'reader read only');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'reader-invite@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
), 'reader mutation denied');

-- Delegated manager may delegate only capabilities held and never protected capabilities.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000103');
select pg_temp.j2_assert(public.get_my_business_team('b2020000-0000-4000-8000-000000000101')->'actor'->>'can_manage' = 'true', 'manager read implication');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'protected@j2.test',
  'capability_codes', jsonb_build_array('business.finance.read')
), 'protected grant denied');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'unowned@j2.test',
  'capability_codes', jsonb_build_array('business.catalog.manage')
), 'unowned grant denied');
select pg_temp.j2_expect_error('set_member_capabilities', jsonb_build_object(
  'membership_id', 'b2020000-0000-4000-8000-000000000201',
  'capability_codes', jsonb_build_array('business.home.read')
), 'self management denied');
select pg_temp.j2_expect_error('revoke_member', jsonb_build_object(
  'membership_id', 'b2020000-0000-4000-8000-000000000203'
), 'manager to manager denied');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'manager@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
), 'manager self invite denied');
select public.manage_business_team('set_member_capabilities', jsonb_build_object(
  'membership_id', 'b2020000-0000-4000-8000-000000000202',
  'capability_codes', jsonb_build_array('business.home.read')
));

-- Cross-business UUID knowledge never grants access.
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000102', 'email', 'cross@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
), 'cross business invite denied');
select pg_temp.j2_expect_error('set_member_capabilities', jsonb_build_object(
  'membership_id', 'b2020000-0000-4000-8000-000000000204',
  'capability_codes', jsonb_build_array('business.home.read')
), 'cross business capability update denied');
select pg_temp.j2_expect_error('revoke_member', jsonb_build_object(
  'membership_id', 'b2020000-0000-4000-8000-000000000204'
), 'cross business member revoke denied');
do $$ begin
  perform public.get_my_business_team('b2020000-0000-4000-8000-000000000102');
  raise exception 'j2_cross_business_read_unexpected';
exception when insufficient_privilege then null; end $$;

-- Owner invitation validation and atomic acceptance.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'owner-a@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
), 'owner invite denied');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'reader@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
), 'active member denied');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'empty@j2.test',
  'capability_codes', '[]'::jsonb
), 'empty set denied');
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'unknown@j2.test',
  'capability_codes', jsonb_build_array('business.unknown.read')
), 'unknown capability denied');
update private.business_capability_catalog set active=false where code='business.store.manage';
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'inactive@j2.test',
  'capability_codes', jsonb_build_array('business.store.manage')
), 'inactive capability denied');
update private.business_capability_catalog set active=true where code='business.store.manage';

-- Duplicate pending protection and cross-business invitation isolation.
select public.manage_business_team('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'duplicate@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
));
select pg_temp.j2_expect_error('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'duplicate@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
), 'duplicate pending denied');
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000102');
insert into j2_receipts
select 'foreign_invite', (public.manage_business_team('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000102', 'email', 'outside@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
))->'invitation'->>'id')::uuid;
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000103');
select pg_temp.j2_expect_error('revoke_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='foreign_invite')), 'cross business invitation revoke denied');

select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
insert into j2_receipts
select 'target_invite', (public.manage_business_team('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', ' TARGET@J2.TEST ',
  'capability_codes', jsonb_build_array('business.home.read', 'business.finance.read')
))->'invitation'->>'id')::uuid;
select pg_temp.j2_assert((select invited_email_normalized = 'target@j2.test' from private.business_invitations where id=(select id from j2_receipts where key='target_invite')), 'email normalized');

select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000107');
select pg_temp.j2_expect_error('accept_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='target_invite')), 'wrong email denied');

select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000105');
select public.manage_business_team('accept_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='target_invite')));
select public.manage_business_team('accept_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='target_invite')));
insert into j2_receipts
select 'target_membership', id from private.business_memberships
where business_owner_id='b2020000-0000-4000-8000-000000000101' and member_user_id='b2020000-0000-4000-8000-000000000105';
select pg_temp.j2_assert((select count(*)=1 from private.business_memberships where business_owner_id='b2020000-0000-4000-8000-000000000101' and member_user_id='b2020000-0000-4000-8000-000000000105'), 'accept idempotent membership');
select pg_temp.j2_assert((select count(*)=2 from private.business_membership_capabilities where membership_id=(select id from j2_receipts where key='target_membership')), 'accept snapshot exact');

-- Owner can update protected grants, then revocation removes effective access immediately.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
select public.manage_business_team('set_member_capabilities', jsonb_build_object(
  'membership_id', (select id from j2_receipts where key='target_membership'),
  'capability_codes', jsonb_build_array('business.home.read', 'business.payouts.manage')
));
select public.manage_business_team('revoke_member', jsonb_build_object('membership_id', (select id from j2_receipts where key='target_membership')));
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000105');
select pg_temp.j2_assert(not exists(select 1 from private.business_effective_capabilities('b2020000-0000-4000-8000-000000000101')), 'revoked effective capabilities empty');
select pg_temp.j2_assert(not exists(
  select 1 from jsonb_array_elements(public.get_my_business_access()->'businesses') as business(value)
  where business.value->>'business_owner_id'='b2020000-0000-4000-8000-000000000101'
), 'revoked business removed from access');

-- A new invite reuses the canonical membership row and replaces the capability set.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
insert into j2_receipts
select 'reactivate_invite', (public.manage_business_team('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'target@j2.test',
  'capability_codes', jsonb_build_array('business.ads.read')
))->'invitation'->>'id')::uuid;
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000105');
select public.manage_business_team('accept_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='reactivate_invite')));
select pg_temp.j2_assert((select status='active' from private.business_memberships where id=(select id from j2_receipts where key='target_membership')), 'membership reactivated');
select pg_temp.j2_assert((select array_agg(capability_code order by capability_code)=array['business.ads.read']::text[] from private.business_membership_capabilities where membership_id=(select id from j2_receipts where key='target_membership')), 'reactivation replaces capabilities');

-- Decline and revoked/expired acceptance are terminal and email-scoped.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
insert into j2_receipts
select 'decline_invite', (public.manage_business_team('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'decline@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
))->'invitation'->>'id')::uuid;
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000108');
select public.manage_business_team('decline_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='decline_invite')));
select pg_temp.j2_assert((select status='declined' from private.business_invitations where id=(select id from j2_receipts where key='decline_invite')), 'decline persisted');
select pg_temp.j2_expect_error('accept_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='decline_invite')), 'declined accept denied');

-- Expired and explicitly revoked invitations cannot be accepted.
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
insert into j2_receipts
select 'expired_invite', (public.manage_business_team('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'wrong@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
))->'invitation'->>'id')::uuid;
update private.business_invitations set created_at=now()-interval '8 days', expires_at=now()-interval '1 day'
where id=(select id from j2_receipts where key='expired_invite');
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000107');
select pg_temp.j2_expect_error('accept_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='expired_invite')), 'expired accept denied');
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000101');
insert into j2_receipts
select 'revoked_invite', (public.manage_business_team('create_invitation', jsonb_build_object(
  'business_owner_id', 'b2020000-0000-4000-8000-000000000101', 'email', 'wrong@j2.test',
  'capability_codes', jsonb_build_array('business.home.read')
))->'invitation'->>'id')::uuid;
select public.manage_business_team('revoke_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='revoked_invite')));
select pg_temp.j2_actor('b2020000-0000-4000-8000-000000000107');
select pg_temp.j2_expect_error('accept_invitation', jsonb_build_object('invitation_id', (select id from j2_receipts where key='revoked_invite')), 'revoked accept denied');

select pg_temp.j2_assert((select count(*) >= 6 from private.business_team_audit_events where business_owner_id='b2020000-0000-4000-8000-000000000101'), 'audit lifecycle recorded');

-- The browser role reaches only the granted SECURITY DEFINER contract.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
select pg_catalog.set_config('request.jwt.claim.sub', 'b2020000-0000-4000-8000-000000000101', true);
select public.get_my_business_team('b2020000-0000-4000-8000-000000000101')->'actor'->>'is_owner' as authenticated_owner_rpc;
reset role;

rollback;

-- Schema-only production clones do not contain seed rows. PLR-9 capability
-- grants depend on these canonical production roles, so restore only their
-- identity/shape before compiling the migration.
insert into private.admin_roles(
  role_code,display_name,description,is_assignable,is_root,is_exclusive
) values
  ('SUPER_ADMIN','Super Admin','Root platform administration.',false,true,true),
  ('PLATFORM_ADMIN','Platform Admin','Broad platform operations.',true,false,false),
  ('FINANCE_AUDITOR','Finance Auditor','Read-only finance audit.',true,false,false)
on conflict(role_code) do nothing;

insert into private.admin_capabilities(
  capability_code, domain, effect, description, is_sensitive
) values
  ('finance.audit.read','finance','read','Read financial audit trail.',true),
  ('finance.reconciliation.read','finance','read','Read financial reconciliation detail.',true)
on conflict(capability_code) do nothing;

insert into private.admin_role_capabilities(role_code,capability_code) values
  ('SUPER_ADMIN','finance.audit.read'),
  ('SUPER_ADMIN','finance.reconciliation.read'),
  ('FINANCE_AUDITOR','finance.audit.read'),
  ('FINANCE_AUDITOR','finance.reconciliation.read')
on conflict(role_code,capability_code) do nothing;

-- Disposable actors exercise the canonical capability matrix and immutable
-- admin audit without provisioning any production assignment.
-- Schema-only clones omit the age-policy seed rows used by the auth.users
-- materialization trigger, so bypass triggers only while installing fixtures.
set session_replication_role = replica;

insert into auth.users(id) values
  ('11000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000002'),
  ('11000000-0000-4000-8000-000000000003');

insert into public.user_profiles(id) values
  ('11000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000002'),
  ('11000000-0000-4000-8000-000000000003');

insert into private.admin_user_roles(
  user_id, role_code, grant_actor_kind, grant_operator_reference, grant_reason
) values
  ('11000000-0000-4000-8000-000000000001','SUPER_ADMIN','trusted_operator','plr9-disposable-fixture','Disposable PLR-9 capability proof'),
  ('11000000-0000-4000-8000-000000000002','PLATFORM_ADMIN','trusted_operator','plr9-disposable-fixture','Disposable PLR-9 capability proof'),
  ('11000000-0000-4000-8000-000000000003','FINANCE_AUDITOR','trusted_operator','plr9-disposable-fixture','Disposable PLR-9 capability proof');

set session_replication_role = origin;

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260911162054_superuser_a3_canonical_authority_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const authorityClosure = readFileSync(
  new URL(
    "../supabase/migrations/20260911162354_superuser_a3_marketplace_internal_authority_closure.sql",
    import.meta.url,
  ),
  "utf8",
);
const auditScopeClosure = readFileSync(
  new URL(
    "../supabase/migrations/20260911162623_superuser_a3_audit_scope_policy_closure.sql",
    import.meta.url,
  ),
  "utf8",
);

const roles = [
  ["SUPER_ADMIN", false, true, true],
  ["PLATFORM_ADMIN", true, false, true],
  ["MODERATOR", true, false, false],
  ["SUPPORT", true, false, false],
  ["MARKETPLACE_ADMIN", true, false, true],
  ["FINANCE_AUDITOR", true, false, true],
];

const capabilities = [
  "admin.shell.access",
  "admin.roles.read",
  "admin.roles.assign",
  "admin.roles.revoke",
  "admin.audit.read",
  "users.accounts.read",
  "users.accounts.moderate",
  "users.accounts.suspend",
  "users.accounts.restore",
  "reports.cases.read",
  "reports.cases.review",
  "reports.cases.resolve",
  "content.items.read",
  "content.items.moderate",
  "content.items.hide",
  "content.items.restore",
  "stories.items.read",
  "stories.items.moderate",
  "chat.abuse_reports.read",
  "chat.abuse_reports.moderate",
  "live.sessions.read",
  "live.sessions.moderate",
  "live.sessions.terminate",
  "battles.sessions.read",
  "battles.sessions.moderate",
  "marketplace.overview.read",
  "marketplace.orders.read",
  "marketplace.sellers.read",
  "marketplace.sellers.moderate",
  "marketplace.products.read",
  "marketplace.products.moderate",
  "marketplace.disputes.read",
  "marketplace.disputes.resolve",
  "marketplace.promotions.read",
  "marketplace.ads.read",
  "marketplace.creators.read",
  "marketplace.health.read",
  "marketplace.audit.read",
  "finance.ledger.read",
  "finance.reconciliation.read",
  "finance.anomalies.read",
  "finance.audit.read",
  "system.health.read",
  "system.jobs.read",
  "system.audit.read",
  "media.assets.read",
  "media.assets.moderate",
];

const explicitMappings = {
  MODERATOR: [
    "admin.shell.access",
    "users.accounts.read",
    "users.accounts.moderate",
    "users.accounts.suspend",
    "users.accounts.restore",
    "reports.cases.read",
    "reports.cases.review",
    "reports.cases.resolve",
    "content.items.read",
    "content.items.moderate",
    "content.items.hide",
    "content.items.restore",
    "stories.items.read",
    "stories.items.moderate",
    "chat.abuse_reports.read",
    "chat.abuse_reports.moderate",
    "live.sessions.read",
    "live.sessions.moderate",
    "live.sessions.terminate",
    "battles.sessions.read",
    "battles.sessions.moderate",
    "media.assets.read",
    "media.assets.moderate",
  ],
  SUPPORT: [
    "admin.shell.access",
    "users.accounts.read",
    "reports.cases.read",
    "reports.cases.review",
    "marketplace.orders.read",
    "marketplace.disputes.read",
  ],
  MARKETPLACE_ADMIN: [
    "admin.shell.access",
    "marketplace.overview.read",
    "marketplace.orders.read",
    "marketplace.sellers.read",
    "marketplace.sellers.moderate",
    "marketplace.products.read",
    "marketplace.products.moderate",
    "marketplace.disputes.read",
    "marketplace.disputes.resolve",
    "marketplace.promotions.read",
    "marketplace.ads.read",
    "marketplace.creators.read",
    "marketplace.health.read",
    "marketplace.audit.read",
  ],
  FINANCE_AUDITOR: [
    "admin.shell.access",
    "marketplace.orders.read",
    "marketplace.disputes.read",
    "marketplace.health.read",
    "marketplace.audit.read",
    "finance.ledger.read",
    "finance.reconciliation.read",
    "finance.anomalies.read",
    "finance.audit.read",
    "system.health.read",
  ],
};

const marketplaceCapabilities = new Map([
  ["public.get_marketplace_admin_overview(text)", "marketplace.overview.read"],
  ["public.search_marketplace_admin_orders(text,text,text,uuid,text,timestamptz,uuid,integer)", "marketplace.orders.read"],
  ["public.get_marketplace_admin_order_detail(uuid)", "marketplace.orders.read"],
  ["public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer)", "marketplace.sellers.read"],
  ["public.get_marketplace_admin_seller_detail(uuid)", "marketplace.sellers.read"],
  ["public.admin_moderate_marketplace_seller(uuid,text,text,uuid)", "marketplace.sellers.moderate"],
  ["public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer)", "marketplace.products.read"],
  ["public.get_marketplace_admin_product_detail(uuid)", "marketplace.products.read"],
  ["public.admin_moderate_marketplace_product(uuid,text,text,uuid)", "marketplace.products.moderate"],
  ["public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer)", "marketplace.disputes.read"],
  ["public.get_marketplace_admin_dispute_detail(uuid)", "marketplace.disputes.read"],
  ["public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)", "marketplace.disputes.resolve"],
  ["public.get_my_marketplace_admin_dispute_resolution_result(uuid,uuid)", "marketplace.disputes.resolve"],
  ["public.search_marketplace_admin_promotions(text,text,timestamptz,uuid,integer)", "marketplace.promotions.read"],
  ["public.get_marketplace_admin_promotion_detail(uuid)", "marketplace.promotions.read"],
  ["public.search_marketplace_admin_ads(text,text,boolean,timestamptz,uuid,integer)", "marketplace.ads.read"],
  ["public.get_marketplace_admin_ad_detail(uuid)", "marketplace.ads.read"],
  ["public.get_marketplace_admin_creator_commerce_overview(text)", "marketplace.creators.read"],
  ["public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)", "marketplace.creators.read"],
  ["public.get_marketplace_admin_creator_detail(uuid,text)", "marketplace.creators.read"],
  ["public.get_marketplace_admin_health()", "marketplace.health.read"],
  ["public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)", "marketplace.audit.read"],
]);

function between(start, end) {
  const from = migration.indexOf(start);
  const to = migration.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing section: ${start}`);
  assert.notEqual(to, -1, `missing boundary: ${end}`);
  return migration.slice(from, to);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("A3 creates the exact closed catalog of six roles and 47 capabilities", () => {
  const roleInsert = between(
    "insert into private.admin_roles",
    "insert into private.admin_capabilities",
  );
  for (const [role, assignable, root, exclusive] of roles) {
    assert.match(
      roleInsert,
      new RegExp(`\\('${role}'[^\\n]*,${assignable},${root},${exclusive}\\)`),
    );
  }
  assert.equal((roleInsert.match(/^\('/gm) ?? []).length, 6);

  const capabilityInsert = between(
    "insert into private.admin_capabilities",
    "insert into private.admin_role_capabilities",
  );
  const actual = [...capabilityInsert.matchAll(/^\('([^']+)'/gm)].map((match) => match[1]);
  assert.equal(actual.length, 47);
  assert.deepEqual(actual, capabilities);
  assert.equal(new Set(actual).size, 47);
});

test("A3 installs the exact 47/42/23/6/14/10 role mapping and seven grant rules", () => {
  assert.match(migration, /select 'SUPER_ADMIN',capability_code from private\.admin_capabilities/);
  assert.match(migration, /select 'PLATFORM_ADMIN',capability_code from private\.admin_capabilities[\s\S]*?not in\([\s\S]*?'marketplace\.disputes\.resolve'[\s\S]*?'finance\.audit\.read'\)/);
  assert.equal(capabilities.length - 5, 42);

  const mappingInsert = between(
    "insert into private.admin_role_capabilities(role_code,capability_code) values",
    "insert into private.admin_role_grant_rules",
  );
  for (const [role, expected] of Object.entries(explicitMappings)) {
    const actual = [...mappingInsert.matchAll(new RegExp(`\\('${role}','([^']+)'\\)`, "g"))]
      .map((match) => match[1]);
    assert.deepEqual(actual, expected);
  }
  assert.equal(47 + 42 + 23 + 6 + 14 + 10, 142);

  const rules = between(
    "insert into private.admin_role_grant_rules",
    "alter table private.admin_roles enable row level security",
  );
  assert.equal((rules.match(/^\('/gm) ?? []).length, 7);
  assert.doesNotMatch(rules, /,'SUPER_ADMIN',/);
});

test("admin assignment provenance is exact and role rows are revoke-only", () => {
  const table = between(
    "create table private.admin_user_roles",
    "create unique index admin_user_roles_active_uidx",
  );
  assert.match(table, /grant_actor_kind in\('human_admin','trusted_operator'\)/);
  assert.match(table, /grant_actor_kind='human_admin'[\s\S]*?granted_by_user_id is not null[\s\S]*?grant_operator_reference is null/);
  assert.match(table, /grant_actor_kind='trusted_operator'[\s\S]*?granted_by_user_id is null[\s\S]*?grant_operator_reference is not null/);
  assert.match(table, /revoked_at is null[\s\S]*?revoke_actor_kind is null[\s\S]*?revoked_by_user_id is null/);
  assert.match(table, /revoked_at is not null and revoke_actor_kind='human_admin'[\s\S]*?revoked_by_user_id is not null/);
  assert.match(table, /revoked_at is not null and revoke_actor_kind='trusted_operator'[\s\S]*?revoked_by_user_id is null/);
  assert.match(migration, /admin_user_roles_delete_forbidden/);
  assert.match(migration, /new\.version<>old\.version\+1/);
});

test("only MODERATOR plus SUPPORT can compose and invalid sets fail closed", () => {
  const validator = between(
    "create function private.admin_role_set_is_valid",
    "create function private.admin_effective_capabilities",
  );
  assert.match(validator, /cardinality\(roles\)<=1 or roles=array\['MODERATOR','SUPPORT'\]::text\[\]/);
  assert.match(migration, /admin_role_set_invalid/);
  assert.match(migration, /admin_role_combination_forbidden/);
  assert.match(migration, /return '\{\}'::text\[\]/);
});

test("capability helpers derive the actor from auth and never grant service-role authority", () => {
  const predicate = between(
    "create function public.admin_actor_has_capability",
    "create function public.admin_require_capability",
  );
  const requireCapability = between(
    "create function public.admin_require_capability",
    "create function public.get_my_admin_access",
  );
  assert.match(predicate, /v_actor uuid:=auth\.uid\(\)/);
  assert.match(predicate, /if v_actor is null or p_capability is null then return false/);
  assert.match(predicate, /private\.admin_effective_capabilities\(v_actor\)/);
  assert.doesNotMatch(predicate, /service_role/);
  assert.match(requireCapability, /errcode='28000',message='admin_auth_required'/);
  assert.match(requireCapability, /errcode='22023',message='admin_capability_invalid'/);
  assert.match(requireCapability, /errcode='42501',message='admin_role_set_invalid'/);
  assert.match(requireCapability, /errcode='42501',message='admin_capability_forbidden'/);
  assert.doesNotMatch(requireCapability, /service_role/);
});

test("authority_version hashes ordered active assignment id, role, and version", () => {
  const version = between(
    "create function private.admin_authority_version",
    "create function private.admin_request_fingerprint",
  );
  assert.match(version, /id::text\|\|':'\|\|role_code\|\|':'\|\|version::text/);
  assert.match(version, /order by role_code,id/);
  assert.match(version, /where user_id=p_user_id and revoked_at is null/);
  assert.match(version, /extensions\.digest/);
});

test("human role assignment and revocation enforce hierarchy, locking, provenance, and idempotency", () => {
  const assign = between(
    "create function public.admin_assign_role",
    "create function public.admin_revoke_role",
  );
  const revoke = between(
    "create function public.admin_revoke_role",
    "create function public.admin_trusted_provision_super_admin",
  );
  assert.match(assign, /admin_require_capability\('admin\.roles\.assign'\)/);
  assert.match(assign, /v_actor=p_user_id/);
  assert.match(assign, /not v_role\.is_assignable or v_role\.is_root/);
  assert.match(assign, /admin_role_grant_rules/);
  assert.match(assign, /pg_advisory_xact_lock/);
  assert.match(assign, /forbidden|admin_role_combination_forbidden/);
  assert.match(assign, /'human_admin',v_actor,null,v_reason/);
  assert.match(revoke, /admin_require_capability\('admin\.roles\.revoke'\)/);
  assert.match(revoke, /for update/);
  assert.match(revoke, /admin_self_revocation_forbidden/);
  assert.match(revoke, /version=version\+1/);
  for (const body of [assign, revoke]) {
    assert.match(body, /request_fingerprint<>v_fingerprint/);
    assert.match(body, /errcode='23505',message='admin_idempotency_conflict'/);
    assert.match(body, /return v_prior\.metadata->'receipt'/);
  }
});

test("trusted root workflows are service-only, exclusive, atomic, and never invoked by A3", () => {
  const root = between(
    "create function public.admin_trusted_provision_super_admin",
    "revoke all on function public.admin_actor_has_capability",
  );
  assert.match(root, /request\.jwt\.claim\.role[\s\S]*?<>'service_role'/);
  assert.match(root, /admin-super-admin-roster/);
  assert.match(root, /admin_root_requires_atomic_role_replacement/);
  assert.match(root, /admin_last_super_admin/);
  assert.match(root, /'SUPER_ADMIN','trusted_operator',null,v_operator/);
  assert.match(migration, /grant execute on function public\.admin_trusted_provision_super_admin[^\n]*to service_role/);
  assert.match(migration, /grant execute on function public\.admin_trusted_revoke_super_admin[^\n]*to service_role/);
  assert.doesNotMatch(migration, /(?:select|perform|call)\s+public\.admin_trusted_(?:provision|revoke)_super_admin/i);
  assert.match(migration, /a3_super_admin_must_not_be_provisioned/);
});

test("legacy Marketplace admin migrates only to MARKETPLACE_ADMIN with trusted provenance", () => {
  const legacy = between("do $legacy$", "$legacy$;");
  assert.match(legacy, /from public\.user_profiles where is_admin=true/);
  assert.match(legacy, /'MARKETPLACE_ADMIN','trusted_operator',null/);
  assert.match(legacy, /migration:20260911160134:legacy_is_admin/);
  assert.match(legacy, /admin\.role\.legacy_migrate/);
  for (const forbidden of ["SUPER_ADMIN", "PLATFORM_ADMIN", "MODERATOR", "SUPPORT", "FINANCE_AUDITOR"]) {
    assert.doesNotMatch(legacy, new RegExp(`'${forbidden}'`));
  }
});

test("the Marketplace audit table evolves in place and all six historical rows are mapped", () => {
  assert.match(migration, /alter table public\.marketplace_admin_action_audit set schema private/);
  assert.match(migration, /alter table private\.marketplace_admin_action_audit rename to admin_action_audit/);
  assert.doesNotMatch(migration, /create table private\.admin_action_audit/);
  assert.match(migration, /actor_role_snapshot=array\['LEGACY_MARKETPLACE_ADMIN'\]/);
  assert.match(migration, /when action like 'seller_%' then 'marketplace\.sellers\.moderate'/);
  assert.match(migration, /when action like 'dispute_%' then 'marketplace\.disputes\.resolve'/);
  assert.match(migration, /financial_effect=action like 'dispute_%'/);
  assert.match(migration, /request_fingerprint=metadata->>'request_fingerprint'/);
  assert.match(migration, /a3_legacy_audit_id_missing/);
  assert.match(migration, /a3_parallel_audit_remaining/);
});

test("global audit is private, append-only, runtime closed, and transaction-coupled", () => {
  assert.match(migration, /revoke all on schema private from public,anon,authenticated,service_role/);
  assert.match(migration, /alter table private\.admin_action_audit enable row level security/);
  assert.match(migration, /revoke all privileges on table private\.admin_action_audit from public,anon,authenticated,service_role/);
  assert.match(migration, /before update or delete on private\.admin_action_audit/);
  assert.match(migration, /admin_action_audit_immutable/);
  assert.match(migration, /admin_action_audit_actor_contract_check/);
  assert.match(migration, /actor_kind in\('human_admin','trusted_operator','system_workflow'\)/);
  assert.match(migration, /outcome in\('succeeded','no_op','denied','failed'\)/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|truncate)[^;]*private\.admin_action_audit/i);
});

test("idempotency uses a server-derived scope, canonical jsonb SHA-256, and conflict detection", () => {
  const fingerprint = between(
    "create function private.admin_request_fingerprint",
    "create function private.admin_guard_user_role_mutation",
  );
  assert.match(fingerprint, /coalesce\(p_payload,'\{\}'::jsonb\)::text/);
  assert.match(fingerprint, /extensions\.digest/);
  assert.match(migration, /idempotency_scope,idempotency_key/);
  assert.match(migration, /request_fingerprint<>v_fingerprint/);
  assert.match(migration, /errcode='23505',message='admin_idempotency_conflict'/);
  assert.doesNotMatch(migration, /p_idempotency_scope/);
});

test("all 22 Marketplace admin RPCs receive their exact capability and authenticated-only grant", () => {
  const guards = between("do $rewrite_marketplace_guards$", "$rewrite_marketplace_guards$;");
  for (const [signature, capability] of marketplaceCapabilities) {
    assert.match(
      guards,
      new RegExp(`\\('${escapeRegExp(signature)}','${escapeRegExp(capability)}'\\)`),
    );
  }
  assert.equal((guards.match(/^\s*\('public\./gm) ?? []).length, 22);

  const grants = between("do $marketplace_grants$", "$marketplace_grants$;");
  assert.match(grants, /from public,anon,authenticated,service_role/);
  assert.match(grants, /grant execute on function %s to authenticated/);
  assert.equal((grants.match(/^\s*'public\./gm) ?? []).length, 23);
});

test("Marketplace compatibility adapters use canonical capabilities, never is_admin or service-role shortcuts", () => {
  const adapters = between(
    "create or replace function public.marketplace_actor_is_admin",
    "create or replace function public.set_marketplace_seller_status",
  );
  assert.match(adapters, /admin_actor_has_capability\('marketplace\.overview\.read'\)/);
  assert.match(adapters, /admin_require_capability\('marketplace\.overview\.read'\)/);
  assert.match(adapters, /get_my_marketplace_admin_access/);
  assert.doesNotMatch(adapters, /user_profiles\.is_admin|request\.jwt\.claim\.role|service_role/);
  assert.match(migration, /revoke all on function public\.marketplace_require_admin\(\) from public,anon,authenticated,service_role/);
  assert.match(migration, /grant execute on function public\.marketplace_actor_is_admin\(\) to authenticated/);
});

test("service-only Marketplace cores bind the resolver and recheck canonical dispute capability", () => {
  for (const signature of [
    "public.fetch_support_marketplace_dispute(uuid,uuid)",
    "public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid)",
    "public.release_marketplace_order_after_dispute_resolution(uuid,uuid,uuid,uuid)",
    "public.resolve_marketplace_dispute_held_v1(uuid,uuid,text,text,text,uuid,numeric)",
    "public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)",
    "public.reverse_marketplace_released_settlement(uuid,uuid,text,text,uuid)",
  ]) {
    assert.ok(authorityClosure.includes(`'${signature}'`), `missing internal core ${signature}`);
  }
  assert.match(authorityClosure, /p_resolver_id is distinct from auth\.uid\(\)/);
  assert.match(authorityClosure, /admin_actor_has_capability\(''marketplace\.disputes\.resolve''\)/);
  assert.match(authorityClosure, /a3_marketplace_internal_authority_postcheck_failed/);
  assert.doesNotMatch(authorityClosure, /(?:insert into|update|delete from|truncate)\s+public\.(?:ledger_accounts|financial_transactions|ledger_entries)\b/i);
});

test("Marketplace audit reads stay domain-scoped and category policies remain one-per-role", () => {
  assert.match(auditScopeClosure, /a\.domain=''marketplace''/);
  assert.match(auditScopeClosure, /admin_require_capability\(''marketplace\.audit\.read''\)/);
  assert.match(auditScopeClosure, /create policy marketplace_categories_read_active[\s\S]*?to anon/);
  assert.match(auditScopeClosure, /create policy marketplace_categories_read_authenticated[\s\S]*?to authenticated/);
  assert.match(auditScopeClosure, /status='active' or public\.admin_actor_has_capability\('marketplace\.overview\.read'\)/);
  assert.doesNotMatch(auditScopeClosure, /to anon,authenticated/);
});

test("A3 preserves the financial core and performs no financial DML", () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from|truncate)\s+public\.(?:ledger_accounts|financial_transactions|ledger_entries)\b/i);
  assert.doesNotMatch(migration, /create table (?:public\.)?(?:ledger|wallet|escrow)/i);
  assert.match(migration, /a3_financial_counts_changed/);
  assert.match(migration, /admin_resolve_marketplace_dispute[^\n]*marketplace\.disputes\.resolve/);
});

test("A3 contains atomic deployment guards for exact production baseline and final counts", () => {
  assert.match(migration, /a3_legacy_admin_count_changed/);
  assert.match(migration, /a3_legacy_audit_count_changed/);
  assert.match(migration, /a3_canonical_authority_already_exists/);
  assert.match(migration, /count\(\*\) from private\.admin_roles\)<>6/);
  assert.match(migration, /count\(\*\) from private\.admin_capabilities\)<>47/);
  assert.match(migration, /count\(\*\) from private\.admin_role_capabilities\)<>142/);
  assert.match(migration, /count\(\*\) from private\.admin_role_grant_rules\)<>7/);
  assert.match(migration, /count\(\*\) from private\.admin_action_audit\)<>7/);
});

test("all A3 SECURITY DEFINER functions fix search_path and direct grants are least privilege", () => {
  const functionBlocks = migration.split(/(?=create (?:or replace )?function )/i).slice(1);
  for (const block of functionBlocks) {
    const header = block.split("as $$", 1)[0];
    if (/security definer/i.test(header)) {
      assert.match(header, /set search_path to 'pg_catalog'(?:,'private')?,'public'/i);
    }
  }
  assert.doesNotMatch(migration, /grant execute[^;]*\bto\s+(?:public|anon)\b/i);
});

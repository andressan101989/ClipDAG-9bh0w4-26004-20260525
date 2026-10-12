import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_ORIGIN = 'https://api.supabase.com';
const PRODUCTION_PROJECT_REF = 'aewwdlvbwpczqyvkwvvj';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const GET_TIMEOUT_MS = 15_000;
const SQL_TIMEOUT_MS = 60_000;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_HEALTH_SERVICES = ['auth', 'db', 'pooler', 'realtime', 'rest', 'storage'];
const RECONCILIATION_KEYS = [
  'account_balance_ledger_mismatch',
  'completed_credit_account_mismatch',
  'completed_credit_total_mismatch',
  'completed_debit_account_mismatch',
  'completed_debit_total_mismatch',
  'completed_without_credit',
  'completed_without_debit',
  'noncanonical_entry_type',
  'orphan_ledger_entries',
  'premium_finance_policy_row_count_mismatch',
];

export const FINANCE_SNAPSHOT_SQL = `with
clk as (select pg_catalog.clock_timestamp() observed_at),
policy_rows as (
  select pg_catalog.jsonb_build_object(
    'purchase_enabled',p.purchase_enabled,
    'subscription_enabled',p.subscription_enabled,
    'refunds_enabled',p.refunds_enabled,
    'platform_fee_bps',p.platform_fee_bps,
    'policy_version',p.policy_version
  ) item
  from private.creator_premium_finance_policy p
  order by p.singleton
),
tx_rows as (
  select t.created_at raw_created_at,t.id raw_id,
    pg_catalog.jsonb_build_object(
      'id',t.id::text,
      'from_account_id',t.from_account_id::text,
      'to_account_id',t.to_account_id::text,
      'operation_type',t.operation_type,
      'amount',t.amount::text,
      'fee_amount',t.fee_amount::text,
      'currency',t.currency,
      'status',t.status,
      'blockchain_txid_sha256',case when t.blockchain_txid is null then null else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(t.blockchain_txid,'UTF8'),'sha256'),'hex') end,
      'reference_type',t.reference_type,
      'reference_id_sha256',case when t.reference_id is null then null else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(t.reference_id,'UTF8'),'sha256'),'hex') end,
      'idempotency_key_sha256',case when t.idempotency_key is null then null else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(t.idempotency_key,'UTF8'),'sha256'),'hex') end,
      'initiated_by_sha256',case when t.initiated_by is null then null else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(t.initiated_by::text,'UTF8'),'sha256'),'hex') end,
      'chain_id',t.chain_id,
      'created_at',pg_catalog.to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'release_attributed',(
        ($1::text<>'' and pg_catalog.strpos(pg_catalog.concat_ws('|',t.id::text,t.reference_type,t.reference_id,t.idempotency_key,t.blockchain_txid,t.operation_type,t.chain_id),$1::text)>0)
        or ($2::text<>'' and pg_catalog.strpos(pg_catalog.concat_ws('|',t.id::text,t.reference_type,t.reference_id,t.idempotency_key,t.blockchain_txid,t.operation_type,t.chain_id),$2::text)>0)
      )
    ) item
  from public.financial_transactions t
),
le_rows as (
  select e.created_at raw_created_at,e.id raw_id,
    pg_catalog.jsonb_build_object(
      'id',e.id::text,'txn_id',e.txn_id::text,'account_id',e.account_id::text,
      'entry_type',e.entry_type,'amount',e.amount::text,'balance_after',e.balance_after::text,
      'description_sha256',case when e.description is null then null else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(e.description,'UTF8'),'sha256'),'hex') end,
      'metadata_sha256',case when e.metadata is null then null else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(e.metadata::text,'UTF8'),'sha256'),'hex') end,
      'created_at',pg_catalog.to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'release_attributed',(
        ($1::text<>'' and pg_catalog.strpos(pg_catalog.concat_ws('|',e.id::text,e.txn_id::text,e.description,e.metadata::text),$1::text)>0)
        or ($2::text<>'' and pg_catalog.strpos(pg_catalog.concat_ws('|',e.id::text,e.txn_id::text,e.description,e.metadata::text),$2::text)>0)
      )
    ) item
  from public.ledger_entries e
),
account_rows as (
  select a.id raw_id,
    pg_catalog.jsonb_build_object(
      'id',a.id::text,
      'owner_id_sha256',case when a.owner_id is null then null else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(a.owner_id::text,'UTF8'),'sha256'),'hex') end,
      'account_type',a.account_type,
      'currency',a.currency,
      'created_at',pg_catalog.to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) item
  from public.ledger_accounts a
),
tx_inventory as (
  select pg_catalog.count(*)::integer count,
    coalesce(pg_catalog.jsonb_agg(item order by raw_created_at,raw_id),'[]'::jsonb) items
  from tx_rows
),
le_inventory as (
  select pg_catalog.count(*)::integer count,
    coalesce(pg_catalog.jsonb_agg(item order by raw_created_at,raw_id),'[]'::jsonb) items
  from le_rows
),
account_inventory as (
  select pg_catalog.count(*)::integer count,
    coalesce(pg_catalog.jsonb_agg(item order by raw_id),'[]'::jsonb) items
  from account_rows
),
purchase_digest as (
  select pg_catalog.count(*)::integer count,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') sha256
  from private.creator_premium_purchase_receipts r
),
period_digest as (
  select pg_catalog.count(*)::integer count,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') sha256
  from private.creator_premium_subscription_periods p
),
schema_digest as (
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schema',c.table_schema,'table',c.table_name,'ordinal',c.ordinal_position,
      'column',c.column_name,'data_type',c.data_type,'udt_schema',c.udt_schema,
      'udt_name',c.udt_name,'nullable',c.is_nullable
    ) order by c.table_schema,c.table_name,c.ordinal_position),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex') sha256
  from information_schema.columns c
  where (c.table_schema,c.table_name) in (
    ('public','financial_transactions'),('public','ledger_entries'),('public','ledger_accounts'),
    ('private','creator_premium_finance_policy'),('private','creator_premium_purchase_receipts'),
    ('private','creator_premium_subscription_periods'))
),
recon as (select pg_catalog.jsonb_build_object(
  'orphan_ledger_entries',(select pg_catalog.count(*) from public.ledger_entries e left join public.financial_transactions t on t.id=e.txn_id where t.id is null),
  'completed_without_debit',(select pg_catalog.count(*) from public.financial_transactions t where t.status='completed' and not exists(select 1 from public.ledger_entries e where e.txn_id=t.id and e.entry_type='debit')),
  'completed_without_credit',(select pg_catalog.count(*) from public.financial_transactions t where t.status='completed' and not exists(select 1 from public.ledger_entries e where e.txn_id=t.id and e.entry_type='credit')),
  'completed_debit_total_mismatch',(select pg_catalog.count(*) from public.financial_transactions t where t.status='completed' and coalesce((select pg_catalog.sum(e.amount) from public.ledger_entries e where e.txn_id=t.id and e.entry_type='debit'),0)<>t.amount),
  'completed_credit_total_mismatch',(select pg_catalog.count(*) from public.financial_transactions t where t.status='completed' and coalesce((select pg_catalog.sum(e.amount) from public.ledger_entries e where e.txn_id=t.id and e.entry_type='credit'),0)<>t.amount),
  'completed_debit_account_mismatch',(select pg_catalog.count(*) from public.financial_transactions t where t.status='completed' and t.from_account_id is not null and not exists(select 1 from public.ledger_entries e where e.txn_id=t.id and e.entry_type='debit' and e.account_id=t.from_account_id)),
  'completed_credit_account_mismatch',(select pg_catalog.count(*) from public.financial_transactions t where t.status='completed' and t.to_account_id is not null and not exists(select 1 from public.ledger_entries e where e.txn_id=t.id and e.entry_type='credit' and e.account_id=t.to_account_id)),
  'noncanonical_entry_type',(select pg_catalog.count(*) from public.ledger_entries e where e.entry_type not in ('debit','credit')),
  'account_balance_ledger_mismatch',(select pg_catalog.count(*) from public.ledger_accounts a left join lateral(select e.balance_after from public.ledger_entries e where e.account_id=a.id order by e.created_at desc,e.id desc limit 1) last_entry on true where a.balance<>coalesce(last_entry.balance_after,0)),
  'premium_finance_policy_row_count_mismatch',(select case when pg_catalog.count(*)=1 then 0 else 1 end from private.creator_premium_finance_policy)
) item)
select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',true,'query_id','nelyon-finance-snapshot-v1',
  'database_time',pg_catalog.to_char(clk.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'schema_sha256',schema_digest.sha256,
  'watermark',(select case when x.item is null then null else pg_catalog.jsonb_build_object('created_at',x.item->>'created_at','id',x.item->>'id') end from (select item from tx_rows order by raw_created_at desc,raw_id desc limit 1)x),
  'policy',case when (select pg_catalog.count(*) from policy_rows)=1 then (select item from policy_rows limit 1) else null end,
  'transactions',pg_catalog.jsonb_build_object('complete',true,'count',tx_inventory.count,'items',tx_inventory.items),
  'ledger_entries',pg_catalog.jsonb_build_object('complete',true,'count',le_inventory.count,'items',le_inventory.items),
  'ledger_accounts',pg_catalog.jsonb_build_object('complete',true,'count',account_inventory.count,'items',account_inventory.items),
  'premium_transaction_count',(select pg_catalog.count(*)::integer from public.financial_transactions t where t.operation_type like 'creator_premium_%'),
  'premium_bindings',pg_catalog.jsonb_build_object(
    'purchase_receipts',pg_catalog.jsonb_build_object('count',purchase_digest.count,'sha256',purchase_digest.sha256),
    'subscription_periods',pg_catalog.jsonb_build_object('count',period_digest.count,'sha256',period_digest.sha256)),
  'reconciliation',recon.item
) snapshot
from clk,tx_inventory,le_inventory,account_inventory,purchase_digest,period_digest,schema_digest,recon;`;

export const CRON_SNAPSHOT_SQL = `select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',true,'query_id','nelyon-cron-snapshot-v1',
  'count',pg_catalog.count(*)::integer,
    'items',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'jobid',j.jobid::text,'jobname',j.jobname,'schedule',j.schedule,
    'database',j.database,'username',j.username,'active',j.active,
    'nodename',j.nodename,'nodeport',j.nodeport,
    'command_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(j.command,'UTF8'),'sha256'),'hex')
  ) order by j.jobid),'[]'::jsonb)
) snapshot from cron.job j;`;

function normalizeCanonical(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError('unsupported canonical value');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeCanonical(item, seen));
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = normalizeCanonical(value[key], seen);
    return output;
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value) {
  return `${JSON.stringify(normalizeCanonical(value))}\n`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    fail(code, 'evidence keys do not match the fixed contract');
  }
}

export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string') fail('READ_ONLY_QUERY_REJECTED', 'query must be text');
  const trimmed = sql.trim().replace(/;$/, '');
  if (!/^(?:select|with)\b/i.test(trimmed)
    || /;/.test(trimmed)
    || /--|\/\*/.test(trimmed)
    || /\b(?:alter|call|copy|create|delete|do|drop|grant|insert|refresh|reset|revoke|set|truncate|update|vacuum)\b/i.test(trimmed)
    || /\breconcile_creator_premium_publications_v1\b/i.test(trimmed)) {
    fail('READ_ONLY_QUERY_REJECTED', 'query is outside the fixed read-only contract');
  }
  return true;
}

function validateInventory(inventory, label) {
  exactKeys(inventory, ['complete', 'count', 'items'], 'INVALID_SNAPSHOT');
  if (inventory.complete !== true || !Number.isInteger(inventory.count)
    || inventory.count < 0 || !Array.isArray(inventory.items) || inventory.items.length !== inventory.count) {
    fail('INVALID_SNAPSHOT', `${label} inventory is incomplete`);
  }
  if (inventory.items.some(item => item?.release_attributed === true)) {
    fail('RELEASE_ATTRIBUTED_FINANCE', `${label} contains release-attributed activity`);
  }
  const ids = inventory.items.map(item => item?.id);
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    fail('INVALID_SNAPSHOT', `${label} identities are invalid`);
  }
}

function validateLedgerAccountInventory(inventory) {
  exactKeys(inventory, ['complete', 'count', 'items'], 'INVALID_SNAPSHOT');
  if (inventory.complete !== true || !Number.isInteger(inventory.count) || inventory.count < 0
    || !Array.isArray(inventory.items) || inventory.items.length !== inventory.count) {
    fail('INVALID_SNAPSHOT', 'ledger account inventory is incomplete');
  }
  const ids = [];
  for (const item of inventory.items) {
    exactKeys(item, ['account_type', 'created_at', 'currency', 'id', 'owner_id_sha256'], 'INVALID_SNAPSHOT');
    if (typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
      || (item.owner_id_sha256 !== null && !HASH_PATTERN.test(item.owner_id_sha256 ?? ''))
      || typeof item.account_type !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(item.account_type)
      || typeof item.currency !== 'string' || item.currency.length === 0
      || !Number.isFinite(Date.parse(item.created_at))) {
      fail('INVALID_SNAPSHOT', 'ledger account identity is invalid');
    }
    ids.push(item.id);
  }
  if (new Set(ids).size !== ids.length || canonicalJson(ids) !== canonicalJson([...ids].sort())) {
    fail('INVALID_SNAPSHOT', 'ledger account identities are duplicate or unordered');
  }
}

function validateFinanceSnapshot(snapshot) {
  exactKeys(snapshot, [
    'complete', 'database_time', 'ledger_accounts', 'ledger_entries', 'policy', 'premium_bindings', 'query_id', 'reconciliation',
    'premium_transaction_count', 'schema_sha256', 'schema_version', 'transactions', 'watermark',
  ], 'INVALID_SNAPSHOT');
  if (snapshot.schema_version !== 1 || snapshot.complete !== true
    || snapshot.query_id !== 'nelyon-finance-snapshot-v1'
    || !Number.isFinite(Date.parse(snapshot.database_time))
    || !HASH_PATTERN.test(snapshot.schema_sha256 ?? '')
    || !Number.isInteger(snapshot.premium_transaction_count) || snapshot.premium_transaction_count < 0) {
    fail('INVALID_SNAPSHOT', 'finance snapshot identity is invalid');
  }
  exactKeys(snapshot.policy, [
    'platform_fee_bps', 'policy_version', 'purchase_enabled', 'refunds_enabled', 'subscription_enabled',
  ], 'INVALID_SNAPSHOT');
  if (snapshot.policy.purchase_enabled !== false || snapshot.policy.subscription_enabled !== false
    || snapshot.policy.refunds_enabled !== false || snapshot.policy.platform_fee_bps !== 0
    || typeof snapshot.policy.policy_version !== 'string') {
    fail('FINANCE_POLICY_CHANGED', 'Premium Finance must remain disabled');
  }
  validateInventory(snapshot.transactions, 'transaction');
  validateInventory(snapshot.ledger_entries, 'ledger entry');
  validateLedgerAccountInventory(snapshot.ledger_accounts);
  exactKeys(snapshot.premium_bindings, ['purchase_receipts', 'subscription_periods'], 'INVALID_SNAPSHOT');
  for (const binding of Object.values(snapshot.premium_bindings)) {
    exactKeys(binding, ['count', 'sha256'], 'INVALID_SNAPSHOT');
    if (!Number.isInteger(binding.count) || binding.count < 0 || !HASH_PATTERN.test(binding.sha256 ?? '')) {
      fail('INVALID_SNAPSHOT', 'Premium binding digest is invalid');
    }
  }
  exactKeys(snapshot.reconciliation, RECONCILIATION_KEYS, 'INVALID_SNAPSHOT');
  if (RECONCILIATION_KEYS.some(key => !Number.isInteger(snapshot.reconciliation[key]) || snapshot.reconciliation[key] < 0)) {
    fail('INVALID_SNAPSHOT', 'reconciliation counters are invalid');
  }
  return snapshot;
}

function validateCronSnapshot(snapshot) {
  exactKeys(snapshot, ['complete', 'count', 'items', 'query_id', 'schema_version'], 'INVALID_SNAPSHOT');
  if (snapshot.schema_version !== 1 || snapshot.complete !== true
    || snapshot.query_id !== 'nelyon-cron-snapshot-v1'
    || !Number.isInteger(snapshot.count) || snapshot.count < 0
    || !Array.isArray(snapshot.items) || snapshot.items.length !== snapshot.count
    || snapshot.items.some(item => !HASH_PATTERN.test(item?.command_sha256 ?? ''))) {
    fail('INVALID_SNAPSHOT', 'cron snapshot is invalid');
  }
  return snapshot;
}

function validateNormalizedMigrations(inventory) {
  exactKeys(inventory, ['complete', 'count', 'items', 'latest', 'sha256'], 'INVALID_REMOTE_INVENTORY');
  if (inventory.complete !== true || !Number.isInteger(inventory.count) || inventory.count < 0
    || !Array.isArray(inventory.items) || inventory.items.length !== inventory.count
    || inventory.sha256 !== sha256(canonicalJson(inventory.items))) {
    fail('INVALID_REMOTE_INVENTORY', 'migration inventory is incomplete or has an invalid digest');
  }
  const sorted = [...inventory.items].sort((left, right) => left.version.localeCompare(right.version));
  if (inventory.items.some(item => {
    try {
      exactKeys(item, ['name', 'version'], 'INVALID_REMOTE_INVENTORY');
    } catch {
      return true;
    }
    return !/^20[0-9]{12}$/.test(item.version) || typeof item.name !== 'string' || item.name.length === 0;
  }) || canonicalJson(inventory.items) !== canonicalJson(sorted)
    || new Set(inventory.items.map(item => item.version)).size !== inventory.items.length
    || canonicalJson(inventory.latest) !== canonicalJson(inventory.items.at(-1) ?? null)) {
    fail('INVALID_REMOTE_INVENTORY', 'migration inventory ordering or identity is invalid');
  }
  return inventory;
}

function validateNormalizedFunctions(inventory) {
  exactKeys(inventory, ['complete', 'count', 'items', 'sha256'], 'INVALID_REMOTE_INVENTORY');
  if (inventory.complete !== true || !Number.isInteger(inventory.count) || inventory.count < 0
    || !Array.isArray(inventory.items) || inventory.items.length !== inventory.count
    || inventory.sha256 !== sha256(canonicalJson(inventory.items))) {
    fail('INVALID_REMOTE_INVENTORY', 'function inventory is incomplete or has an invalid digest');
  }
  const sorted = [...inventory.items].sort((left, right) => left.slug.localeCompare(right.slug));
  if (inventory.items.some(item => {
    try {
      exactKeys(item, ['ezbr_sha256', 'slug', 'status', 'verify_jwt', 'version'], 'INVALID_REMOTE_INVENTORY');
    } catch {
      return true;
    }
    return typeof item.slug !== 'string' || item.status !== 'ACTIVE'
      || !Number.isInteger(item.version) || item.version < 1
      || typeof item.verify_jwt !== 'boolean' || !HASH_PATTERN.test(item.ezbr_sha256 ?? '');
  }) || canonicalJson(inventory.items) !== canonicalJson(sorted)
    || new Set(inventory.items.map(item => item.slug)).size !== inventory.items.length) {
    fail('INVALID_REMOTE_INVENTORY', 'function inventory ordering or identity is invalid');
  }
  return inventory;
}

function validateNormalizedHealth(health) {
  exactKeys(health, ['complete', 'services', 'status'], 'INVALID_REMOTE_INVENTORY');
  if (health.complete !== true || health.status !== 'ACTIVE_HEALTHY' || !Array.isArray(health.services)
    || canonicalJson(health.services.map(item => item?.name)) !== canonicalJson(REQUIRED_HEALTH_SERVICES)
    || health.services.some(item => item?.healthy !== true || item.status !== 'ACTIVE_HEALTHY')) {
    fail('UNHEALTHY_REMOTE_PROJECT', 'project health evidence is incomplete');
  }
  return health;
}

function validateNormalizedAdvisors(advisors) {
  exactKeys(advisors, ['complete', 'count', 'items', 'sha256'], 'INVALID_REMOTE_INVENTORY');
  if (advisors.complete !== true || !Number.isInteger(advisors.count) || advisors.count < 0
    || !Array.isArray(advisors.items) || advisors.items.length !== advisors.count
    || advisors.sha256 !== sha256(canonicalJson(advisors.items))
    || advisors.items.some(item => !HASH_PATTERN.test(item?.fingerprint ?? '')
      || typeof item.level !== 'string' || typeof item.resource_kind !== 'string')) {
    fail('INVALID_REMOTE_INVENTORY', 'security advisor evidence is invalid');
  }
  return advisors;
}

function expectedSnapshotIdentity(request, manifest) {
  const identity = manifest?.identity;
  if (!identity || identity.release_id !== request?.releaseId || String(identity.run_id) !== String(request?.runId)
    || identity.run_attempt !== request?.runAttempt || identity.approved_sha !== request?.approvedSha) {
    fail('INVALID_SNAPSHOT_IDENTITY', 'request and manifest identity do not match');
  }
  return {
    approved_sha: request.approvedSha,
    release_id: request.releaseId,
    run_id: String(request.runId),
    run_attempt: request.runAttempt,
    manifest_sha256: sha256(canonicalJson(manifest)),
  };
}

function validateManifestAdapterIdentity(manifest, adapterSourceSha256) {
  if (manifest?.compiler?.snapshot_adapter_path !== 'scripts/nelyon-production-snapshot-adapter.mjs'
    || !HASH_PATTERN.test(manifest?.compiler?.snapshot_adapter_sha256 ?? '')
    || manifest.compiler.snapshot_adapter_sha256 !== adapterSourceSha256) {
    fail('INVALID_SNAPSHOT_IDENTITY', 'snapshot adapter is not bound to the approved manifest');
  }
}

function validateCapturedEvidence({ evidence, phase, policy, request, manifest, adapterSourceSha256 }) {
  validateManifestAdapterIdentity(manifest, adapterSourceSha256);
  exactKeys(evidence, [
    'adapter', 'complete', 'cron_security', 'evidence_sha256', 'finance', 'functions',
    'health', 'identity', 'migrations', 'observed_at', 'phase', 'project_ref', 'requests', 'schema_version',
  ], 'INVALID_SNAPSHOT');
  const { evidence_sha256: claimedDigest, ...unsigned } = evidence;
  if (!HASH_PATTERN.test(claimedDigest ?? '') || claimedDigest !== sha256(canonicalJson(unsigned))) {
    fail('INVALID_SNAPSHOT', 'snapshot evidence digest does not match its canonical bytes');
  }
  if (evidence.schema_version !== 1 || evidence.complete !== true || evidence.phase !== phase
    || evidence.project_ref !== PRODUCTION_PROJECT_REF || policy?.supabase?.project_ref !== PRODUCTION_PROJECT_REF
    || !Number.isFinite(Date.parse(evidence.observed_at))) {
    fail('INVALID_SNAPSHOT_IDENTITY', 'snapshot phase, project, or timestamp is invalid');
  }
  if (canonicalJson(evidence.identity) !== canonicalJson(expectedSnapshotIdentity(request, manifest))) {
    fail('INVALID_SNAPSHOT_IDENTITY', 'snapshot is not bound to the approved request and manifest');
  }
  exactKeys(evidence.adapter, ['queries', 'source_sha256'], 'INVALID_SNAPSHOT_IDENTITY');
  const expectedQueries = [
    { id: 'nelyon-cron-snapshot-v1', sha256: sha256(CRON_SNAPSHOT_SQL) },
    { id: 'nelyon-finance-snapshot-v1', sha256: sha256(FINANCE_SNAPSHOT_SQL) },
  ];
  if (!HASH_PATTERN.test(adapterSourceSha256 ?? '')
    || evidence.adapter.source_sha256 !== adapterSourceSha256
    || canonicalJson(evidence.adapter.queries) !== canonicalJson(expectedQueries)) {
    fail('INVALID_SNAPSHOT_IDENTITY', 'snapshot adapter or query identity has drifted');
  }
  const base = `/v1/projects/${PRODUCTION_PROJECT_REF}`;
  const expectedRequests = [
    ['GET', `${base}/health?services=${REQUIRED_HEALTH_SERVICES.join(',')}`, 200],
    ['GET', `${base}/database/migrations`, 200],
    ['GET', `${base}/functions`, 200],
    ['GET', `${base}/advisors/security`, 200],
    ['POST', `${base}/database/query/read-only`, 201],
    ['POST', `${base}/database/query/read-only`, 201],
  ];
  if (!Array.isArray(evidence.requests) || evidence.requests.length !== expectedRequests.length
    || evidence.requests.some((receipt, index) => {
      try {
        exactKeys(receipt, ['method', 'path', 'response_sha256', 'status'], 'INVALID_SNAPSHOT');
      } catch {
        return true;
      }
      const [method, path, status] = expectedRequests[index];
      return receipt.method !== method || receipt.path !== path || receipt.status !== status
        || !HASH_PATTERN.test(receipt.response_sha256 ?? '');
    })) {
    fail('INVALID_SNAPSHOT', 'snapshot request receipts do not match the fixed read-only contract');
  }
  validateNormalizedHealth(evidence.health);
  validateNormalizedMigrations(evidence.migrations);
  validateNormalizedFunctions(evidence.functions);
  exactKeys(evidence.cron_security, ['advisors', 'complete', 'cron'], 'INVALID_REMOTE_INVENTORY');
  if (evidence.cron_security.complete !== true) fail('INVALID_REMOTE_INVENTORY', 'cron/security evidence is incomplete');
  validateCronSnapshot(evidence.cron_security.cron);
  validateNormalizedAdvisors(evidence.cron_security.advisors);
  validateFinanceSnapshot(evidence.finance);
  return evidence;
}

function baselineMigrationName(item) {
  return `${item.version}_${item.name}`;
}

export function buildProductionBaselineDigests({ evidence, policy }) {
  validateNormalizedMigrations(evidence?.migrations);
  validateNormalizedFunctions(evidence?.functions);
  validateNormalizedAdvisors(evidence?.cron_security?.advisors);
  validateCronSnapshot(evidence?.cron_security?.cron);
  validateFinanceSnapshot(evidence?.finance);
  const managedNames = [...(policy?.supabase?.managed_functions ?? [])].sort();
  const managedSet = new Set(managedNames);
  const blocked = new Set(policy?.baseline?.blocked_resources ?? []);
  const managed = evidence.functions.items
    .filter(item => managedSet.has(item.slug))
    .map(item => ({ name: item.slug, source_sha256: item.ezbr_sha256, source_parity: !blocked.has(item.slug), verify_jwt: item.verify_jwt, version: item.version }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (canonicalJson(managed.map(item => item.name)) !== canonicalJson(managedNames)) {
    fail('REMOTE_BASELINE_MISMATCH', 'managed function inventory is incomplete');
  }
  const unmanaged = evidence.functions.items
    .filter(item => !managedSet.has(item.slug))
    .map(item => ({ name: item.slug, version: item.version }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const config = {
    complete: true,
    managed_functions: managed.map(item => ({ name: item.name, verify_jwt: item.verify_jwt })),
  };
  const cronSecurity = {
    complete: true,
    cron: evidence.cron_security.cron.items,
    security_findings: evidence.cron_security.advisors.items,
  };
  const finance = {
    complete: true,
    schema_sha256: evidence.finance.schema_sha256,
    policy: evidence.finance.policy,
    premium_transaction_count: evidence.finance.premium_transaction_count,
    premium_bindings: evidence.finance.premium_bindings,
    reconciliation: evidence.finance.reconciliation,
    c2_attributed_bdag_movement: 0,
  };
  const digestOf = value => sha256(canonicalJson(value));
  return {
    migrations: digestOf(evidence.migrations.items.map(baselineMigrationName)),
    managed_functions: digestOf(managed.map(item => ({ name: item.name, version: item.version, verify_jwt: item.verify_jwt }))),
    unmanaged_functions: digestOf(unmanaged),
    function_source_parity: digestOf(managed.map(item => ({ name: item.name, source_sha256: item.source_sha256, source_parity: item.source_parity }))),
    config_verify_jwt: digestOf(config),
    cron_security: digestOf(cronSecurity),
    finance: digestOf(finance),
  };
}

export function verifyProductionPreSnapshot({ pre, policy, request, manifest, adapterSourceSha256 }) {
  validateCapturedEvidence({ evidence: pre, phase: 'pre', policy, request, manifest, adapterSourceSha256 });
  const baseline = policy?.baseline;
  if (baseline?.state !== 'verified'
    || !HASH_PATTERN.test(baseline.evidence ?? '')
    || !HASH_PATTERN.test(baseline.reviewed_policy_sha256 ?? '')
    || baseline.verified_by !== policy?.owner
    || !Number.isFinite(Date.parse(baseline.verified_at))
    || baseline.authority_source !== 'owner-control-plane'
    || baseline.requires_separate_policy_commit !== true
    || !Array.isArray(baseline.blocked_resources)) {
    fail('REMOTE_BASELINE_MISMATCH', 'owner-reviewed baseline authority is incomplete');
  }
  const latest = pre.migrations.latest ? baselineMigrationName(pre.migrations.latest) : null;
  if (pre.migrations.count !== baseline.migration_count || latest !== baseline.latest_migration
    || pre.functions.count !== policy?.supabase?.expected_remote_function_count
    || pre.finance.premium_transaction_count !== 0
    || RECONCILIATION_KEYS.some(key => pre.finance.reconciliation[key] !== 0)
    || canonicalJson({
      purchase_enabled: pre.finance.policy.purchase_enabled,
      subscription_enabled: pre.finance.policy.subscription_enabled,
      refunds_enabled: pre.finance.policy.refunds_enabled,
      platform_fee_bps: pre.finance.policy.platform_fee_bps,
    }) !== canonicalJson(policy?.supabase?.finance_policy)) {
    fail('REMOTE_BASELINE_MISMATCH', 'remote baseline identity, inventory, or finance policy has drifted');
  }
  const digests = buildProductionBaselineDigests({ evidence: pre, policy });
  if (canonicalJson(digests) !== canonicalJson(baseline.evidence_digests)) {
    fail('REMOTE_BASELINE_MISMATCH', 'remote baseline section digests differ from owner-reviewed evidence');
  }
  return {
    result: 'REMOTE_BASELINE_VERIFIED',
    evidence_sha256: pre.evidence_sha256,
    evidence_digests: digests,
  };
}

export function verifyProductionSnapshotPair({ pre, post, policy, request, manifest, adapterSourceSha256 }) {
  verifyProductionPreSnapshot({ pre, policy, request, manifest, adapterSourceSha256 });
  validateCapturedEvidence({ evidence: post, phase: 'post', policy, request, manifest, adapterSourceSha256 });
  if (Date.parse(post.observed_at) < Date.parse(pre.observed_at)
    || Date.parse(post.finance.database_time) < Date.parse(pre.finance.database_time)) {
    fail('INVALID_SNAPSHOT_ORDER', 'post-release evidence predates pre-release evidence');
  }

  const manifestMigrations = [...(manifest?.resources?.migrations ?? [])]
    .map(item => item?.version).sort();
  if (manifestMigrations.some(version => !/^20[0-9]{12}$/.test(version ?? ''))
    || new Set(manifestMigrations).size !== manifestMigrations.length) {
    fail('REMOTE_POSTCHECK_FAILED', 'manifest migration inventory is invalid');
  }
  const preVersions = pre.migrations.items.map(item => item.version);
  const postVersions = post.migrations.items.map(item => item.version);
  if (canonicalJson(postVersions) !== canonicalJson([...preVersions, ...manifestMigrations].sort())) {
    fail('REMOTE_POSTCHECK_FAILED', 'post-release migrations do not equal the pre-snapshot plus the exact manifest');
  }

  if (pre.functions.count !== policy?.supabase?.expected_remote_function_count
    || post.functions.count !== pre.functions.count) {
    fail('REMOTE_POSTCHECK_FAILED', 'remote function count changed unexpectedly');
  }
  const expectedChanged = [...(manifest?.resources?.functions ?? [])].sort();
  const functionContracts = manifest?.resources?.function_contracts;
  if (expectedChanged.some(name => !policy?.supabase?.managed_functions?.includes(name))
    || new Set(expectedChanged).size !== expectedChanged.length
    || !Array.isArray(functionContracts)
    || canonicalJson(functionContracts.map(item => item?.name)) !== canonicalJson(expectedChanged)) {
    fail('REMOTE_POSTCHECK_FAILED', 'manifest function inventory is outside the managed allowlist');
  }
  const contractByName = new Map();
  for (const contract of functionContracts) {
    try {
      exactKeys(contract, [
        'entrypoint', 'import_map', 'name', 'source_changed', 'source_files', 'source_sha256', 'verify_jwt',
      ], 'REMOTE_POSTCHECK_FAILED');
    } catch {
      fail('REMOTE_POSTCHECK_FAILED', 'manifest function contract is malformed');
    }
    if (typeof contract.name !== 'string' || typeof contract.entrypoint !== 'string'
      || (contract.import_map !== null && typeof contract.import_map !== 'string')
      || typeof contract.source_changed !== 'boolean' || typeof contract.verify_jwt !== 'boolean'
      || !HASH_PATTERN.test(contract.source_sha256 ?? '')
      || !Array.isArray(contract.source_files) || contract.source_files.length === 0
      || contract.source_files.some(item => {
        try {
          exactKeys(item, ['path', 'sha256'], 'REMOTE_POSTCHECK_FAILED');
        } catch {
          return true;
        }
        return typeof item.path !== 'string' || !HASH_PATTERN.test(item.sha256 ?? '');
      })) {
      fail('REMOTE_POSTCHECK_FAILED', 'manifest function contract is malformed');
    }
    contractByName.set(contract.name, contract);
  }
  const beforeFunctions = new Map(pre.functions.items.map(item => [item.slug, item]));
  const afterFunctions = new Map(post.functions.items.map(item => [item.slug, item]));
  if (canonicalJson([...beforeFunctions.keys()].sort()) !== canonicalJson([...afterFunctions.keys()].sort())) {
    fail('REMOTE_POSTCHECK_FAILED', 'remote function identity set changed');
  }
  const observedChanged = [];
  const functionAttestations = [];
  for (const [name, before] of beforeFunctions) {
    const after = afterFunctions.get(name);
    if (canonicalJson(before) === canonicalJson(after)) continue;
    const contract = contractByName.get(name);
    if (!contract || after.version <= before.version || after.verify_jwt !== contract.verify_jwt
      || (contract.source_changed && after.ezbr_sha256 === before.ezbr_sha256)) {
      fail('REMOTE_POSTCHECK_FAILED', `unexpected or non-monotonic function change: ${name}`);
    }
    observedChanged.push(name);
    functionAttestations.push({
      name,
      before_version: before.version,
      after_version: after.version,
      before_source_sha256: before.ezbr_sha256,
      after_source_sha256: after.ezbr_sha256,
      verify_jwt: after.verify_jwt,
    });
  }
  if (canonicalJson(observedChanged.sort()) !== canonicalJson(expectedChanged)) {
    fail('REMOTE_POSTCHECK_FAILED', 'not every manifest function produced a verified remote version change');
  }

  if (canonicalJson(pre.cron_security.cron) !== canonicalJson(post.cron_security.cron)) {
    fail('REMOTE_POSTCHECK_FAILED', 'cron configuration changed during release');
  }
  const priorAdvisors = new Set(pre.cron_security.advisors.items.map(item => item.fingerprint));
  if (post.cron_security.advisors.items.some(item => !priorAdvisors.has(item.fingerprint))) {
    fail('REMOTE_POSTCHECK_FAILED', 'release introduced a new security advisor finding');
  }
  if (post.finance.schema_sha256 !== pre.finance.schema_sha256
    || canonicalJson(post.finance.premium_bindings) !== canonicalJson(pre.finance.premium_bindings)
    || canonicalJson(post.finance.policy) !== canonicalJson(pre.finance.policy)
    || RECONCILIATION_KEYS.some(key => post.finance.reconciliation[key] !== 0)) {
    fail('REMOTE_POSTCHECK_FAILED', 'finance schema, Premium bindings, policy, or reconciliation changed');
  }
  const postAccounts = new Map(post.finance.ledger_accounts.items.map(item => [item.id, item]));
  for (const before of pre.finance.ledger_accounts.items) {
    const after = postAccounts.get(before.id);
    if (!after || canonicalJson(after) !== canonicalJson(before)) {
      fail('REMOTE_POSTCHECK_FAILED', 'a pre-existing ledger account identity changed or disappeared');
    }
  }
  return {
    result: 'REMOTE_POSTCHECK_VERIFIED',
    changed_functions: observedChanged.sort(),
    function_attestations: functionAttestations.sort((left, right) => left.name.localeCompare(right.name)),
    applied_migrations: manifestMigrations,
    pre_evidence_sha256: pre.evidence_sha256,
    post_evidence_sha256: post.evidence_sha256,
  };
}

async function readJson(response, { expectedStatus, label }) {
  if (response.status !== expectedStatus) fail('REMOTE_READ_FAILED', `${label} HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) fail('REMOTE_READ_FAILED', `${label} returned a non-JSON response`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail('REMOTE_RESPONSE_TOO_LARGE', `${label} response exceeds the limit`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) fail('REMOTE_RESPONSE_TOO_LARGE', `${label} response exceeds the limit`);
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('REMOTE_READ_FAILED', `${label} returned malformed JSON`);
  }
  return { body, responseSha256: sha256(bytes) };
}

async function fixedRequest({ fetchImpl, token, path, method = 'GET', body, expectedStatus, timeoutMs, label }) {
  const url = new URL(path, API_ORIGIN);
  if (url.protocol !== 'https:' || url.hostname !== 'api.supabase.com' || url.origin !== API_ORIGIN) {
    fail('UNSAFE_REMOTE_ENDPOINT', 'remote endpoint is not the fixed Supabase Management API');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.redirected) fail('UNSAFE_REMOTE_REDIRECT', `${label} redirected unexpectedly`);
    const parsed = await readJson(response, { expectedStatus, label });
    return {
      body: parsed.body,
      receipt: { method, path: `${url.pathname}${url.search}`, status: response.status, response_sha256: parsed.responseSha256 },
    };
  } catch (error) {
    if (error?.code) throw error;
    fail(error?.name === 'AbortError' ? 'REMOTE_TIMEOUT' : 'REMOTE_READ_FAILED', `${label} request failed`);
  } finally {
    clearTimeout(timeout);
  }
}

function singleSnapshot(body, validator, label) {
  if (!Array.isArray(body) || body.length !== 1) fail('INVALID_SNAPSHOT', `${label} must return exactly one row`);
  exactKeys(body[0], ['snapshot'], 'INVALID_SNAPSHOT');
  return validator(body[0].snapshot);
}

function normalizeHealth(body) {
  if (!Array.isArray(body)) fail('INVALID_REMOTE_INVENTORY', 'health inventory is invalid');
  const services = body.map(item => ({ healthy: item?.healthy, name: item?.name, status: item?.status }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (canonicalJson(services.map(item => item.name)) !== canonicalJson(REQUIRED_HEALTH_SERVICES)
    || new Set(services.map(item => item.name)).size !== REQUIRED_HEALTH_SERVICES.length
    || services.some(item => item.healthy !== true || item.status !== 'ACTIVE_HEALTHY')) {
    fail('UNHEALTHY_REMOTE_PROJECT', 'one or more required services are unhealthy');
  }
  return { complete: true, status: 'ACTIVE_HEALTHY', services };
}

function normalizeMigrations(body) {
  if (!Array.isArray(body)) fail('INVALID_REMOTE_INVENTORY', 'migration inventory is not an array');
  const items = body.map(item => ({ version: String(item?.version ?? ''), name: String(item?.name ?? '') }))
    .sort((a, b) => a.version.localeCompare(b.version));
  if (items.some(item => !/^20[0-9]{12}$/.test(item.version) || !item.name)) {
    fail('INVALID_REMOTE_INVENTORY', 'migration inventory contains an invalid row');
  }
  return { complete: true, count: items.length, latest: items.at(-1) ?? null, items, sha256: sha256(canonicalJson(items)) };
}

function normalizeFunctions(body) {
  if (!Array.isArray(body)) fail('INVALID_REMOTE_INVENTORY', 'function inventory is not an array');
  const items = body.map(item => ({
    slug: item?.slug,
    status: item?.status,
    version: item?.version,
    verify_jwt: item?.verify_jwt,
    ezbr_sha256: item?.ezbr_sha256,
  })).sort((a, b) => a.slug.localeCompare(b.slug));
  if (items.some(item => typeof item.slug !== 'string' || item.status !== 'ACTIVE'
    || !Number.isInteger(item.version) || item.version < 1 || typeof item.verify_jwt !== 'boolean'
    || !HASH_PATTERN.test(item.ezbr_sha256 ?? ''))
    || new Set(items.map(item => item.slug)).size !== items.length) {
    fail('INVALID_REMOTE_INVENTORY', 'function inventory contains an invalid row');
  }
  return { complete: true, count: items.length, items, sha256: sha256(canonicalJson(items)) };
}

function stableAdvisorValue(value) {
  if (Array.isArray(value)) return value.map(stableAdvisorValue);
  if (!value || typeof value !== 'object') return value;
  const volatile = new Set(['created_at', 'detected_at', 'first_seen_at', 'last_seen_at', 'observed_at', 'updated_at']);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !volatile.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableAdvisorValue(item)]));
}

function normalizeAdvisors(body) {
  const lints = body?.lints;
  if (!Array.isArray(lints)) fail('INVALID_REMOTE_INVENTORY', 'security advisor inventory is invalid');
  const items = lints.map(lint => {
    const stable = stableAdvisorValue(lint);
    return {
      fingerprint: sha256(canonicalJson(stable)),
      level: String(lint?.level ?? lint?.severity ?? 'UNKNOWN'),
      resource_kind: String(lint?.metadata?.type ?? lint?.name ?? 'unknown'),
    };
  }).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return { complete: true, count: items.length, items, sha256: sha256(canonicalJson(items)) };
}

function validateIdentity({ phase, policy, request, manifest, token, observedAt, adapterSourceSha256 }) {
  if (!['pre', 'post'].includes(phase)) fail('INVALID_SNAPSHOT_IDENTITY', 'phase must be pre or post');
  if (policy?.supabase?.project_ref !== PRODUCTION_PROJECT_REF) fail('INVALID_SNAPSHOT_IDENTITY', 'unexpected production project');
  if (typeof token !== 'string' || token.length < 1) fail('MISSING_READ_ONLY_TOKEN', 'read-only token is unavailable');
  if (!Number.isFinite(Date.parse(observedAt)) || !HASH_PATTERN.test(adapterSourceSha256 ?? '')) {
    fail('INVALID_SNAPSHOT_IDENTITY', 'snapshot timestamp or adapter identity is invalid');
  }
  validateManifestAdapterIdentity(manifest, adapterSourceSha256);
  const identity = manifest?.identity;
  if (!identity || identity.release_id !== request?.releaseId || String(identity.run_id) !== String(request?.runId)
    || identity.run_attempt !== request?.runAttempt || identity.approved_sha !== request?.approvedSha
    || !/^[0-9a-f]{40}$/.test(request?.approvedSha ?? '')) {
    fail('INVALID_SNAPSHOT_IDENTITY', 'request and manifest identity do not match');
  }
  return {
    approved_sha: request.approvedSha,
    release_id: request.releaseId,
    run_id: String(request.runId),
    run_attempt: request.runAttempt,
    manifest_sha256: sha256(canonicalJson(manifest)),
  };
}

export async function captureProductionSnapshot({
  phase,
  policy,
  request,
  manifest,
  token,
  fetchImpl = globalThis.fetch,
  observedAt = new Date().toISOString(),
  adapterSourceSha256,
}) {
  const identity = validateIdentity({ phase, policy, request, manifest, token, observedAt, adapterSourceSha256 });
  if (typeof fetchImpl !== 'function') fail('INVALID_TRANSPORT', 'fetch implementation is unavailable');
  assertReadOnlySql(FINANCE_SNAPSHOT_SQL);
  assertReadOnlySql(CRON_SNAPSHOT_SQL);
  const base = `/v1/projects/${PRODUCTION_PROJECT_REF}`;
  const calls = [];
  const get = async (path, label) => {
    const result = await fixedRequest({ fetchImpl, token, path, expectedStatus: 200, timeoutMs: GET_TIMEOUT_MS, label });
    calls.push(result.receipt);
    return result.body;
  };
  const sql = async (query, parameters, label) => {
    const result = await fixedRequest({
      fetchImpl,
      token,
      path: `${base}/database/query/read-only`,
      method: 'POST',
      body: { query, ...(parameters ? { parameters } : {}) },
      expectedStatus: 201,
      timeoutMs: SQL_TIMEOUT_MS,
      label,
    });
    calls.push(result.receipt);
    return result.body;
  };
  const healthBody = await get(`${base}/health?services=${REQUIRED_HEALTH_SERVICES.join(',')}`, 'project health');
  const migrationsBody = await get(`${base}/database/migrations`, 'migration inventory');
  const functionsBody = await get(`${base}/functions`, 'function inventory');
  const advisorsBody = await get(`${base}/advisors/security`, 'security advisors');
  const financeBody = await sql(
    FINANCE_SNAPSHOT_SQL,
    [identity.release_id, identity.run_id],
    'finance snapshot',
  );
  const cronBody = await sql(CRON_SNAPSHOT_SQL, null, 'cron snapshot');
  const evidence = {
    schema_version: 1,
    complete: true,
    phase,
    project_ref: PRODUCTION_PROJECT_REF,
    identity,
    adapter: {
      source_sha256: adapterSourceSha256,
      queries: [
        { id: 'nelyon-cron-snapshot-v1', sha256: sha256(CRON_SNAPSHOT_SQL) },
        { id: 'nelyon-finance-snapshot-v1', sha256: sha256(FINANCE_SNAPSHOT_SQL) },
      ],
    },
    observed_at: new Date(observedAt).toISOString(),
    health: normalizeHealth(healthBody),
    migrations: normalizeMigrations(migrationsBody),
    functions: normalizeFunctions(functionsBody),
    cron_security: {
      complete: true,
      cron: singleSnapshot(cronBody, validateCronSnapshot, 'cron snapshot'),
      advisors: normalizeAdvisors(advisorsBody),
    },
    finance: singleSnapshot(financeBody, validateFinanceSnapshot, 'finance snapshot'),
    requests: calls,
  };
  return { ...evidence, evidence_sha256: sha256(canonicalJson(evidence)) };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) fail('INVALID_ARGUMENT', 'invalid CLI arguments');
    values[flag.slice(2)] = value;
  }
  return { command, values };
}

async function runCli(argv) {
  const { command, values } = parseCli(argv);
  if (command !== 'capture') fail('INVALID_ARGUMENT', 'only capture is supported');
  for (const required of ['phase', 'policy', 'request', 'manifest', 'output']) {
    if (!values[required]) fail('INVALID_ARGUMENT', `missing ${required}`);
  }
  const output = resolve(values.output);
  const parent = dirname(output);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail('UNSAFE_OUTPUT', 'output parent must be an ordinary directory');
  const policy = JSON.parse(readFileSync(resolve(values.policy), 'utf8'));
  const request = JSON.parse(readFileSync(resolve(values.request), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(values.manifest), 'utf8'));
  const sourcePath = fileURLToPath(import.meta.url);
  const result = await captureProductionSnapshot({
    phase: values.phase,
    policy,
    request,
    manifest,
    token: process.env.SUPABASE_READ_ONLY_ACCESS_TOKEN,
    adapterSourceSha256: sha256(readFileSync(sourcePath)),
  });
  writeFileSync(output, canonicalJson(result), { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`SNAPSHOT ${values.phase.toUpperCase()} ${result.evidence_sha256}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error?.code ?? 'SNAPSHOT_FAILED'}: ${String(error?.message ?? 'snapshot failed').replace(/[\r\n]+/g, ' ')}\n`);
    process.exitCode = 1;
  });
}

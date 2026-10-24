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
const F2_MANAGED_SCOPE_TRANSITION = Object.freeze({
  id: 'creator-premium-f2-bdag-ledger-enrollment-v1',
  state: 'attested_one_time',
  resource: 'bdag-ledger',
  from_classification: 'unmanaged',
  to_classification: 'managed',
  baseline_sha: '9b4a5d15a6746e11a27bc1d9edafeab10e7d421d',
  attested_source_sha: '97f6638acaa5be2af336b427184c11185e3d0fe1',
  migration: '20261024173500_creator_premium_f2_complete_monetization',
  migration_blob: 'fce8789a0c79251afbe962bd39f6bd81ae248296',
  function_source_sha256: '06a7f77242df926411f7aae44eb808f8bb1ce1e88b8a342376911f1e6519e8fa',
  finance_off_required: true,
  requires_postcheck: true,
  requires_separate_baseline_promotion: true,
});

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
claimed_financial_links as (
  select e.id ledger_entry_id,e.account_id,e.entry_type,e.amount,
    case when(e.metadata->>'fin_txn_id')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then(e.metadata->>'fin_txn_id')::uuid else null end financial_transaction_id
  from public.ledger_entries e
  where pg_catalog.jsonb_typeof(e.metadata)='object' and e.metadata?'fin_txn_id'
),
financial_entry_links as (
  select e.id ledger_entry_id,t.id financial_transaction_id,e.account_id,e.entry_type,e.amount
  from public.ledger_entries e
  join public.financial_transactions t on t.id=e.txn_id
  union
  select c.ledger_entry_id,t.id,c.account_id,c.entry_type,c.amount
  from claimed_financial_links c
  join public.financial_transactions t on t.id=c.financial_transaction_id
  union
  select e.id,t.id,e.account_id,e.entry_type,e.amount
  from public.financial_transactions t
  join public.ledger_entries e on t.operation_type='withdrawal'
    and e.created_at=t.created_at
    and ((e.entry_type='debit' and e.account_id=t.from_account_id and e.amount=t.amount)
      or (e.entry_type='credit' and e.account_id=t.to_account_id and e.amount=t.amount-t.fee_amount))
),
completed_finance as (
  select t.id,t.operation_type,t.amount,t.fee_amount,t.from_account_id,t.to_account_id,
    pg_catalog.count(l.ledger_entry_id)filter(where l.entry_type='debit') debit_count,
    pg_catalog.count(l.ledger_entry_id)filter(where l.entry_type='credit') credit_count,
    coalesce(pg_catalog.sum(l.amount)filter(where l.entry_type='debit'),0) debit_total,
    coalesce(pg_catalog.sum(l.amount)filter(where l.entry_type='credit'),0) credit_total,
    pg_catalog.count(l.ledger_entry_id)filter(where l.entry_type='debit' and l.account_id=t.from_account_id) debit_account_count,
    pg_catalog.count(l.ledger_entry_id)filter(where l.entry_type='credit' and l.account_id=t.to_account_id) credit_account_count
  from public.financial_transactions t
  left join financial_entry_links l on l.financial_transaction_id=t.id
  where t.status='completed'
  group by t.id,t.operation_type,t.amount,t.fee_amount,t.from_account_id,t.to_account_id
),
recon as (select pg_catalog.jsonb_build_object(
  'orphan_ledger_entries',(select pg_catalog.count(*) from claimed_financial_links c where c.financial_transaction_id is null or not exists(select 1 from public.financial_transactions t where t.id=c.financial_transaction_id)),
  'completed_without_debit',(select pg_catalog.count(*) from completed_finance t where t.from_account_id is not null and t.debit_count=0),
  'completed_without_credit',(select pg_catalog.count(*) from completed_finance t where t.to_account_id is not null and t.credit_count=0),
  'completed_debit_total_mismatch',(select pg_catalog.count(*) from completed_finance t where t.debit_total<>case when t.from_account_id is null then 0 else t.amount end),
  'completed_credit_total_mismatch',(select pg_catalog.count(*) from completed_finance t where t.credit_total<>case when t.to_account_id is null then 0 when t.operation_type='withdrawal'then t.amount-t.fee_amount else t.amount end),
  'completed_debit_account_mismatch',(select pg_catalog.count(*) from completed_finance t where t.from_account_id is not null and t.debit_account_count=0),
  'completed_credit_account_mismatch',(select pg_catalog.count(*) from completed_finance t where t.to_account_id is not null and t.credit_account_count=0),
  'noncanonical_entry_type',(select pg_catalog.count(*) from public.ledger_entries e where e.entry_type not in ('debit','credit')),
  'account_balance_ledger_mismatch',(select pg_catalog.count(*) from public.ledger_accounts a
    left join lateral(select pg_catalog.max(e.created_at)latest_created_at from public.ledger_entries e where e.account_id=a.id)latest on true
    where(latest.latest_created_at is null and a.balance<>0)
      or(latest.latest_created_at is not null and not exists(select 1 from public.ledger_entries e where e.account_id=a.id and e.created_at=latest.latest_created_at and e.balance_after=a.balance))),
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

export const A2_RPC_IDENTITIES = [
  { schema: 'public', name: 'admin_refund_creator_premium_purchase_v1', argument_types: ['uuid', 'uuid', 'text'] },
  { schema: 'public', name: 'admin_refund_creator_premium_subscription_period_v1', argument_types: ['uuid', 'uuid', 'text'] },
  { schema: 'public', name: 'admin_review_creator_premium_content_v1', argument_types: ['uuid', 'text', 'text', 'uuid'] },
  { schema: 'public', name: 'get_admin_creator_premium_content_v1', argument_types: ['uuid'] },
  { schema: 'public', name: 'get_admin_creator_premium_refund_candidates_v1', argument_types: ['uuid'] },
  { schema: 'public', name: 'get_creator_premium_commerce_v1', argument_types: ['uuid'] },
  { schema: 'public', name: 'get_my_creator_premium_commercial_summary_v1', argument_types: ['timestamp with time zone', 'timestamp with time zone'] },
  { schema: 'public', name: 'get_my_creator_premium_financial_history_v1', argument_types: ['text', 'text', 'timestamp with time zone', 'uuid', 'integer'] },
  { schema: 'public', name: 'get_my_creator_premium_subscriptions_v1', argument_types: ['timestamp with time zone', 'uuid', 'integer'] },
  { schema: 'public', name: 'reopen_my_creator_premium_rejected_v1', argument_types: ['uuid'] },
  { schema: 'public', name: 'report_creator_premium_content_v1', argument_types: ['uuid', 'text', 'text'] },
  { schema: 'public', name: 'search_admin_creator_premium_content_v1', argument_types: ['text', 'text', 'timestamp with time zone', 'uuid', 'integer'] },
  { schema: 'public', name: 'search_admin_creator_premium_finance_v1', argument_types: ['text', 'text', 'text', 'timestamp with time zone', 'uuid', 'integer'] },
];

export const RPC_SECURITY_ATTESTATION_SQL = `with requested as (
  select item.schema,item.name,item.argument_types
  from pg_catalog.jsonb_to_recordset($1::jsonb)
    as item(schema text,name text,argument_types jsonb)
),functions as (
  select n.nspname schema,p.proname name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    (select pg_catalog.jsonb_agg(pg_catalog.format_type(arg_oid,null) order by ordinality)
      from pg_catalog.unnest(p.proargtypes::oid[]) with ordinality args(arg_oid,ordinality)) argument_types,
    p.prosecdef security_definer,owner_role.rolname owner,
    coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable
    ) order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee
      where acl.privilege_type='EXECUTE'),'[]'::jsonb) acl,
    pg_catalog.jsonb_build_object(
      'public',exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE'),
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    ) execute,
    pg_catalog.pg_get_functiondef(p.oid) definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
)
select f.schema,f.name,f.identity_arguments,f.argument_types,f.security_definer,
  f.owner,f.search_path,f.acl,f.execute,f.definition
from functions f
join requested r on r.schema=f.schema and r.name=f.name and r.argument_types=f.argument_types
order by f.schema,f.name,f.argument_types::text;`;

export const PREMIUM_POSTCHECK_STATE_SQL = `with relation_rows as (
  select n.nspname schema,c.relname name,owner_role.rolname owner,
    c.relrowsecurity rls_enabled,c.relforcerowsecurity force_rls,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable
    ) order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=c.relowner
  where n.nspname='private' and c.relkind in ('r','p')
    and c.relname like 'creator_premium_%'
)
select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',true,'query_id','nelyon-premium-postcheck-state-v1',
  'approved_rule_count',(select pg_catalog.count(*)::integer from private.content_safety_rules where approval_state='approved'),
  'active_rule_count',(select pg_catalog.count(*)::integer from private.content_safety_rules where approval_state='approved' and enabled=true),
  'fabricated_pass_count',(select pg_catalog.count(*)::integer
    from private.creator_premium_contents content
    where content.verification_status='passed' and not exists(
      select 1 from private.content_safety_scans scan
      where scan.id=content.verification_scan_id
        and scan.target_type='creator_premium' and scan.target_id=content.id
        and scan.content_fingerprint=content.verification_fingerprint
        and scan.status='completed' and scan.completed_at is not null)),
  'content_count',(select pg_catalog.count(*)::integer from private.creator_premium_contents),
  'pending_review_count',(select pg_catalog.count(*)::integer from private.creator_premium_contents where lifecycle_status='pending_review'),
  'deleted_count',(select pg_catalog.count(*)::integer from private.creator_premium_contents where lifecycle_status='deleted'),
  'relations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',schema,'name',name,'owner',owner,'rls_enabled',rls_enabled,
    'force_rls',force_rls,'acl',acl
  ) order by schema,name) from relation_rows),'[]'::jsonb)
) snapshot;`;

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
    'adapter', 'backup', 'complete', 'cron_security', 'evidence_sha256', 'finance', 'functions',
    'health', 'identity', 'migrations', 'observed_at', 'phase', 'premium_state', 'project_ref',
    'requests', 'rpc_security', 'schema_version',
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
    { id: 'nelyon-premium-postcheck-state-v1', sha256: sha256(PREMIUM_POSTCHECK_STATE_SQL) },
    { id: 'nelyon-rpc-security-attestation-v1', sha256: sha256(RPC_SECURITY_ATTESTATION_SQL) },
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
    ['GET', `${base}/database/backups`, 200],
    ['POST', `${base}/database/query/read-only`, 201],
    ['POST', `${base}/database/query/read-only`, 201],
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
  validateNormalizedBackup(evidence.backup, evidence.observed_at, policy.supabase.backup);
  validateNormalizedMigrations(evidence.migrations);
  validateNormalizedFunctions(evidence.functions);
  exactKeys(evidence.cron_security, ['advisors', 'complete', 'cron'], 'INVALID_REMOTE_INVENTORY');
  if (evidence.cron_security.complete !== true) fail('INVALID_REMOTE_INVENTORY', 'cron/security evidence is incomplete');
  validateCronSnapshot(evidence.cron_security.cron);
  validateNormalizedAdvisors(evidence.cron_security.advisors);
  validateFinanceSnapshot(evidence.finance);
  const phaseExceptions = advisorExceptionsForPhase(policy, manifest, phase);
  validateRpcSecuritySnapshot(evidence.rpc_security);
  validateRpcIdentitySet(evidence.rpc_security, phaseExceptions);
  validatePremiumPostcheckState(evidence.premium_state);
  return evidence;
}

function baselineMigrationName(item) {
  return `${item.version}_${item.name}`;
}

function activeManagedScopeTransition({ policy, manifest }) {
  if (policy?.baseline?.sha !== F2_MANAGED_SCOPE_TRANSITION.baseline_sha) return null;
  if (canonicalJson(policy?.managed_scope_transitions) !== canonicalJson([F2_MANAGED_SCOPE_TRANSITION])) {
    fail('REMOTE_BASELINE_MISMATCH', 'managed scope transition is not the exact owner-attested F2 transition');
  }
  const financeOff = {
    platform_fee_bps: 0,
    purchase_enabled: false,
    refunds_enabled: false,
    subscription_enabled: false,
  };
  const migrations = manifest?.resources?.migrations;
  const functions = manifest?.resources?.functions;
  const contracts = manifest?.resources?.function_contracts;
  const expectedMigration = {
    blob: F2_MANAGED_SCOPE_TRANSITION.migration_blob,
    path: `supabase/migrations/${F2_MANAGED_SCOPE_TRANSITION.migration}.sql`,
    version: F2_MANAGED_SCOPE_TRANSITION.migration.slice(0, 14),
  };
  const expectedSourceAttestation = {
    id: F2_MANAGED_SCOPE_TRANSITION.id,
    attested_source_sha: F2_MANAGED_SCOPE_TRANSITION.attested_source_sha,
    approved_sha: manifest?.identity?.approved_sha,
    descendant_verified: true,
    migration_blob: F2_MANAGED_SCOPE_TRANSITION.migration_blob,
  };
  const contract = Array.isArray(contracts) && contracts.length === 1 ? contracts[0] : null;
  if (manifest?.baseline?.sha !== F2_MANAGED_SCOPE_TRANSITION.baseline_sha
    || canonicalJson(migrations) !== canonicalJson([expectedMigration])
    || canonicalJson(functions) !== canonicalJson([F2_MANAGED_SCOPE_TRANSITION.resource])
    || canonicalJson(manifest?.resources?.managed_scope_transition) !== canonicalJson(expectedSourceAttestation)
    || manifest?.resources?.config_changed !== true
    || !contract
    || contract.name !== F2_MANAGED_SCOPE_TRANSITION.resource
    || contract.entrypoint !== 'supabase/functions/bdag-ledger/index.ts'
    || contract.verify_jwt !== true
    || contract.source_changed !== true
    || contract.source_sha256 !== F2_MANAGED_SCOPE_TRANSITION.function_source_sha256
    || !policy?.supabase?.managed_functions?.includes(F2_MANAGED_SCOPE_TRANSITION.resource)
    || canonicalJson(policy?.supabase?.finance_policy) !== canonicalJson(financeOff)) {
    fail('REMOTE_BASELINE_MISMATCH', 'release manifest does not match the exact F2 managed scope transition');
  }
  return F2_MANAGED_SCOPE_TRANSITION;
}

export function buildProductionBaselineDigests({ evidence, policy, managedFunctions }) {
  validateNormalizedMigrations(evidence?.migrations);
  validateNormalizedFunctions(evidence?.functions);
  validateNormalizedAdvisors(evidence?.cron_security?.advisors);
  validateCronSnapshot(evidence?.cron_security?.cron);
  validateFinanceSnapshot(evidence?.finance);
  const managedNames = [...(managedFunctions ?? policy?.supabase?.managed_functions ?? [])].sort();
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
  const attestedRpcIdentities = new Set((evidence.rpc_security?.items ?? []).map(rpcIdentity));
  const deployedExceptionFingerprints = new Set((policy?.security_advisor?.exceptions ?? [])
    .filter(exception => !Array.isArray(exception?.object?.argument_types)
      || attestedRpcIdentities.has(rpcIdentity(exception.object)))
    .map(exception => exception.advisor_fingerprint));
  const historicalAdvisorItems = evidence.cron_security.advisors.items
    .filter(item => !deployedExceptionFingerprints.has(item.fingerprint));
  const cronSecurity = {
    complete: true,
    cron: evidence.cron_security.cron.items,
    security_findings: historicalAdvisorItems,
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
  validateRpcSecurityAttestations(pre.rpc_security, advisorExceptionsForPhase(policy, manifest, 'pre'));
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
  const transition = activeManagedScopeTransition({ policy, manifest });
  const baselineManagedFunctions = transition
    ? policy.supabase.managed_functions.filter(name => name !== transition.resource)
    : policy.supabase.managed_functions;
  const digests = buildProductionBaselineDigests({
    evidence: pre,
    policy,
    managedFunctions: baselineManagedFunctions,
  });
  if (canonicalJson(digests) !== canonicalJson(baseline.evidence_digests)) {
    fail('REMOTE_BASELINE_MISMATCH', 'remote baseline section digests differ from owner-reviewed evidence');
  }
  const observedTransitionResource = transition
    ? pre.functions.items.find(item => item.slug === transition.resource)
    : null;
  if (transition && (!observedTransitionResource
    || observedTransitionResource.status !== 'ACTIVE'
    || observedTransitionResource.verify_jwt !== true)) {
    fail('REMOTE_BASELINE_MISMATCH', 'managed scope transition resource is not active with JWT verification');
  }
  return {
    result: 'REMOTE_BASELINE_VERIFIED',
    evidence_sha256: pre.evidence_sha256,
    evidence_digests: digests,
    managed_scope_transition: transition ? {
      id: transition.id,
      resource: transition.resource,
      from_classification: transition.from_classification,
      to_classification: transition.to_classification,
      observed_version: observedTransitionResource.version,
      observed_source_sha256: observedTransitionResource.ezbr_sha256,
      requires_postcheck: transition.requires_postcheck,
      requires_separate_baseline_promotion: transition.requires_separate_baseline_promotion,
    } : null,
  };
}

export function verifyProductionSnapshotPair({ pre, post, policy, request, manifest, adapterSourceSha256 }) {
  verifyProductionPreSnapshot({ pre, policy, request, manifest, adapterSourceSha256 });
  validateCapturedEvidence({ evidence: post, phase: 'post', policy, request, manifest, adapterSourceSha256 });
  validateRpcSecurityAttestations(post.rpc_security, advisorExceptionsForPhase(policy, manifest, 'post'));
  validatePremiumStateTransition(pre.premium_state, post.premium_state, manifest);
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
  const preExceptionFingerprints = new Set(
    advisorExceptionsForPhase(policy, manifest, 'pre').map(exception => exception.advisor_fingerprint),
  );
  const introducedExceptions = advisorExceptionsForPhase(policy, manifest, 'post')
    .filter(exception => !preExceptionFingerprints.has(exception.advisor_fingerprint));
  validateSecurityAdvisorDelta(
    pre.cron_security.advisors.items,
    post.cron_security.advisors.items,
    introducedExceptions,
  );
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

export function verifyProductionRecoverySnapshot({ recovery, policy, request, manifest, adapterSourceSha256 }) {
  validateCapturedEvidence({
    evidence: recovery,
    phase: 'recovery',
    policy,
    request,
    manifest,
    adapterSourceSha256,
  });
  validateRpcSecurityAttestations(recovery.rpc_security, policy?.security_advisor?.exceptions);
  validatePremiumPostcheckState(recovery.premium_state);
  return {
    result: 'RECOVERY_SNAPSHOT_VERIFIED',
    evidence_sha256: recovery.evidence_sha256,
    rpc_security_sha256: recovery.rpc_security.sha256,
    premium_state_sha256: recovery.premium_state.sha256,
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

function validateNormalizedBackup(backup, observedAt, backupPolicy) {
  exactKeys(backup, ['id', 'inserted_at', 'is_physical_backup', 'status'], 'INVALID_BACKUP');
  const observed = Date.parse(observedAt);
  const inserted = Date.parse(backup.inserted_at);
  if (typeof backup.id !== 'string' || backup.id.length === 0
    || backup.status !== backupPolicy?.required_status
    || backup.is_physical_backup !== backupPolicy?.require_physical
    || !Number.isFinite(observed) || !Number.isFinite(inserted)) {
    fail('INVALID_BACKUP', 'backup evidence does not satisfy the production policy');
  }
  const ageSeconds = (observed - inserted) / 1000;
  if (ageSeconds > backupPolicy.max_age_seconds) fail('STALE_BACKUP', 'latest completed physical backup is stale');
  if (ageSeconds < -60) fail('INVALID_BACKUP', 'backup timestamp is unexpectedly in the future');
  return backup;
}

export function selectRecentCompletedBackup(body, observedAt, backupPolicy) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.backups)) {
    fail('INVALID_BACKUP', 'backup inventory is invalid');
  }
  const eligible = body.backups
    .filter(item => item?.status === backupPolicy?.required_status
      && item?.is_physical_backup === backupPolicy?.require_physical
      && Number.isFinite(Date.parse(item?.inserted_at)))
    .sort((left, right) => Date.parse(right.inserted_at) - Date.parse(left.inserted_at));
  if (eligible.length === 0) fail('INVALID_BACKUP', 'no completed physical backup is available');
  const latest = eligible[0];
  const normalized = {
    id: String(latest.id ?? ''),
    inserted_at: new Date(latest.inserted_at).toISOString(),
    is_physical_backup: latest.is_physical_backup,
    status: latest.status,
  };
  return validateNormalizedBackup(normalized, observedAt, backupPolicy);
}

function stableAdvisorMetadata(value) {
  if (Array.isArray(value)) return value.map(stableAdvisorMetadata);
  if (!value || typeof value !== 'object') return value;
  const volatile = new Set(['created_at', 'detected_at', 'first_seen_at', 'last_seen_at', 'observed_at', 'updated_at']);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !volatile.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableAdvisorMetadata(item)]));
}

function stableAdvisorValue(lint) {
  const stable = {};
  for (const key of ['cache_key', 'categories', 'facing', 'level', 'metadata', 'name']) {
    if (Object.hasOwn(lint ?? {}, key)) stable[key] = stableAdvisorMetadata(lint[key]);
  }
  return stable;
}

export function normalizeSecurityAdvisors(body) {
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

function migrationIdentity(item) {
  const path = typeof item?.path === 'string' ? item.path.replaceAll('\\', '/') : '';
  const filename = path.split('/').at(-1) ?? '';
  if (/^20[0-9]{12}_[a-z0-9_]+\.sql$/.test(filename)) return filename.slice(0, -4);
  if (/^20[0-9]{12}$/.test(item?.version ?? '') && typeof item?.name === 'string') {
    return `${item.version}_${item.name}`;
  }
  return null;
}

const RPC_REPLACEMENT_PREDECESSOR_ATTESTATIONS = new Map([
  ...[
    ['f9c25bdf8e5c7f7ff7385410370dac9fe2ded1a0468f76d8bd2d265186718f32', '30c9a4a75712f74d3d62a39f962f87ce98f22269dd1b46b259b1d15ef89d7e86'],
    ['ed55682047d682b69c66430b68fc819fb781b7289539fa398fadf09ec0c064fc', '1a34a92abe226cdb66b3d8ba95b848d7576fe81e324839c9424582dc44610d05'],
    ['cf4b6520e9c96170ea5a5125f287b991d15c377e80cf3394f879dc1cbad0e6ae', 'dddaf6f218f2abe7a24d97dfdd4fc0cb125fed5b7e2088c510bd4f8368124685'],
    ['b0cdd5e8a440096ebc6bbd35fee9b785180d71ae6d06209ade7feaa6c0877c4d', '10a91f4a47efeda414aa7ed7d1ceed81fff971f6eb5009e4f2bfc4f2acbb78d9'],
  ].map(([fingerprint, definition_sha256]) => [
    `20261024173500_creator_premium_f2_complete_monetization|${fingerprint}`,
    {
      security_definer: true,
      owner: 'postgres',
      search_path: ['search_path=""'],
      acl: [
        { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ],
      execute: { anon: false, authenticated: true, public: false, service_role: false },
      definition_sha256,
    },
  ]),
  [
    '20261020030515_creator_premium_p3_c2_admin_restriction_recovery|b5ca8be9cf9433a21ee7f19906d8a23340ef629d6cedd414c196b431ab5dfaf1',
    {
      security_definer: true,
      owner: 'postgres',
      search_path: ['search_path=""'],
      acl: [
        { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ],
      execute: { anon: false, authenticated: true, public: false, service_role: false },
      definition_sha256: '2a91f72e122beeee0f3d3c9f59ef99f13d2aefab9bcbc987594a5ac43c40a47e',
    },
  ],
  [
    '20261019023431_creator_premium_f1_c4_final_recovery|5ceb93fa71004f64ba75a7bd251fadaf66d7ebdce81fb48904fd988ed9023fef',
    {
      security_definer: true,
      owner: 'postgres',
      search_path: ['search_path=""'],
      acl: [
        { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ],
      execute: { anon: false, authenticated: true, public: false, service_role: false },
      definition_sha256: '40cbc02821cceb68cdd5a31cfd531d9ec8f537d36c47acb1fc7fcafd0df42ed3',
    },
  ],
  [
    '20261019170853_creator_premium_f1_c6_submit_unavailable_mapping_recovery|1c20753b55dcdb2d0a8e6a3365fcf45453495a74a49d76b9b51af4e51d7b923f',
    {
      security_definer: true,
      owner: 'postgres',
      search_path: ['search_path=""'],
      acl: [
        { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ],
      execute: { anon: false, authenticated: true, public: false, service_role: false },
      definition_sha256: '7e3e9f176c216fd35bd9dc4fe00b7d577558265afe2f884630d53747737f02ee',
    },
  ],
]);

export function advisorExceptionsForPhase(policy, manifest, phase) {
  if (!['pre', 'post', 'recovery'].includes(phase)) fail('INVALID_SNAPSHOT_IDENTITY', 'phase must be pre, post, or recovery');
  const exceptions = policy?.security_advisor?.exceptions;
  if (!Array.isArray(exceptions)) fail('RPC_SECURITY_ATTESTATION_FAILED', 'Security Advisor exceptions are unavailable');
  if (phase !== 'pre') return [...exceptions];
  const pendingMigrations = new Set((manifest?.resources?.migrations ?? []).map(migrationIdentity).filter(Boolean));
  return exceptions.flatMap(exception => {
    if (!pendingMigrations.has(exception?.origin?.migration)) return [exception];
    const predecessor = RPC_REPLACEMENT_PREDECESSOR_ATTESTATIONS.get(
      `${exception.origin.migration}|${exception.advisor_fingerprint}`,
    );
    return predecessor ? [{ ...exception, attestation: predecessor }] : [];
  });
}

function rpcIdentitiesFromExceptions(exceptions) {
  return exceptions.filter(exception => Array.isArray(exception?.object?.argument_types)).map(exception => ({
    schema: exception?.object?.schema,
    name: exception?.object?.name,
    argument_types: exception?.object?.argument_types,
  }));
}

export function validateSecurityAdvisorDelta(preItems, postItems, allowedIntroducedExceptions) {
  const before = new Set((preItems ?? []).map(item => item?.fingerprint));
  const after = new Set((postItems ?? []).map(item => item?.fingerprint));
  if (before.size !== (preItems ?? []).length || after.size !== (postItems ?? []).length) {
    fail('REMOTE_POSTCHECK_FAILED', 'security advisor evidence contains duplicate fingerprints');
  }
  const introduced = [...after].filter(fingerprint => !before.has(fingerprint)).sort();
  const allowed = [...(allowedIntroducedExceptions ?? [])]
    .map(exception => exception?.advisor_fingerprint)
    .filter(fingerprint => !before.has(fingerprint))
    .sort();
  if (canonicalJson(introduced) !== canonicalJson(allowed)) {
    fail('REMOTE_POSTCHECK_FAILED', 'release Security Advisor delta differs from the exact approved exception set');
  }
  return true;
}

function normalizeAcl(value, code) {
  if (!Array.isArray(value)) fail(code, 'ACL evidence must be an array');
  const items = value.map(item => {
    exactKeys(item, ['grantee', 'is_grantable', 'privilege_type'], code);
    if (typeof item.grantee !== 'string' || item.grantee.length === 0
      || typeof item.privilege_type !== 'string' || item.privilege_type.length === 0
      || typeof item.is_grantable !== 'boolean') {
      fail(code, 'ACL entry is incomplete');
    }
    return {
      grantee: item.grantee,
      privilege_type: item.privilege_type,
      is_grantable: item.is_grantable,
    };
  }).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  if (new Set(items.map(item => canonicalJson(item))).size !== items.length) fail(code, 'ACL entries are duplicate');
  return items;
}

function rpcIdentity(item) {
  return `${item.schema}.${item.name}(${item.argument_types.join(',')})`;
}

function validateRpcSecuritySnapshot(snapshot) {
  exactKeys(snapshot, ['complete', 'count', 'items', 'sha256'], 'RPC_SECURITY_ATTESTATION_FAILED');
  if (snapshot.complete !== true || !Number.isInteger(snapshot.count) || snapshot.count < 1
    || !Array.isArray(snapshot.items) || snapshot.items.length !== snapshot.count
    || snapshot.sha256 !== sha256(canonicalJson(snapshot.items))) {
    fail('RPC_SECURITY_ATTESTATION_FAILED', 'RPC security snapshot is incomplete');
  }
  const identities = [];
  for (const item of snapshot.items) {
    exactKeys(item, [
      'acl', 'argument_types', 'definition_sha256', 'execute', 'identity_arguments',
      'name', 'owner', 'schema', 'search_path', 'security_definer',
    ], 'RPC_SECURITY_ATTESTATION_FAILED');
    exactKeys(item.execute, ['anon', 'authenticated', 'public', 'service_role'], 'RPC_SECURITY_ATTESTATION_FAILED');
    if (item.schema !== 'public' || typeof item.name !== 'string' || item.name.length === 0
      || typeof item.identity_arguments !== 'string' || item.identity_arguments.length === 0
      || !Array.isArray(item.argument_types) || item.argument_types.some(type => typeof type !== 'string' || type.length === 0)
      || item.security_definer !== true || item.owner !== 'postgres'
      || !Array.isArray(item.search_path) || item.search_path.some(setting => typeof setting !== 'string')
      || !HASH_PATTERN.test(item.definition_sha256 ?? '')
      || canonicalJson(item.execute) !== canonicalJson({ public: false, anon: false, authenticated: true, service_role: false })) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'protected RPC authority is unsafe or incomplete');
    }
    normalizeAcl(item.acl, 'RPC_SECURITY_ATTESTATION_FAILED');
    identities.push(rpcIdentity(item));
  }
  if (new Set(identities).size !== identities.length
    || canonicalJson(identities) !== canonicalJson([...identities].sort())) {
    fail('RPC_SECURITY_ATTESTATION_FAILED', 'protected RPC identities are duplicate or unordered');
  }
  return snapshot;
}

export function normalizeRpcSecurityAttestations(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail('RPC_SECURITY_ATTESTATION_FAILED', 'RPC catalog result is empty');
  const items = rows.map(row => {
    exactKeys(row, [
      'acl', 'argument_types', 'definition', 'execute', 'identity_arguments',
      'name', 'owner', 'schema', 'search_path', 'security_definer',
    ], 'RPC_SECURITY_ATTESTATION_FAILED');
    if (typeof row.definition !== 'string' || row.definition.length === 0
      || !Array.isArray(row.argument_types) || !Array.isArray(row.search_path)) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'RPC catalog row is incomplete');
    }
    const execute = { ...row.execute };
    exactKeys(execute, ['anon', 'authenticated', 'public', 'service_role'], 'RPC_SECURITY_ATTESTATION_FAILED');
    const normalizedDefinition = row.definition.replace(/\r\n?/g, '\n');
    return {
      schema: row.schema,
      name: row.name,
      identity_arguments: row.identity_arguments,
      argument_types: [...row.argument_types],
      security_definer: row.security_definer,
      owner: row.owner,
      search_path: [...row.search_path].sort(),
      acl: normalizeAcl(row.acl, 'RPC_SECURITY_ATTESTATION_FAILED'),
      execute,
      definition_sha256: sha256(normalizedDefinition),
    };
  }).sort((left, right) => rpcIdentity(left).localeCompare(rpcIdentity(right)));
  return validateRpcSecuritySnapshot({
    complete: true,
    count: items.length,
    items,
    sha256: sha256(canonicalJson(items)),
  });
}

function validateRpcIdentitySet(snapshot, exceptions) {
  const expected = rpcIdentitiesFromExceptions(exceptions)
    .map(item => `${item.schema}.${item.name}(${item.argument_types.join(',')})`)
    .sort();
  const actual = snapshot.items.map(rpcIdentity);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail('RPC_SECURITY_ATTESTATION_FAILED', 'RPC catalog does not match the exact phase-approved identity set');
  }
  return true;
}

export function validateRpcSecurityAttestations(snapshot, exceptions) {
  const rpcExceptions = (exceptions ?? []).filter(exception => Array.isArray(exception?.object?.argument_types));
  validateRpcSecuritySnapshot(snapshot);
  validateRpcIdentitySet(snapshot, rpcExceptions);
  if (!Array.isArray(exceptions) || rpcExceptions.length !== snapshot.items.length) {
    fail('RPC_SECURITY_ATTESTATION_FAILED', 'exception set does not match the RPC attestation set');
  }
  const expectedItems = rpcExceptions.map(exception => {
    if (!exception?.object || !exception?.attestation) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'exception attestation is incomplete');
    }
    exactKeys(exception.object, ['argument_types', 'identity_arguments', 'name', 'schema'], 'RPC_SECURITY_ATTESTATION_FAILED');
    exactKeys(exception.attestation, [
      'acl', 'definition_sha256', 'execute', 'owner', 'search_path', 'security_definer',
    ], 'RPC_SECURITY_ATTESTATION_FAILED');
    return {
      schema: exception.object.schema,
      name: exception.object.name,
      identity_arguments: exception.object.identity_arguments,
      argument_types: exception.object.argument_types,
      security_definer: exception.attestation.security_definer,
      owner: exception.attestation.owner,
      search_path: exception.attestation.search_path,
      acl: exception.attestation.acl,
      execute: exception.attestation.execute,
      definition_sha256: exception.attestation.definition_sha256,
    };
  }).sort((left, right) => rpcIdentity(left).localeCompare(rpcIdentity(right)));
  if (canonicalJson(snapshot.items) !== canonicalJson(expectedItems)) {
    fail('RPC_SECURITY_ATTESTATION_FAILED', 'fresh RPC authority differs from the approved exception attestation');
  }
  return true;
}

function normalizeRelationSecurity(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail('PREMIUM_POSTCHECK_FAILED', 'relation security inventory is empty');
  const items = rows.map(row => {
    exactKeys(row, ['acl', 'force_rls', 'name', 'owner', 'rls_enabled', 'schema'], 'PREMIUM_POSTCHECK_FAILED');
    if (row.schema !== 'private' || typeof row.name !== 'string' || !row.name.startsWith('creator_premium_')
      || typeof row.owner !== 'string' || typeof row.rls_enabled !== 'boolean' || typeof row.force_rls !== 'boolean') {
      fail('PREMIUM_POSTCHECK_FAILED', 'relation security row is incomplete');
    }
    return {
      schema: row.schema,
      name: row.name,
      owner: row.owner,
      rls_enabled: row.rls_enabled,
      force_rls: row.force_rls,
      acl: normalizeAcl(row.acl, 'PREMIUM_POSTCHECK_FAILED'),
    };
  }).sort((left, right) => `${left.schema}.${left.name}`.localeCompare(`${right.schema}.${right.name}`));
  if (new Set(items.map(item => `${item.schema}.${item.name}`)).size !== items.length) {
    fail('PREMIUM_POSTCHECK_FAILED', 'relation security identities are duplicate');
  }
  return { items, sha256: sha256(canonicalJson(items)) };
}

export function normalizePremiumPostcheckState(snapshot) {
  exactKeys(snapshot, [
    'active_rule_count', 'approved_rule_count', 'complete', 'content_count', 'deleted_count',
    'fabricated_pass_count', 'pending_review_count', 'query_id', 'relations', 'schema_version',
  ], 'PREMIUM_POSTCHECK_FAILED');
  if (snapshot.schema_version !== 1 || snapshot.complete !== true
    || snapshot.query_id !== 'nelyon-premium-postcheck-state-v1') {
    fail('PREMIUM_POSTCHECK_FAILED', 'Premium postcheck snapshot identity is invalid');
  }
  const unsigned = {
    complete: true,
    content_safety: {
      approved_rule_count: snapshot.approved_rule_count,
      active_rule_count: snapshot.active_rule_count,
      fabricated_pass_count: snapshot.fabricated_pass_count,
    },
    legacy: {
      content_count: snapshot.content_count,
      pending_review_count: snapshot.pending_review_count,
      deleted_count: snapshot.deleted_count,
    },
    relation_security: normalizeRelationSecurity(snapshot.relations),
  };
  return { ...unsigned, sha256: sha256(canonicalJson(unsigned)) };
}

export function validatePremiumPostcheckState(state, expectedRelations = null) {
  exactKeys(state, ['complete', 'content_safety', 'legacy', 'relation_security', 'sha256'], 'PREMIUM_POSTCHECK_FAILED');
  const { sha256: claimed, ...unsigned } = state;
  if (state.complete !== true || claimed !== sha256(canonicalJson(unsigned))) {
    fail('PREMIUM_POSTCHECK_FAILED', 'Premium postcheck digest is invalid');
  }
  exactKeys(state.content_safety, ['active_rule_count', 'approved_rule_count', 'fabricated_pass_count'], 'PREMIUM_POSTCHECK_FAILED');
  exactKeys(state.legacy, ['content_count', 'deleted_count', 'pending_review_count'], 'PREMIUM_POSTCHECK_FAILED');
  const { content_count: contentCount, pending_review_count: pendingReviewCount, deleted_count: deletedCount } = state.legacy;
  if (canonicalJson(state.content_safety) !== canonicalJson({
    approved_rule_count: 0, active_rule_count: 0, fabricated_pass_count: 0,
  }) || ![contentCount, pendingReviewCount, deletedCount].every(Number.isInteger)
    || [contentCount, pendingReviewCount, deletedCount].some(value => value < 0)
    || contentCount < 2 || deletedCount < 1
    || pendingReviewCount + deletedCount > contentCount) {
    fail('PREMIUM_POSTCHECK_FAILED', 'Content Safety or legacy Premium state diverged');
  }
  exactKeys(state.relation_security, ['items', 'sha256'], 'PREMIUM_POSTCHECK_FAILED');
  const normalized = normalizeRelationSecurity(state.relation_security.items);
  if (state.relation_security.sha256 !== normalized.sha256
    || normalized.items.some(item => item.owner !== 'postgres' || item.rls_enabled !== true
      || item.force_rls !== true || item.acl.length === 0)) {
    fail('PREMIUM_POSTCHECK_FAILED', 'private Premium relation authority is unsafe');
  }
  if (expectedRelations !== null && canonicalJson(normalized.items) !== canonicalJson(expectedRelations)) {
    fail('PREMIUM_POSTCHECK_FAILED', 'private Premium relation authority differs from the approved evidence');
  }
  return true;
}

export function validatePremiumStateTransition(preState, postState, manifest = null) {
  validatePremiumPostcheckState(preState);
  validatePremiumPostcheckState(postState);
  if (canonicalJson(postState.legacy) !== canonicalJson(preState.legacy)) {
    fail('PREMIUM_POSTCHECK_FAILED', 'Premium content counts or relation authority changed during release');
  }
  const approvedRelationAdditions = new Map([
    [
      '20261018170000|supabase/migrations/20261018170000_creator_premium_content_safety_p2_evidence_runtime.sql',
      ['private.creator_premium_content_safety_context_evaluations'],
    ],
  ]);
  const manifestMigrationKeys = (manifest?.resources?.migrations ?? []).map(item => (
    `${item?.version ?? ''}|${String(item?.path ?? '').replaceAll('\\', '/')}`
  ));
  const allowedAddedIdentities = manifestMigrationKeys
    .flatMap(key => approvedRelationAdditions.get(key) ?? []).sort();
  const before = new Map(preState.relation_security.items.map(item => [`${item.schema}.${item.name}`, item]));
  const after = new Map(postState.relation_security.items.map(item => [`${item.schema}.${item.name}`, item]));
  const removed = [...before.keys()].filter(identity => !after.has(identity)).sort();
  const changed = [...before.entries()]
    .filter(([identity, item]) => after.has(identity) && canonicalJson(after.get(identity)) !== canonicalJson(item))
    .map(([identity]) => identity).sort();
  const added = [...after.keys()].filter(identity => !before.has(identity)).sort();
  if (removed.length !== 0 || changed.length !== 0
    || canonicalJson(added) !== canonicalJson(allowedAddedIdentities)) {
    fail('PREMIUM_POSTCHECK_FAILED', 'Premium content counts or relation authority changed during release');
  }
  return true;
}

function validateIdentity({ phase, policy, request, manifest, token, observedAt, adapterSourceSha256 }) {
  if (!['pre', 'post', 'recovery'].includes(phase)) fail('INVALID_SNAPSHOT_IDENTITY', 'phase must be pre, post, or recovery');
  if (policy?.supabase?.project_ref !== PRODUCTION_PROJECT_REF) fail('INVALID_SNAPSHOT_IDENTITY', 'unexpected production project');
  if (typeof token !== 'string' || token.length < 1) fail('MISSING_SNAPSHOT_TOKEN', 'snapshot token is unavailable');
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
  assertReadOnlySql(RPC_SECURITY_ATTESTATION_SQL);
  assertReadOnlySql(PREMIUM_POSTCHECK_STATE_SQL);
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
  const backupsBody = await get(`${base}/database/backups`, 'database backups');
  const financeBody = await sql(
    FINANCE_SNAPSHOT_SQL,
    [identity.release_id, identity.run_id],
    'finance snapshot',
  );
  const cronBody = await sql(CRON_SNAPSHOT_SQL, null, 'cron snapshot');
  const phaseExceptions = advisorExceptionsForPhase(policy, manifest, phase);
  const rpcSecurityBody = await sql(
    RPC_SECURITY_ATTESTATION_SQL,
    [JSON.stringify(rpcIdentitiesFromExceptions(phaseExceptions))],
    'RPC security attestation',
  );
  const premiumStateBody = await sql(PREMIUM_POSTCHECK_STATE_SQL, null, 'Premium postcheck state');
  const rpcSecurity = normalizeRpcSecurityAttestations(rpcSecurityBody);
  validateRpcIdentitySet(rpcSecurity, phaseExceptions);
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
        { id: 'nelyon-premium-postcheck-state-v1', sha256: sha256(PREMIUM_POSTCHECK_STATE_SQL) },
        { id: 'nelyon-rpc-security-attestation-v1', sha256: sha256(RPC_SECURITY_ATTESTATION_SQL) },
      ],
    },
    observed_at: new Date(observedAt).toISOString(),
    health: normalizeHealth(healthBody),
    backup: selectRecentCompletedBackup(backupsBody, observedAt, policy.supabase.backup),
    migrations: normalizeMigrations(migrationsBody),
    functions: normalizeFunctions(functionsBody),
    cron_security: {
      complete: true,
      cron: singleSnapshot(cronBody, validateCronSnapshot, 'cron snapshot'),
      advisors: normalizeSecurityAdvisors(advisorsBody),
    },
    finance: singleSnapshot(financeBody, validateFinanceSnapshot, 'finance snapshot'),
    rpc_security: rpcSecurity,
    premium_state: singleSnapshot(premiumStateBody, normalizePremiumPostcheckState, 'Premium postcheck state'),
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
    token: process.env.SUPABASE_ACCESS_TOKEN,
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

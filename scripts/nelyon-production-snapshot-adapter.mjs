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

// A single digest vector binds the finance policy in both the compiler and the
// snapshot adapter. Keeping it here prevents the two release authorities from
// accepting different catalogs during the same deployment.
export const FINANCE_POLICY_DIGESTS = Object.freeze({
  historical_transition: '18ba08389686a15aea9df1c7b4f974202e147167e5aa1d0f83412e1065ebc882',
  c2_transition: '2fc5ae800bf96aed59d78b953cfe628007f9603b48dd8e7a25dc915e88927af2',
  f4_transition: 'de7891ab96cd95280a5d1e80ad56b8411045b66bb54e71f610874f4cc280e36a',
  f5_transition: '3829cb90de13c8aece7b40f6d70364f02635a79163d32668229382665a83d051',
  authority: '64fc55b66c681bb901dd79e610a33cd3dc689a330a65c88c4a8619bc9b668fbf',
  security_advisor: '9cb8e8f25c4311553c2e4e30139c45f53c8472b1ff374af8d6a95f9a289ca096',
});

export const F5_SECURITY_ADVISOR_RELATION_ADDITIONS = Object.freeze([
  Object.freeze({
    advisor_fingerprint: '70d2706125a8861824f9c876848c472a28bde6db0813543ba97ec3409516967f',
    advisor_type: 'table',
    advisor_severity: 'INFO',
    object: Object.freeze({
      schema: 'private',
      name: 'creator_premium_auto_renewal_attempts',
    }),
  }),
  Object.freeze({
    advisor_fingerprint: 'd37d10aa8c56fc907ce6ce86f44aafcb36f8bd6c7d719cc33032fe1561eee56d',
    advisor_type: 'table',
    advisor_severity: 'INFO',
    object: Object.freeze({
      schema: 'private',
      name: 'creator_premium_auto_renewal_mandates',
    }),
  }),
]);

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

// Catalog-only: safe on either side of F3. No mutable row or count enters this authority.
// PostgreSQL deparsers consult search_path. Pin it inside the statement so identical
// catalogs cannot hash differently between Management API and disposable replay roles.
export const FINANCE_AUTHORITY_SQL = `with recursive authority_context as materialized (
  select pg_catalog.set_config('search_path','pg_catalog, public, extensions',true) search_path
), relations as (
  select c.oid,c.relowner,n.nspname schema,c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls
  from authority_context context
  cross join pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where context.search_path is not null and c.relkind in ('r','p') and ((n.nspname='private' and c.relname in (
    'creator_premium_finance_policy','creator_premium_finance_authorizations',
    'creator_premium_finance_owner_attestations_f3_c2',
    'creator_premium_auto_renewal_attempts','creator_premium_auto_renewal_mandates',
    'creator_premium_purchase_receipts','creator_premium_subscription_periods','creator_premium_subscriptions'))
    or (n.nspname='public' and c.relname in ('financial_transactions','ledger_accounts','ledger_entries')))
), relation_rows as (
  select schema||'.'||name identity,pg_catalog.jsonb_build_object(
    'owner',pg_catalog.pg_get_userbyid(r.relowner),'rls',rls,'force_rls',force_rls,
    'acl',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
      a.privilege_type,a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
      from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',r.relowner))) a),'[]'::jsonb),
    'columns',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attacl::text) order by a.attnum)
      from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
    'constraints',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      x.conname,x.contype,x.convalidated,x.condeferrable,x.condeferred,pg_catalog.pg_get_constraintdef(x.oid,true)) order by x.conname)
      from pg_catalog.pg_constraint x where x.conrelid=r.oid),'[]'::jsonb),
    'fk_enforcement',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      source_namespace.nspname,source_relation.relname,fk.conname,
      target_namespace.nspname,target_relation.relname,trigger_namespace.nspname,trigger_relation.relname,
      enforcement.tgtype,function_namespace.nspname,trigger_function.proname,enforcement.tgenabled,
      enforcement.tgisinternal,enforcement.tgdeferrable,enforcement.tginitdeferred,
      enforcement.tgnargs,pg_catalog.encode(enforcement.tgargs,'hex'),enforcement.tgattr::text,
      pg_catalog.pg_get_expr(enforcement.tgqual,enforcement.tgrelid),enforcement.tgparentid<>0)
      order by source_namespace.nspname,source_relation.relname,fk.conname,
        target_namespace.nspname,target_relation.relname,trigger_namespace.nspname,trigger_relation.relname,
        enforcement.tgtype,function_namespace.nspname,trigger_function.proname)
      from pg_catalog.pg_constraint fk
      join pg_catalog.pg_class source_relation on source_relation.oid=fk.conrelid
      join pg_catalog.pg_namespace source_namespace on source_namespace.oid=source_relation.relnamespace
      join pg_catalog.pg_class target_relation on target_relation.oid=fk.confrelid
      join pg_catalog.pg_namespace target_namespace on target_namespace.oid=target_relation.relnamespace
      join pg_catalog.pg_trigger enforcement on enforcement.tgconstraint=fk.oid
      join pg_catalog.pg_class trigger_relation on trigger_relation.oid=enforcement.tgrelid
      join pg_catalog.pg_namespace trigger_namespace on trigger_namespace.oid=trigger_relation.relnamespace
      join pg_catalog.pg_proc trigger_function on trigger_function.oid=enforcement.tgfoid
      join pg_catalog.pg_namespace function_namespace on function_namespace.oid=trigger_function.pronamespace
      where fk.contype='f' and (fk.conrelid=r.oid or fk.confrelid=r.oid)
        and (r.schema='private' or fk.conrelid not in (select oid from relations where schema='private'))),'[]'::jsonb),
    'indexes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      pg_catalog.pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indisunique,i.indisreplident) order by pg_catalog.pg_get_indexdef(i.indexrelid))
      from pg_catalog.pg_index i where i.indrelid=r.oid),'[]'::jsonb),
    'triggers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid,true)) order by t.tgname)
      from pg_catalog.pg_trigger t where t.tgrelid=r.oid and not t.tgisinternal),'[]'::jsonb),
    'policies',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
      p.polname,p.polcmd,p.polpermissive,(select pg_catalog.jsonb_agg(v::regrole::text order by v::regrole::text)
        from pg_catalog.unnest(p.polroles) v),pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname)
      from pg_catalog.pg_policy p where p.polrelid=r.oid),'[]'::jsonb)) authority
  from relations r join pg_catalog.pg_class c on c.oid=r.oid
), function_seeds as (
  select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('private','public') and p.prokind='f' and p.proname like '%creator_premium%'
    and p.proname ~ '(finance|financial|charge|refund|purchase|period|subscription|subscribe|commerce|commercial|authorization|renewal)'
  union
  select trigger.tgfoid from relations relation
  join pg_catalog.pg_trigger trigger on trigger.tgrelid=relation.oid and not trigger.tgisinternal
  where relation.oid=pg_catalog.to_regclass('private.creator_premium_finance_owner_attestations_f3_c2')
), function_closure(oid) as (
  select oid from function_seeds
  union
  select dependency.oid from function_closure parent
  cross join lateral pg_catalog.regexp_matches(pg_catalog.pg_get_functiondef(parent.oid),
    '(private|public)[.]([a-z_][a-z0-9_]*)[[:space:]]*[(]','g') called(parts)
  join pg_catalog.pg_namespace namespace on namespace.nspname=called.parts[1]
  join pg_catalog.pg_proc dependency on dependency.pronamespace=namespace.oid and dependency.proname=called.parts[2]
    and dependency.prokind='f'
), function_rows as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' identity,
    pg_catalog.jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),
      'owner',pg_catalog.pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
      'search_path',coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb),
      'acl',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
        a.privilege_type,a.is_grantable) order by a.grantee::regrole::text,a.privilege_type)
        from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb),
      'execute',pg_catalog.jsonb_build_array(pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
        pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'))) authority
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join function_closure selected on selected.oid=p.oid
)
select pg_catalog.jsonb_build_object('schema_version',1,'complete',true,
  'relations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('identity',identity,'authority',authority) order by identity) from relation_rows),'[]'::jsonb),
  'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('identity',identity,'authority',authority) order by identity) from function_rows),'[]'::jsonb)) snapshot;`;

// Identity values are one-way digests; amounts retain PostgreSQL exact decimal text.
// Full immutable rows are hashed as a binding in addition to explicit fact fields.
export const FINANCE_FACTS_F3_SQL = `with facts as (
  select 'authorizations' kind,pg_catalog.to_jsonb(a) fact from private.creator_premium_finance_authorizations a
  union all select 'receipts',pg_catalog.to_jsonb(r) from private.creator_premium_purchase_receipts r
  union all select 'periods',pg_catalog.to_jsonb(p) from private.creator_premium_subscription_periods p
  union all select 'subscriptions',pg_catalog.to_jsonb(s) from private.creator_premium_subscriptions s
  union all select 'transactions',pg_catalog.to_jsonb(t) from public.financial_transactions t
    where t.reference_type like 'creator_premium%' or t.operation_type like 'creator_premium%'
), sanitized as (
  select kind,pg_catalog.jsonb_object_agg(key,case
    when key='id' or key like '%_id' then case when value='null'::jsonb then value else
      pg_catalog.to_jsonb(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(value#>>'{}','UTF8'),'sha256'),'hex')) end
    when key ~ '(amount|bdag)$' then pg_catalog.to_jsonb(value#>>'{}')
    when key like '%_at' or key in ('status','access_state','authorization_scope','client_contract','platform_fee_bps',
      'charge_starts_at','charge_expires_at','refund_expires_at','max_purchase_count','max_subscription_count','max_refund_count') then value
    else pg_catalog.to_jsonb(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(value::text,'UTF8'),'sha256'),'hex')) end
    order by key)||pg_catalog.jsonb_build_object('fact_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(fact::text,'UTF8'),'sha256'),'hex')) item
  from facts cross join lateral pg_catalog.jsonb_each(fact) group by kind,fact
)
select pg_catalog.jsonb_build_object('schema_version',1,'complete',true,'phase','f3_foundation',
  'policy',(select pg_catalog.jsonb_build_object('purchase_enabled',p.purchase_enabled,
    'subscription_enabled',p.subscription_enabled,'refunds_enabled',p.refunds_enabled,'platform_fee_bps',p.platform_fee_bps,
    'activation_mode',pg_catalog.to_jsonb(p)->'activation_mode','active_authorization_id',pg_catalog.to_jsonb(p)->'active_authorization_id')
    from private.creator_premium_finance_policy p),
  'authorizations',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='authorizations'),'[]'::jsonb),
  'receipts',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='receipts'),'[]'::jsonb),
  'periods',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='periods'),'[]'::jsonb),
  'subscriptions',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='subscriptions'),'[]'::jsonb),
  'transactions',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='transactions'),'[]'::jsonb),
  'acquisition_exposure_bdag',((select coalesce(sum((fact->>'gross_amount_bdag')::numeric),0) from facts where kind in ('receipts','periods'))::numeric(30,8))::text,
  'release_movement_bdag',((select coalesce(sum(abs((fact->>'amount')::numeric)),0) from facts
    where kind='transactions' and (($1::text<>'' and pg_catalog.strpos(fact::text,$1::text)>0)
      or ($2::text<>'' and pg_catalog.strpos(fact::text,$2::text)>0)))::numeric(30,8))::text,
  'reconciliation',pg_catalog.jsonb_build_object(
    'purchase_binding_mismatches',(select pg_catalog.count(*)::integer from facts where kind='receipts'),
    'period_binding_mismatches',(select pg_catalog.count(*)::integer from facts where kind='periods'))) snapshot;`;

export const FINANCE_FACTS_F3_C2_SQL = FINANCE_FACTS_F3_SQL
  .replace("select 'authorizations' kind,pg_catalog.to_jsonb(a) fact from private.creator_premium_finance_authorizations a",
    "select 'attestations' kind,pg_catalog.to_jsonb(o) fact from private.creator_premium_finance_owner_attestations_f3_c2 o\n  union all select 'authorizations',pg_catalog.to_jsonb(a) from private.creator_premium_finance_authorizations a")
  .replace("'phase','f3_foundation'", "'phase','f3_c2'")
  .replace("'authorizations',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='authorizations'),'[]'::jsonb),",
    "'attestations',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='attestations'),'[]'::jsonb),\n  'authorizations',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='authorizations'),'[]'::jsonb),");

// F4 runs through the Management API read-only role. Reconcile the same complete
// accounting contract as creator_premium_financial_fact_is_valid_v1 without
// granting the read-only role EXECUTE on a private SECURITY DEFINER helper.
function canonicalFinanceFieldSql(key, valueSql) {
  return `('${key}:'||pg_catalog.octet_length(pg_catalog.convert_to((${valueSql})::text,'UTF8'))::text||':'||(${valueSql})::text)`;
}

function canonicalFinancePayloadSql(fields) {
  return fields.map(([key, valueSql]) => canonicalFinanceFieldSql(key, valueSql)).join("||E'\\n'||");
}

const F4_GENERAL_CONFIGURATION_PAYLOAD_SQL = canonicalFinancePayloadSql([
  ['domain', "'creator-premium-f4-general-configuration-v1'"],
  ['id', 'envelope.id::text'],
  ['authorization_scope', 'envelope.authorization_scope'],
  ['client_contract', 'envelope.client_contract'],
  ['platform_account_id', 'envelope.platform_account_id::text'],
  ['platform_fee_bps', 'envelope.platform_fee_bps::text'],
  ['charge_starts_at', "(extract(epoch from envelope.charge_starts_at)*1000000)::bigint::text"],
  ['purchase_enabled', "'true'"],
  ['subscription_enabled', "'true'"],
  ['refunds_enabled', "'true'"],
]);

const F4_CANARY_CONFIGURATION_PAYLOAD_SQL = canonicalFinancePayloadSql([
  ['domain', "'creator-premium-f3-c2-configuration-v1'"],
  ['id', 'envelope.id::text'],
  ['client_contract', 'envelope.client_contract'],
  ['buyer_id', 'envelope.buyer_id::text'],
  ['creator_id', 'envelope.creator_id::text'],
  ['buyer_account_id', 'envelope.buyer_account_id::text'],
  ['creator_account_id', 'envelope.creator_account_id::text'],
  ['platform_account_id', 'envelope.platform_account_id::text'],
  ['purchase_content_id', 'envelope.purchase_content_id::text'],
  ['purchase_offer_version_id', 'envelope.purchase_offer_version_id::text'],
  ['subscription_plan_id', 'envelope.subscription_plan_id::text'],
  ['purchase_amount_bdag', 'envelope.purchase_amount_bdag::numeric(38,8)::text'],
  ['subscription_amount_bdag', 'envelope.subscription_amount_bdag::numeric(38,8)::text'],
  ['max_purchase_count', 'envelope.max_purchase_count::text'],
  ['max_subscription_count', 'envelope.max_subscription_count::text'],
  ['max_refund_count', 'envelope.max_refund_count::text'],
  ['max_gross_bdag', 'envelope.max_gross_bdag::numeric(38,8)::text'],
  ['platform_fee_bps', 'envelope.platform_fee_bps::text'],
  ['charge_starts_at', "(extract(epoch from envelope.charge_starts_at)*1000000)::bigint::text"],
  ['charge_expires_at', "(extract(epoch from envelope.charge_expires_at)*1000000)::bigint::text"],
  ['refund_expires_at', "(extract(epoch from envelope.refund_expires_at)*1000000)::bigint::text"],
]);

const F4_ATTESTATION_PAYLOAD_SQL = canonicalFinancePayloadSql([
  ['domain', "'creator-premium-f3-c2-attestation-v1'"],
  ['configuration_digest', 'attestation.configuration_digest'],
  ['approval_reference', 'attestation.approval_reference'],
  ['evidence_digest', 'attestation.evidence_digest'],
  ['repository', 'attestation.repository'],
  ['protected_source_sha', 'attestation.protected_source_sha'],
  ['environment', 'attestation.environment'],
  ['approved_at', "(extract(epoch from attestation.approved_at)*1000000)::bigint::text"],
  ['attestation_version', 'attestation.attestation_version'],
]);

function f4FinancialFactMismatchSql({ table, alias, payerId, payerAccount, referenceType,
  chargeOperation, refundOperation, activeStates, targetId, offerId }) {
  const operationBinding = offerId === null
    ? `${alias}.${targetId} is not null`
    : `${alias}.${targetId} is not null and ${alias}.${offerId} is not null`;
  const canaryOperationBinding = offerId === null
    ? `envelope.subscription_plan_id=${alias}.${targetId}
            and envelope.subscription_amount_bdag=${alias}.gross_amount_bdag`
    : `envelope.purchase_content_id=${alias}.${targetId}
            and envelope.purchase_offer_version_id=${alias}.${offerId}
            and envelope.purchase_amount_bdag=${alias}.gross_amount_bdag`;
  return `(select pg_catalog.count(*)::integer
    from ${table} ${alias}
    left join private.creator_premium_finance_authorizations envelope
      on envelope.id=${alias}.finance_authorization_id
    left join private.creator_premium_finance_owner_attestations_f3_c2 attestation
      on (attestation.approval_digest,attestation.configuration_digest)
        =(envelope.approval_digest,envelope.configuration_digest)
    left join public.financial_transactions original
      on original.id=${alias}.financial_transaction_id
    left join public.financial_transactions reversal
      on reversal.id=${alias}.reversal_financial_transaction_id
    left join public.ledger_accounts payer_account
      on payer_account.id=${alias}.${payerAccount}
    left join public.ledger_accounts creator_account
      on creator_account.id=${alias}.creator_account_id
    left join public.ledger_accounts platform_account
      on platform_account.id=${alias}.platform_account_id
    where not coalesce((
      (((${alias}.finance_authorization_id is null and ${alias}.created_at<(
          select general.created_at from private.creator_premium_finance_authorizations general
          where general.authorization_scope='GENERAL' order by general.created_at limit 1)))
        or (${alias}.finance_authorization_id is not null
          and envelope.configuration_digest=case envelope.authorization_scope
            when 'CANARY' then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
              ${F4_CANARY_CONFIGURATION_PAYLOAD_SQL},'UTF8')),'hex')
            when 'GENERAL' then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
              ${F4_GENERAL_CONFIGURATION_PAYLOAD_SQL},'UTF8')),'hex')
            else null end
          and attestation.approval_digest=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
            ${F4_ATTESTATION_PAYLOAD_SQL},'UTF8')),'hex')
          and attestation.registered_by='postgres'
          and envelope.platform_account_id=${alias}.platform_account_id
          and envelope.platform_fee_bps=${alias}.platform_fee_bps
          and envelope.platform_fee_bps=2000
          and ((envelope.authorization_scope='GENERAL')
            or (envelope.authorization_scope='CANARY'
              and envelope.buyer_id=${alias}.${payerId}
              and envelope.creator_id=${alias}.creator_id
              and envelope.buyer_account_id=${alias}.${payerAccount}
              and envelope.creator_account_id=${alias}.creator_account_id
              and ${canaryOperationBinding}))))
      and ${alias}.access_state in (${activeStates.map(value => `'${value}'`).join(',')},'refunded')
      and ${alias}.${payerId} is not null and ${alias}.creator_id is not null
      and ${alias}.${payerId}<>${alias}.creator_id
      and ${operationBinding}
      and payer_account.owner_id=${alias}.${payerId}
      and payer_account.account_type='user' and payer_account.currency='BDAG'
      and creator_account.owner_id=${alias}.creator_id
      and creator_account.account_type='user' and creator_account.currency='BDAG'
      and platform_account.owner_id is null
      and platform_account.account_type='platform' and platform_account.currency='BDAG'
      and ${alias}.gross_amount_bdag>0 and ${alias}.gross_amount_bdag<=1000000000000
      and ${alias}.creator_net_bdag>0
      and ${alias}.platform_fee_bdag>=0 and ${alias}.platform_fee_bps between 0 and 9999
      and ${alias}.gross_amount_bdag=${alias}.creator_net_bdag+${alias}.platform_fee_bdag
      and ${alias}.platform_fee_bdag=pg_catalog.round(
        ${alias}.gross_amount_bdag*${alias}.platform_fee_bps/10000,8)
      and ${alias}.gross_amount_bdag=pg_catalog.round(${alias}.gross_amount_bdag,8)
      and ${alias}.creator_net_bdag=pg_catalog.round(${alias}.creator_net_bdag,8)
      and ${alias}.platform_fee_bdag=pg_catalog.round(${alias}.platform_fee_bdag,8)
      and original.operation_type='${chargeOperation}'
      and original.reference_type='${referenceType}'
      and original.reference_id=${alias}.id::text
      and original.from_account_id=${alias}.${payerAccount}
      and original.to_account_id=${alias}.creator_account_id
      and original.amount=${alias}.gross_amount_bdag
      and original.fee_amount=${alias}.platform_fee_bdag
      and original.currency='BDAG'
      and original.initiated_by=${alias}.${payerId}
      and original.idempotency_key=${alias}.idempotency_key::text
      and original.status=case when ${alias}.access_state='refunded' then 'reversed' else 'completed' end
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id)=case when ${alias}.platform_fee_bdag=0 then 2 else 3 end
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id and entry.account_id=${alias}.${payerAccount}
          and entry.entry_type='debit' and entry.amount=${alias}.gross_amount_bdag
          and entry.metadata->>'fin_txn_id'=original.id::text
          and entry.metadata->>'reference_type'='${referenceType}'
          and entry.metadata->>'reference_id'=${alias}.id::text
          and entry.metadata->>'financial_leg'='payer_gross_debit')=1
      and (select pg_catalog.count(*) from public.ledger_entries entry
        where entry.txn_id=original.id and entry.account_id=${alias}.creator_account_id
          and entry.entry_type='credit' and entry.amount=${alias}.creator_net_bdag
          and entry.metadata->>'fin_txn_id'=original.id::text
          and entry.metadata->>'reference_type'='${referenceType}'
          and entry.metadata->>'reference_id'=${alias}.id::text
          and entry.metadata->>'financial_leg'='creator_net_credit')=1
      and (${alias}.platform_fee_bdag=0 or (select pg_catalog.count(*)
        from public.ledger_entries entry
        where entry.txn_id=original.id and entry.account_id=${alias}.platform_account_id
          and entry.entry_type='credit' and entry.amount=${alias}.platform_fee_bdag
          and entry.metadata->>'fin_txn_id'=original.id::text
          and entry.metadata->>'reference_type'='${referenceType}'
          and entry.metadata->>'reference_id'=${alias}.id::text
          and entry.metadata->>'financial_leg'='platform_fee_credit')=1)
      and ((${alias}.access_state<>'refunded'
          and ${alias}.reversal_financial_transaction_id is null
          and ${alias}.refund_idempotency_key is null)
        or (${alias}.access_state='refunded'
          and ${alias}.reversal_financial_transaction_id is not null
          and ${alias}.refund_idempotency_key is not null
          and reversal.status='completed'
          and reversal.operation_type='${refundOperation}'
          and reversal.reference_type='${referenceType}'
          and reversal.reference_id=${alias}.id::text
          and reversal.from_account_id=${alias}.creator_account_id
          and reversal.to_account_id=${alias}.${payerAccount}
          and reversal.amount=${alias}.gross_amount_bdag
          and reversal.fee_amount=${alias}.platform_fee_bdag
          and reversal.currency='BDAG'
          and reversal.initiated_by=${alias}.${payerId}
          and reversal.idempotency_key=${alias}.refund_idempotency_key::text
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id)=case when ${alias}.platform_fee_bdag=0 then 2 else 3 end
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id and entry.account_id=${alias}.creator_account_id
              and entry.entry_type='debit' and entry.amount=${alias}.creator_net_bdag
              and entry.metadata->>'fin_txn_id'=reversal.id::text
              and entry.metadata->>'reference_type'='${referenceType}'
              and entry.metadata->>'reference_id'=${alias}.id::text
              and entry.metadata->>'financial_leg'='creator_net_debit')=1
          and (${alias}.platform_fee_bdag=0 or (select pg_catalog.count(*)
            from public.ledger_entries entry
            where entry.txn_id=reversal.id and entry.account_id=${alias}.platform_account_id
              and entry.entry_type='debit' and entry.amount=${alias}.platform_fee_bdag
              and entry.metadata->>'fin_txn_id'=reversal.id::text
              and entry.metadata->>'reference_type'='${referenceType}'
              and entry.metadata->>'reference_id'=${alias}.id::text
              and entry.metadata->>'financial_leg'='platform_fee_debit')=1)
          and (select pg_catalog.count(*) from public.ledger_entries entry
            where entry.txn_id=reversal.id and entry.account_id=${alias}.${payerAccount}
              and entry.entry_type='credit' and entry.amount=${alias}.gross_amount_bdag
              and entry.metadata->>'fin_txn_id'=reversal.id::text
              and entry.metadata->>'reference_type'='${referenceType}'
              and entry.metadata->>'reference_id'=${alias}.id::text
              and entry.metadata->>'financial_leg'='payer_gross_credit')=1))
    ),false))`;
}

const F4_PURCHASE_BINDING_MISMATCH_SQL = f4FinancialFactMismatchSql({
  table: 'private.creator_premium_purchase_receipts', alias: 'receipt', payerId: 'buyer_id',
  payerAccount: 'buyer_account_id', referenceType: 'creator_premium_purchase_receipt',
  chargeOperation: 'creator_premium_purchase', refundOperation: 'creator_premium_purchase_refund',
  activeStates: ['active','revoked'], targetId: 'content_id', offerId: 'offer_version_id',
});
const F4_PERIOD_BINDING_MISMATCH_SQL = f4FinancialFactMismatchSql({
  table: 'private.creator_premium_subscription_periods', alias: 'period', payerId: 'subscriber_id',
  payerAccount: 'subscriber_account_id', referenceType: 'creator_premium_subscription_period',
  chargeOperation: 'creator_premium_subscription', refundOperation: 'creator_premium_subscription_refund',
  activeStates: ['active','expired','revoked'], targetId: 'plan_id', offerId: null,
});

const F4_ORPHAN_PREMIUM_TRANSACTION_SQL = `(select pg_catalog.count(*)::integer
  from public.financial_transactions transaction_row
  where transaction_row.operation_type in (
      'creator_premium_purchase','creator_premium_purchase_refund',
      'creator_premium_subscription','creator_premium_subscription_refund')
    and not (
      (transaction_row.operation_type='creator_premium_purchase'
        and exists(select 1 from private.creator_premium_purchase_receipts receipt
          where receipt.financial_transaction_id=transaction_row.id
            and transaction_row.reference_type='creator_premium_purchase_receipt'
            and transaction_row.reference_id=receipt.id::text))
      or (transaction_row.operation_type='creator_premium_purchase_refund'
        and exists(select 1 from private.creator_premium_purchase_receipts receipt
          where receipt.reversal_financial_transaction_id=transaction_row.id
            and transaction_row.reference_type='creator_premium_purchase_receipt'
            and transaction_row.reference_id=receipt.id::text))
      or (transaction_row.operation_type='creator_premium_subscription'
        and exists(select 1 from private.creator_premium_subscription_periods period
          where period.financial_transaction_id=transaction_row.id
            and transaction_row.reference_type='creator_premium_subscription_period'
            and transaction_row.reference_id=period.id::text))
      or (transaction_row.operation_type='creator_premium_subscription_refund'
        and exists(select 1 from private.creator_premium_subscription_periods period
          where period.reversal_financial_transaction_id=transaction_row.id
            and transaction_row.reference_type='creator_premium_subscription_period'
            and transaction_row.reference_id=period.id::text))))`;

const F4_ORPHAN_PREMIUM_LEDGER_ENTRY_SQL = `(select pg_catalog.count(*)::integer
  from public.ledger_entries entry
  join public.financial_transactions transaction_row on transaction_row.id=entry.txn_id
  where (transaction_row.operation_type in (
      'creator_premium_purchase','creator_premium_purchase_refund',
      'creator_premium_subscription','creator_premium_subscription_refund')
    or entry.metadata->>'reference_type' in (
      'creator_premium_purchase_receipt','creator_premium_subscription_period')
    or entry.metadata->>'financial_leg' in (
      'payer_gross_debit','creator_net_credit','platform_fee_credit',
      'creator_net_debit','platform_fee_debit','payer_gross_credit'))
    and not (
      entry.metadata->>'fin_txn_id'=transaction_row.id::text
      and (
        (transaction_row.operation_type in ('creator_premium_purchase','creator_premium_purchase_refund')
          and entry.metadata->>'reference_type'='creator_premium_purchase_receipt'
          and exists(select 1 from private.creator_premium_purchase_receipts receipt
            where entry.metadata->>'reference_id'=receipt.id::text
              and ((transaction_row.operation_type='creator_premium_purchase'
                  and receipt.financial_transaction_id=transaction_row.id)
                or (transaction_row.operation_type='creator_premium_purchase_refund'
                  and receipt.reversal_financial_transaction_id=transaction_row.id))))
        or (transaction_row.operation_type in ('creator_premium_subscription','creator_premium_subscription_refund')
          and entry.metadata->>'reference_type'='creator_premium_subscription_period'
          and exists(select 1 from private.creator_premium_subscription_periods period
            where entry.metadata->>'reference_id'=period.id::text
              and ((transaction_row.operation_type='creator_premium_subscription'
                  and period.financial_transaction_id=transaction_row.id)
                or (transaction_row.operation_type='creator_premium_subscription_refund'
                  and period.reversal_financial_transaction_id=transaction_row.id)))))))`;

const F4_SUBSCRIPTIONS_WITHOUT_PERIOD_SQL = `(select pg_catalog.count(*)::integer
  from private.creator_premium_subscriptions relationship
  where not exists(
    select 1 from private.creator_premium_subscription_periods period
    where period.subscription_id=relationship.id
  ))`;

const F4_MULTIPLE_PERIODS_PER_RELATIONSHIP_SQL = `(select pg_catalog.count(*)::integer
  from (
    select period.subscription_id
    from private.creator_premium_subscription_periods period
    group by period.subscription_id
    having pg_catalog.count(*)>1
  ) multiple_periods)`;

const F4_DUPLICATE_OPEN_RELATIONSHIPS_SQL = `(select pg_catalog.count(*)::integer
  from (
    select relationship.subscriber_id,relationship.creator_id,plan.plan_key
    from private.creator_premium_subscriptions relationship
    join private.creator_premium_plans plan
      on plan.id=relationship.plan_id
     and plan.creator_id=relationship.creator_id
    where relationship.status in ('pending','active','cancelled')
    group by relationship.subscriber_id,relationship.creator_id,plan.plan_key
    having pg_catalog.count(*)>1
  ) duplicate_relationships)`;

export const FINANCE_FACTS_F4_GENERAL_SQL = FINANCE_FACTS_F3_C2_SQL
  .replace("'phase','f3_c2'", "'phase','f4_general'")
  .replace("'purchase_binding_mismatches',(select pg_catalog.count(*)::integer from facts where kind='receipts'),",
    `'purchase_binding_mismatches',${F4_PURCHASE_BINDING_MISMATCH_SQL},`)
  .replace("'period_binding_mismatches',(select pg_catalog.count(*)::integer from facts where kind='periods')",
    `'period_binding_mismatches',${F4_PERIOD_BINDING_MISMATCH_SQL},
      'orphan_premium_transactions',${F4_ORPHAN_PREMIUM_TRANSACTION_SQL},
      'orphan_premium_ledger_entries',${F4_ORPHAN_PREMIUM_LEDGER_ENTRY_SQL},
      'subscriptions_without_period',${F4_SUBSCRIPTIONS_WITHOUT_PERIOD_SQL},
      'multiple_periods_per_relationship',${F4_MULTIPLE_PERIODS_PER_RELATIONSHIP_SQL},
      'duplicate_open_relationships',${F4_DUPLICATE_OPEN_RELATIONSHIPS_SQL}`);

export const FINANCE_FACTS_F5_AUTONOMOUS_SQL = FINANCE_FACTS_F4_GENERAL_SQL
  .replace("'phase','f4_general'", "'phase','f5_autonomous'")
  .replace("  union all select 'receipts',pg_catalog.to_jsonb(r) from private.creator_premium_purchase_receipts r",
    "  union all select 'mandates',pg_catalog.to_jsonb(m) from private.creator_premium_auto_renewal_mandates m\n  union all select 'attempts',pg_catalog.to_jsonb(x) from private.creator_premium_auto_renewal_attempts x\n  union all select 'receipts',pg_catalog.to_jsonb(r) from private.creator_premium_purchase_receipts r")
  .replace("  'receipts',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='receipts'),'[]'::jsonb),",
    "  'mandates',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='mandates'),'[]'::jsonb),\n  'attempts',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='attempts'),'[]'::jsonb),\n  'receipts',coalesce((select pg_catalog.jsonb_agg(item order by item::text) from sanitized where kind='receipts'),'[]'::jsonb),");

// Select the legacy query before parsing SQL: PostgreSQL must never resolve an absent F3 relation.
const FINANCE_FACTS_LEGACY_SQL = FINANCE_FACTS_F3_SQL
  .replace("select 'authorizations' kind,pg_catalog.to_jsonb(a) fact from private.creator_premium_finance_authorizations a",
    "select 'authorizations' kind,'{}'::jsonb fact where false")
  .replace("'phase','f3_foundation'", "'phase','legacy'")
  .replace("'activation_mode',pg_catalog.to_jsonb(p)->'activation_mode'",
    "'activation_mode',coalesce(pg_catalog.to_jsonb(p)->'activation_mode','\"off\"'::jsonb)");

export function selectFinanceSnapshotQueries(migrations) {
  validateNormalizedMigrations(migrations);
  const installed = migrations.items.find(item => item.version === '20261025011000');
  const c2 = migrations.items.find(item => item.version === '20261025160452');
  const f4 = migrations.items.find(item => item.version === '20261026030000');
  const f5 = migrations.items.find(item => item.version === '20261026072512');
  if (installed && installed.name !== 'creator_premium_f3_bounded_financial_activation') {
    fail('FINANCE_AUTHORITY_MISMATCH', 'F3 migration identity differs');
  }
  if (c2 && c2.name !== 'creator_premium_f3_c2_isolated_canary_governance') {
    fail('FINANCE_AUTHORITY_MISMATCH', 'F3-C2 migration identity differs');
  }
  if (f4 && f4.name !== 'creator_premium_f4_general_bdag_activation') {
    fail('FINANCE_AUTHORITY_MISMATCH', 'F4 migration identity differs');
  }
  if (f5 && f5.name !== 'creator_premium_f5_autonomous_subscriptions') {
    fail('FINANCE_AUTHORITY_MISMATCH', 'F5 migration identity differs');
  }
  if (c2 && !installed) fail('FINANCE_AUTHORITY_MISMATCH', 'F3-C2 requires the F3 foundation');
  if (f4 && (!installed || !c2)) fail('FINANCE_AUTHORITY_MISMATCH', 'F4 requires F3-C2');
  if (f5 && (!installed || !c2 || !f4)) fail('FINANCE_AUTHORITY_MISMATCH', 'F5 requires F4 general');
  const phase = f5 ? 'f5_autonomous' : f4 ? 'f4_general' : c2 ? 'f3_c2' : installed ? 'f3_foundation' : 'legacy';
  return { phase, authority: FINANCE_AUTHORITY_SQL,
    facts: f5 ? FINANCE_FACTS_F5_AUTONOMOUS_SQL : f4 ? FINANCE_FACTS_F4_GENERAL_SQL
      : c2 ? FINANCE_FACTS_F3_C2_SQL : installed ? FINANCE_FACTS_F3_SQL : FINANCE_FACTS_LEGACY_SQL };
}

export function validateFinanceFacts(snapshot, phase) {
  const code = 'FINANCE_FACTS_REJECTED';
  exactKeys(snapshot, ['schema_version','complete','phase','policy',
    ...(['f3_c2','f4_general','f5_autonomous'].includes(phase) ? ['attestations'] : []),
    ...(phase === 'f5_autonomous' ? ['mandates','attempts'] : []), 'authorizations','receipts','periods',
    'subscriptions','transactions','acquisition_exposure_bdag','release_movement_bdag','reconciliation'], code);
  const off = { activation_mode: 'off', active_authorization_id: null, purchase_enabled: false,
    subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0 };
  const general = { activation_mode: 'general', active_authorization_id: 'f4000000-0000-4000-8000-000000000001',
    purchase_enabled: true, subscription_enabled: true, refunds_enabled: true, platform_fee_bps: 2000 };
  const arrayKeys = [...(['f3_c2','f4_general','f5_autonomous'].includes(phase) ? ['attestations'] : []),
    ...(phase === 'f5_autonomous' ? ['mandates','attempts'] : []),
    'authorizations','receipts','periods','subscriptions','transactions'];
  const decimal = /^(?:0|[1-9][0-9]*)\.[0-9]{8}$/;
  const validSanitizedRows = key => Array.isArray(snapshot[key]) && snapshot[key].every(row => (
    row && typeof row === 'object' && !Array.isArray(row) && HASH_PATTERN.test(row.fact_sha256 ?? '')
    && Object.entries(row).every(([name,value]) => {
      if (name === 'fact_sha256') return true;
      if (name === 'id' || name.endsWith('_id')) return value === null || HASH_PATTERN.test(value);
      if (name.endsWith('_bdag') || name === 'amount') return value === null || (typeof value === 'string' && decimal.test(value));
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null;
    })
  ));
  const generalAuthorization = snapshot.authorizations?.[0];
  const generalAttestation = snapshot.attestations?.[0];
  const generalNullFields = [
    'buyer_id','creator_id','buyer_account_id','creator_account_id','purchase_content_id',
    'purchase_offer_version_id','subscription_plan_id','purchase_amount_bdag','subscription_amount_bdag',
    'max_purchase_count','max_subscription_count','max_refund_count','max_gross_bdag',
    'charge_expires_at','refund_expires_at',
  ];
  const f4FactsValid = ['f4_general','f5_autonomous'].includes(phase)
    && canonicalJson(snapshot.policy) === canonicalJson(general)
    && snapshot.attestations.length === 1 && snapshot.authorizations.length === 1
    && generalAuthorization.id === sha256('f4000000-0000-4000-8000-000000000001')
    && generalAuthorization.authorization_scope === 'GENERAL'
    && generalAuthorization.client_contract === 'creator-premium-f3-v2'
    && generalAuthorization.status === 'OPEN'
    && generalAuthorization.platform_fee_bps === 2000
    && generalNullFields.every(key => generalAuthorization[key] === null)
    && generalAuthorization.configuration_digest === generalAttestation.configuration_digest
    && generalAuthorization.approval_digest === generalAttestation.approval_digest
    && arrayKeys.every(validSanitizedRows)
    && decimal.test(snapshot.acquisition_exposure_bdag)
    && snapshot.release_movement_bdag === '0.00000000'
    && canonicalJson(snapshot.reconciliation) === canonicalJson({
      purchase_binding_mismatches: 0,
      period_binding_mismatches: 0,
      orphan_premium_transactions: 0,
      orphan_premium_ledger_entries: 0,
      subscriptions_without_period: 0,
      multiple_periods_per_relationship: 0,
      duplicate_open_relationships: 0,
    });
  const foundationFactsValid = ['legacy','f3_foundation','f3_c2'].includes(phase)
    && canonicalJson(snapshot.policy) === canonicalJson(off)
    && arrayKeys.every(key => canonicalJson(snapshot[key]) === '[]\n')
    && snapshot.acquisition_exposure_bdag === '0.00000000'
    && snapshot.release_movement_bdag === '0.00000000'
    && canonicalJson(snapshot.reconciliation) === canonicalJson({ purchase_binding_mismatches: 0, period_binding_mismatches: 0 });
  if (!['legacy','f3_foundation','f3_c2','f4_general','f5_autonomous'].includes(phase)
    || snapshot.schema_version !== 1 || snapshot.complete !== true || snapshot.phase !== phase
    || (!foundationFactsValid && !f4FactsValid)) {
    fail(code, 'foundation requires exact OFF and no financial facts');
  }
  return snapshot;
}

export function normalizeFinanceAuthority(snapshot, phase) {
  exactKeys(snapshot, ['schema_version','complete','relations','functions'], 'FINANCE_AUTHORITY_MISMATCH');
  if (snapshot.schema_version !== 1 || snapshot.complete !== true || !['legacy','f3_foundation','f3_c2','f4_general','f5_autonomous'].includes(phase)) {
    fail('FINANCE_AUTHORITY_MISMATCH', 'catalog identity is incomplete');
  }
  const result = { schema_version: 1, complete: true, phase };
  for (const key of ['relations','functions']) {
    if (!Array.isArray(snapshot[key]) || snapshot[key].length === 0) fail('FINANCE_AUTHORITY_MISMATCH', 'catalog is empty');
    result[key] = snapshot[key].map(row => {
      exactKeys(row, ['identity','authority'], 'FINANCE_AUTHORITY_MISMATCH');
      if (typeof row.identity !== 'string' || !row.authority || typeof row.authority !== 'object') fail('FINANCE_AUTHORITY_MISMATCH', 'catalog row is malformed');
      return { identity: row.identity, sha256: sha256(canonicalJson(row.authority)) };
    }).sort((a,b) => a.identity.localeCompare(b.identity));
    if (new Set(result[key].map(row => row.identity)).size !== result[key].length) fail('FINANCE_AUTHORITY_MISMATCH', 'duplicate catalog object');
  }
  // Existing ledger ACLs belong to the observed baseline, never to a fixture-derived allowlist.
  result.legacy_relations = result.relations.filter(row => row.identity.startsWith('public.'));
  result.relations = result.relations.filter(row => row.identity.startsWith('private.'));
  result.legacy_functions = result.functions.filter(row => !/creator_premium|current_user_is_creator_exclusive_age_eligible/.test(row.identity));
  result.functions = result.functions.filter(row => /creator_premium|current_user_is_creator_exclusive_age_eligible/.test(row.identity));
  return { ...result, sha256: sha256(canonicalJson(result)) };
}

export function normalizeCronCommand(command) {
  if (typeof command !== 'string') fail('INVALID_SNAPSHOT', 'cron command must be text');
  return command.trim().replace(/\s+/g, ' ');
}

export function cronCommandSha256(command) {
  if (typeof command !== 'string') fail('INVALID_SNAPSHOT', 'cron command must be text');
  return sha256(command);
}

export function normalizedCronCommandSha256(command) {
  return sha256(normalizeCronCommand(command));
}

export function projectCronBaselineItems(items, useRawCommandIdentity) {
  if (!Array.isArray(items)) fail('INVALID_SNAPSHOT', 'cron baseline items must be an array');
  return items.map(item => {
    if (!item || typeof item !== 'object' || !HASH_PATTERN.test(item.command_sha256 ?? '')) {
      fail('INVALID_SNAPSHOT', 'cron baseline item is invalid');
    }
    const { legacy_normalized_command_sha256: legacyDigest, ...rawIdentity } = item;
    if (useRawCommandIdentity) return rawIdentity;
    if (legacyDigest === undefined) return rawIdentity;
    if (!HASH_PATTERN.test(legacyDigest)) fail('INVALID_SNAPSHOT', 'legacy cron command digest is invalid');
    return { ...rawIdentity, command_sha256: legacyDigest };
  });
}

export const CRON_SNAPSHOT_SQL = `select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',true,'query_id','nelyon-cron-snapshot-v1',
  'count',pg_catalog.count(*)::integer,
    'items',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'jobid',j.jobid::text,'jobname',j.jobname,'schedule',j.schedule,
    'database',j.database,'username',j.username,'active',j.active,
    'nodename',j.nodename,'nodeport',j.nodeport,
    'command_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      j.command,'UTF8'),'sha256'),'hex'),
    'legacy_normalized_command_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.regexp_replace(pg_catalog.btrim(j.command),'[[:space:]]+',' ','g'),'UTF8'),'sha256'),'hex')
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
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.format_type(arg_oid,null) order by ordinality)
      from pg_catalog.unnest(p.proargtypes::oid[]) with ordinality args(arg_oid,ordinality)),'[]'::jsonb) argument_types,
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
  const policyShape = {
    purchase_enabled: snapshot.policy.purchase_enabled,
    subscription_enabled: snapshot.policy.subscription_enabled,
    refunds_enabled: snapshot.policy.refunds_enabled,
    platform_fee_bps: snapshot.policy.platform_fee_bps,
  };
  const financeOff = { purchase_enabled: false, subscription_enabled: false, refunds_enabled: false, platform_fee_bps: 0 };
  const financeGeneral = { purchase_enabled: true, subscription_enabled: true, refunds_enabled: true, platform_fee_bps: 2000 };
  if (![canonicalJson(financeOff), canonicalJson(financeGeneral)].includes(canonicalJson(policyShape))
    || typeof snapshot.policy.policy_version !== 'string') {
    fail('FINANCE_POLICY_CHANGED', 'Premium Finance must be exact OFF or exact F4 general');
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
    || !Array.isArray(snapshot.items) || snapshot.items.length !== snapshot.count) {
    fail('INVALID_SNAPSHOT', 'cron snapshot is invalid');
  }
  const jobIds = [];
  for (const item of snapshot.items) {
    exactKeys(item, [
      'active','command_sha256','database','jobid','jobname','legacy_normalized_command_sha256',
      'nodename','nodeport','schedule','username',
    ], 'INVALID_SNAPSHOT');
    if (!/^[1-9][0-9]*$/.test(item.jobid ?? '') || typeof item.jobname !== 'string' || item.jobname.length === 0
      || typeof item.schedule !== 'string' || item.schedule.length === 0
      || typeof item.database !== 'string' || item.database.length === 0
      || typeof item.username !== 'string' || item.username.length === 0
      || typeof item.active !== 'boolean' || typeof item.nodename !== 'string' || item.nodename.length === 0
      || !Number.isInteger(item.nodeport) || item.nodeport < 1 || item.nodeport > 65535
      || !HASH_PATTERN.test(item.command_sha256 ?? '')
      || !HASH_PATTERN.test(item.legacy_normalized_command_sha256 ?? '')) {
      fail('INVALID_SNAPSHOT', 'cron job identity is invalid');
    }
    jobIds.push(item.jobid);
  }
  if (new Set(jobIds).size !== jobIds.length
    || snapshot.items.some((item, index) => index > 0 && BigInt(snapshot.items[index - 1].jobid) >= BigInt(item.jobid))) {
    fail('INVALID_SNAPSHOT', 'cron jobs are duplicated or unordered');
  }
  return snapshot;
}

export function verifyCronSnapshotTransition(pre, post, transition = null) {
  validateCronSnapshot(pre);
  validateCronSnapshot(post);
  if (transition?.to_phase !== 'f5_autonomous') {
    if (canonicalJson(pre) !== canonicalJson(post)) fail('REMOTE_POSTCHECK_FAILED', 'cron configuration changed during release');
    return true;
  }
  const expected = transition.cron_job;
  if (!expected || normalizeCronCommand(expected.command) !== expected.command
    || normalizedCronCommandSha256(expected.command) !== expected.normalized_command_sha256
    || pre.items.some(item => item.jobname === expected.jobname) || post.count !== pre.count + 1) {
    fail('REMOTE_POSTCHECK_FAILED', 'F5 cron transition contract is invalid');
  }
  const before = new Map(pre.items.map(item => [item.jobid, item]));
  const after = new Map(post.items.map(item => [item.jobid, item]));
  for (const [jobid, item] of before) {
    if (!after.has(jobid) || canonicalJson(after.get(jobid)) !== canonicalJson(item)) {
      fail('REMOTE_POSTCHECK_FAILED', 'pre-existing cron job changed or disappeared');
    }
  }
  const added = post.items.filter(item => !before.has(item.jobid));
  const exactAdded = added[0];
  if (added.length !== 1 || canonicalJson({
    active: exactAdded?.active,
    command_sha256: exactAdded?.command_sha256,
    database: exactAdded?.database,
    jobname: exactAdded?.jobname,
    legacy_normalized_command_sha256: exactAdded?.legacy_normalized_command_sha256,
    nodename: exactAdded?.nodename,
    nodeport: exactAdded?.nodeport,
    schedule: exactAdded?.schedule,
    username: exactAdded?.username,
  }) !== canonicalJson({
    active: expected.active,
    command_sha256: cronCommandSha256(expected.command),
    database: expected.database,
    jobname: expected.jobname,
    legacy_normalized_command_sha256: expected.normalized_command_sha256,
    nodename: 'localhost',
    nodeport: 5432,
    schedule: expected.schedule,
    username: expected.username,
  })) fail('REMOTE_POSTCHECK_FAILED', 'F5 cron delta differs from the exact reviewed job');
  return true;
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

function validateFinancePolicyAuthority(policy) {
  if (sha256(canonicalJson(policy?.finance_authority_transition ?? null)) !== FINANCE_POLICY_DIGESTS.historical_transition
    || sha256(canonicalJson(policy?.finance_authority_c2_transition ?? null)) !== FINANCE_POLICY_DIGESTS.c2_transition
    || (FINANCE_POLICY_DIGESTS.f4_transition !== undefined
      && sha256(canonicalJson(policy?.finance_authority_f4_transition ?? null)) !== FINANCE_POLICY_DIGESTS.f4_transition)
    || (FINANCE_POLICY_DIGESTS.f5_transition !== undefined
      && sha256(canonicalJson(policy?.finance_authority_f5_transition ?? null)) !== FINANCE_POLICY_DIGESTS.f5_transition)
    || sha256(canonicalJson(policy?.finance_authority ?? null)) !== FINANCE_POLICY_DIGESTS.authority
    || canonicalJson(policy?.finance_security_advisor?.f5_relation_additions ?? null)
      !== canonicalJson(F5_SECURITY_ADVISOR_RELATION_ADDITIONS)
    || sha256(canonicalJson(policy?.finance_security_advisor ?? null)) !== FINANCE_POLICY_DIGESTS.security_advisor) {
    fail('FINANCE_AUTHORITY_TRANSITION_REJECTED', 'foundation policy differs from exact reviewed authority');
  }
}

function effectiveFinanceAuthority(policy, phase) {
  const authority = policy?.finance_authority;
  const exact = authority?.[phase];
  if (!exact || !exact.base_phase) return exact;
  if (!['f3_c2', 'f4_general', 'f5_autonomous'].includes(phase)
    || !['f3_foundation', 'f3_c2', 'f4_general'].includes(exact.base_phase)) {
    fail('FINANCE_AUTHORITY_MISMATCH', 'finance authority inheritance phase is unsupported');
  }
  const base = effectiveFinanceAuthority(policy, exact.base_phase);
  if (!base
    || !Array.isArray(exact.relations) || !Array.isArray(exact.function_overrides)
    || !Array.isArray(exact.function_additions) || !HASH_PATTERN.test(exact.schema_sha256 ?? '')) {
    fail('FINANCE_AUTHORITY_MISMATCH', 'finance authority inheritance is malformed');
  }
  const functions = new Map(base.functions.map(row => [row.identity, row]));
  for (const row of exact.function_overrides) {
    if (!functions.has(row.identity)) fail('FINANCE_AUTHORITY_MISMATCH', 'finance function override has no inherited identity');
    functions.set(row.identity, row);
  }
  for (const row of exact.function_additions) {
    if (functions.has(row.identity)) fail('FINANCE_AUTHORITY_MISMATCH', 'finance function addition duplicates inherited authority');
    functions.set(row.identity, row);
  }
  const expectedChanged = new Set([...exact.function_overrides, ...exact.function_additions].map(row => row.identity));
  if (expectedChanged.size !== exact.function_overrides.length + exact.function_additions.length
    || new Set(exact.relations.map(row => row.identity)).size !== exact.relations.length) {
    fail('FINANCE_AUTHORITY_MISMATCH', 'finance authority contains duplicate identities');
  }
  return {
    relations: [...exact.relations].sort((a, b) => a.identity.localeCompare(b.identity)),
    functions: [...functions.values()].sort((a, b) => a.identity.localeCompare(b.identity)),
    schema_sha256: exact.schema_sha256,
    legacy_function_identities: base.legacy_function_identities,
  };
}

export function activeFinanceAuthorityTransition(policy, manifest) {
  const migrations = manifest?.resources?.migrations ?? [];
  const attestation = manifest?.resources?.finance_authority_transition;
  const f5Candidate = attestation?.to_phase === 'f5_autonomous' || migrations.some(item => item.version === '20261026072512'
    || String(item.path).includes('creator_premium_f5_autonomous_subscriptions'));
  const f4Candidate = !f5Candidate && (attestation?.to_phase === 'f4_general' || migrations.some(item => item.version === '20261026030000'
    || String(item.path).includes('creator_premium_f4_general_bdag_activation')));
  const c2Candidate = !f4Candidate && (attestation?.to_phase === 'f3_c2' || migrations.some(item => item.version === '20261025160452'
    || String(item.path).includes('creator_premium_f3_c2_isolated_canary_governance')));
  const foundationCandidate = !f5Candidate && !f4Candidate && !c2Candidate && (Boolean(attestation) || migrations.some(item => item.version === '20261025011000'
    || String(item.path).includes('creator_premium_f3_bounded_financial_activation')));
  if (!f5Candidate && !f4Candidate && !c2Candidate && !foundationCandidate) return null;
  validateFinancePolicyAuthority(policy);
  const t = f5Candidate ? policy.finance_authority_f5_transition : f4Candidate ? policy.finance_authority_f4_transition
    : c2Candidate ? policy.finance_authority_c2_transition : policy.finance_authority_transition;
  const migrationVersion = f5Candidate ? '20261026072512' : f4Candidate ? '20261026030000'
    : c2Candidate ? '20261025160452' : '20261025011000';
  const expected = f5Candidate
    ? { id: t.id, from_phase: t.from_phase, to_phase: t.to_phase, baseline_sha: t.baseline_sha,
      reviewed_source_sha: t.reviewed_source_sha, integration_base_sha: t.integration_base_sha,
      approved_sha: manifest?.identity?.approved_sha, baseline_descendant_verified: true,
      integration_base_descendant_verified: true, migration_blob: t.migration_blob,
      migration_sha256: t.migration_sha256, function_blob: t.function_blob,
      function_source_sha256: t.function_source_sha256, config_blob: t.config_blob,
      client_contract: t.client_contract, client_sources: t.client_sources, cron_job: t.cron_job }
    : (f4Candidate || c2Candidate)
    ? { id: t.id, from_phase: t.from_phase, to_phase: t.to_phase, baseline_sha: t.baseline_sha,
      reviewed_source_sha: t.reviewed_source_sha, integration_base_sha: t.integration_base_sha,
      approved_sha: manifest?.identity?.approved_sha, baseline_descendant_verified: true,
      integration_base_descendant_verified: true, migration_blob: t.migration_blob,
      migration_sha256: t.migration_sha256 }
    : { id: t.id, phase: t.phase, baseline_sha: t.baseline_sha,
      reviewed_source_sha: t.reviewed_source_sha, integration_base_sha: t.integration_base_sha,
      approved_sha: manifest?.identity?.approved_sha, baseline_descendant_verified: true, integration_base_descendant_verified: true,
      migration_blob: t.migration_blob, migration_sha256: t.migration_sha256,
      function_blob: t.function_blob, function_source_sha256: t.function_source_sha256, config_blob: t.config_blob,
      client_contract: t.client_contract, client_sources: t.client_sources, frozen_f2_parser: t.frozen_f2_parser };
  const productivePaths = (manifest?.delta?.files ?? []).filter(item => String(item.path).startsWith('supabase/')).map(item => item.path).sort();
  if (!/^[a-f0-9]{40}$/.test(expected.approved_sha ?? '') || canonicalJson(attestation ?? null) !== canonicalJson(expected)
    || policy.baseline.sha !== t.baseline_sha || manifest?.baseline?.sha !== t.baseline_sha
    || migrations.length !== 1 || migrations[0].path !== t.migration_path
    || migrations[0].version !== migrationVersion
    || migrations[0].blob !== t.migration_blob || migrations[0].sha256 !== t.migration_sha256
    || canonicalJson(manifest.resources.functions) !== canonicalJson((f4Candidate || c2Candidate) ? [] : [t.function])
    || manifest.resources.function_contracts?.length !== ((f4Candidate || c2Candidate) ? 0 : 1)
    || ((f5Candidate || (!f4Candidate && !c2Candidate)) && (manifest.resources.function_contracts[0].name !== t.function
      || manifest.resources.function_contracts[0].source_sha256 !== t.function_source_sha256))
    || manifest.resources.config_changed !== false || canonicalJson(productivePaths) !== canonicalJson(t.productive_paths)) {
    fail('FINANCE_AUTHORITY_TRANSITION_REJECTED', 'foundation manifest lacks its exact ancestry/bytes/productive closure');
  }
  return attestation;
}

export function validateFinanceAuthority(snapshot, policy, phase) {
  validateFinancePolicyAuthority(policy);
  const code = 'FINANCE_AUTHORITY_MISMATCH';
  exactKeys(snapshot, ['schema_version','complete','phase','relations','functions','legacy_relations','legacy_functions','sha256'], code);
  const { sha256: digest, ...unsigned } = snapshot;
  const expected = effectiveFinanceAuthority(policy, phase);
  if (!expected || snapshot.schema_version !== 1 || snapshot.complete !== true || snapshot.phase !== phase
    || digest !== sha256(canonicalJson(unsigned))
    || canonicalJson(snapshot.relations) !== canonicalJson(expected.relations)
    || canonicalJson(snapshot.functions) !== canonicalJson(expected.functions)
    || !Array.isArray(snapshot.legacy_relations)
    || canonicalJson(snapshot.legacy_relations.map(item => item.identity))
      !== canonicalJson(['public.financial_transactions','public.ledger_accounts','public.ledger_entries'])
    || snapshot.legacy_relations.some(item => {
      try { exactKeys(item, ['identity','sha256'], code); } catch { return true; }
      return !HASH_PATTERN.test(item.sha256 ?? '');
    }) || !Array.isArray(snapshot.legacy_functions)
    || canonicalJson(snapshot.legacy_functions.map(item => item.identity)) !== canonicalJson(expected.legacy_function_identities)
    || snapshot.legacy_functions.some(item => {
      try { exactKeys(item, ['identity','sha256'], code); } catch { return true; }
      return !HASH_PATTERN.test(item.sha256 ?? '');
    })) fail(code, 'static finance authority differs from exact phase catalog');
  return true;
}

function validateCapturedEvidence({ evidence, phase, policy, request, manifest, adapterSourceSha256 }) {
  validateManifestAdapterIdentity(manifest, adapterSourceSha256);
  const financeQueries = selectFinanceSnapshotQueries(evidence?.migrations);
  const financeTransition = activeFinanceAuthorityTransition(policy, manifest);
  const requireFinanceAuthority = Boolean(financeTransition) || financeQueries.phase !== 'legacy';
  exactKeys(evidence, [
    'adapter', 'backup', 'complete', 'cron_security', 'evidence_sha256', 'finance', 'functions',
    'health', 'identity', 'migrations', 'observed_at', 'phase', 'premium_state', 'project_ref',
    'requests', 'rpc_security', 'schema_version',
    ...(requireFinanceAuthority ? ['finance_authority','finance_facts'] : []),
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
    ...(requireFinanceAuthority ? [
      { id: 'nelyon-finance-authority-v1', sha256: sha256(financeQueries.authority) },
      { id: `nelyon-finance-facts-${financeQueries.phase}-v1`, sha256: sha256(financeQueries.facts) },
    ] : []),
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
  if (requireFinanceAuthority) expectedRequests.push(
    ['POST', `${base}/database/query/read-only`, 201], ['POST', `${base}/database/query/read-only`, 201],
  );
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
  if (requireFinanceAuthority) {
    validateFinancePolicyAuthority(policy);
    const recoveryAuthorityPhase = exactRecoveryAuthorityPhase(policy, manifest, phase, {
      request,
      migrations: evidence.migrations,
    });
    const expectedPhase = financeTransition
      ? (phase === 'pre' ? (financeTransition.from_phase ?? 'legacy') : (financeTransition.to_phase ?? 'f3_foundation'))
      : (recoveryAuthorityPhase ?? financeQueries.phase);
    const expectedBaselineMigration = expectedPhase === 'f5_autonomous'
      ? '20261026072512_creator_premium_f5_autonomous_subscriptions'
      : expectedPhase === 'f4_general'
        ? '20261026030000_creator_premium_f4_general_bdag_activation'
      : expectedPhase === 'f3_c2'
        ? '20261025160452_creator_premium_f3_c2_isolated_canary_governance'
        : '20261025011000_creator_premium_f3_bounded_financial_activation';
    if (financeQueries.phase !== expectedPhase || (!financeTransition
      && !recoveryAuthorityPhase
      && policy.baseline.latest_migration < expectedBaselineMigration)) {
      fail('FINANCE_AUTHORITY_MISMATCH', 'migration/catalog/release phase differs');
    }
    validateFinanceAuthority(evidence.finance_authority, policy, expectedPhase);
    validateFinanceFacts(evidence.finance_facts, expectedPhase);
    if (evidence.finance.schema_sha256 !== effectiveFinanceAuthority(policy, expectedPhase).schema_sha256) {
      fail('FINANCE_AUTHORITY_MISMATCH', 'finance schema differs from exact phase catalog');
    }
    const expectedCounts = ['f4_general','f5_autonomous'].includes(expectedPhase)
      ? evidence.finance.premium_transaction_count === evidence.finance_facts.transactions.length
        && evidence.finance.premium_bindings.purchase_receipts.count === evidence.finance_facts.receipts.length
        && evidence.finance.premium_bindings.subscription_periods.count === evidence.finance_facts.periods.length
      : evidence.finance.premium_transaction_count === 0
        && Object.values(evidence.finance.premium_bindings).every(value => value.count === 0);
    if (!expectedCounts || RECONCILIATION_KEYS.some(key => evidence.finance.reconciliation[key] !== 0)) {
      fail('FINANCE_FACTS_REJECTED', 'finance facts, bindings, or reconciliation differ from the active authority');
    }
  }
  const phaseExceptions = advisorExceptionsForPhase(policy, manifest, phase, {
    request,
    migrations: evidence.migrations,
  });
  validateRpcSecuritySnapshot(evidence.rpc_security);
  validateRpcIdentitySet(evidence.rpc_security, phaseExceptions);
  validatePremiumPostcheckState(evidence.premium_state);
  return evidence;
}

function baselineMigrationName(item) {
  return `${item.version}_${item.name}`;
}

function hasExactBaselineMigrationAppend(policy, migrations, expectedLatestMigration) {
  const baseline = policy?.baseline;
  const baselineCount = baseline?.migration_count;
  if (!Number.isInteger(baselineCount) || baselineCount < 0
    || !HASH_PATTERN.test(baseline?.evidence_digests?.migrations ?? '')
    || migrations?.complete !== true || migrations.count !== baselineCount + 1
    || !Array.isArray(migrations.items) || migrations.items.length !== migrations.count
    || `${migrations.latest?.version}_${migrations.latest?.name}` !== expectedLatestMigration
    || canonicalJson(migrations.latest) !== canonicalJson(migrations.items.at(-1) ?? null)) return false;
  const baselineNames = migrations.items.slice(0, baselineCount).map(baselineMigrationName);
  return sha256(canonicalJson(baselineNames)) === baseline.evidence_digests.migrations;
}

export function verifyRecoveryInfrastructureBaseline({
  policy,
  migrations,
  functions,
  expectedLatestMigration,
  functionTransitions,
}) {
  validateNormalizedMigrations(migrations);
  validateNormalizedFunctions(functions);
  if (!hasExactBaselineMigrationAppend(policy, migrations, expectedLatestMigration)) {
    fail('RECOVERY_POSTCHECK_FAILED', 'migration history is not the exact reviewed baseline plus the approved append');
  }
  if (!Array.isArray(functionTransitions)) {
    fail('RECOVERY_POSTCHECK_FAILED', 'function transition evidence is unavailable');
  }
  const currentBySlug = new Map(functions.items.map(item => [item.slug, item]));
  const baselineReplacements = new Map();
  for (const transition of functionTransitions) {
    const current = transition?.current;
    const baseline = transition?.baseline;
    if (!current || !baseline || current.name !== baseline.name || baselineReplacements.has(current.name)) {
      fail('RECOVERY_POSTCHECK_FAILED', 'function transition evidence is invalid or duplicated');
    }
    const expectedCurrent = {
      ezbr_sha256: current.source_sha256,
      slug: current.name,
      status: current.status,
      verify_jwt: current.verify_jwt,
      version: current.version,
    };
    if (canonicalJson(currentBySlug.get(current.name) ?? null) !== canonicalJson(expectedCurrent)) {
      fail('RECOVERY_POSTCHECK_FAILED', `Edge Function ${current.name} differs from the approved live attestation`);
    }
    baselineReplacements.set(current.name, {
      ezbr_sha256: baseline.source_sha256,
      slug: baseline.name,
      status: baseline.status,
      verify_jwt: baseline.verify_jwt,
      version: baseline.version,
    });
  }
  const reconstructed = functions.items.map(item => baselineReplacements.get(item.slug) ?? item);
  const managedNames = [...(policy?.supabase?.managed_functions ?? [])].sort();
  const managedSet = new Set(managedNames);
  const blocked = new Set(policy?.baseline?.blocked_resources ?? []);
  const managed = reconstructed
    .filter(item => managedSet.has(item.slug))
    .map(item => ({
      name: item.slug,
      source_sha256: item.ezbr_sha256,
      source_parity: !blocked.has(item.slug),
      verify_jwt: item.verify_jwt,
      version: item.version,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (canonicalJson(managed.map(item => item.name)) !== canonicalJson(managedNames)) {
    fail('RECOVERY_POSTCHECK_FAILED', 'managed Edge Function inventory is incomplete');
  }
  const unmanaged = reconstructed
    .filter(item => !managedSet.has(item.slug))
    .map(item => ({ name: item.slug, version: item.version }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const config = {
    complete: true,
    managed_functions: managed.map(item => ({ name: item.name, verify_jwt: item.verify_jwt })),
  };
  const digestOf = value => sha256(canonicalJson(value));
  const reconstructedDigests = {
    config_verify_jwt: digestOf(config),
    function_source_parity: digestOf(managed.map(item => ({
      name: item.name,
      source_sha256: item.source_sha256,
      source_parity: item.source_parity,
    }))),
    managed_functions: digestOf(managed.map(item => ({
      name: item.name,
      version: item.version,
      verify_jwt: item.verify_jwt,
    }))),
    migrations: digestOf(migrations.items.slice(0, policy.baseline.migration_count).map(baselineMigrationName)),
    unmanaged_functions: digestOf(unmanaged),
  };
  const expectedDigests = policy?.baseline?.evidence_digests ?? {};
  if (Object.entries(reconstructedDigests).some(([key, value]) => expectedDigests[key] !== value)) {
    fail('RECOVERY_POSTCHECK_FAILED', 'unchanged migration or Edge Function inventory differs from the reviewed baseline');
  }
  return reconstructedDigests;
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

export function projectProductionBaselineFinance(finance, latestMigration) {
  const f4GeneralBaseline = latestMigration
    >= '20261026030000_creator_premium_f4_general_bdag_activation';
  return {
    complete: true,
    ...(finance?.schema_sha256 === undefined ? {} : { schema_sha256: finance.schema_sha256 }),
    ...(finance?.policy === undefined ? {} : { policy: finance.policy }),
    ...(finance?.reconciliation === undefined ? {} : { reconciliation: finance.reconciliation }),
    c2_attributed_bdag_movement: 0,
    ...(f4GeneralBaseline
      ? { authority_phase: 'f4_general', mutable_commerce_inventory: 'reconciled_not_baselined' }
      : {
        ...(finance?.premium_transaction_count === undefined
          ? {}
          : { premium_transaction_count: finance.premium_transaction_count }),
        ...(finance?.premium_bindings === undefined
          ? {}
          : { premium_bindings: finance.premium_bindings }),
      }),
  };
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
  // Production baselines are signed over the exact cron command bytes. Keep
  // the legacy normalized identity only for validating the F5 cron contract.
  const baselineCronItems = projectCronBaselineItems(
    evidence.cron_security.cron.items,
    true,
  );
  const cronSecurity = {
    complete: true,
    cron: baselineCronItems,
    security_findings: historicalAdvisorItems,
  };
  const f4GeneralBaseline = policy?.baseline?.latest_migration
    >= '20261026030000_creator_premium_f4_general_bdag_activation';
  if (f4GeneralBaseline && RECONCILIATION_KEYS.some(key => evidence.finance.reconciliation[key] !== 0)) {
    fail('REMOTE_BASELINE_MISMATCH', 'active F4 finance baseline is not reconciled');
  }
  const finance = projectProductionBaselineFinance(
    evidence.finance,
    policy?.baseline?.latest_migration,
  );
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
  const f4GeneralBaseline = baseline?.latest_migration
    >= '20261026030000_creator_premium_f4_general_bdag_activation';
  if (pre.migrations.count !== baseline.migration_count || latest !== baseline.latest_migration
    || pre.functions.count !== policy?.supabase?.expected_remote_function_count
    || (!f4GeneralBaseline && pre.finance.premium_transaction_count !== 0)
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

export function verifyF5AutonomousPostReleaseFacts(pre, post) {
  const exactArrays = ['attestations','authorizations','receipts','periods','subscriptions','transactions'];
  if (pre?.phase !== 'f4_general' || post?.phase !== 'f5_autonomous'
    || !Array.isArray(post?.mandates) || post.mandates.length !== 0
    || !Array.isArray(post?.attempts) || post.attempts.length !== 0
    || pre?.release_movement_bdag !== '0.00000000' || post?.release_movement_bdag !== '0.00000000'
    || pre?.acquisition_exposure_bdag !== post?.acquisition_exposure_bdag
    || exactArrays.some(key => !Array.isArray(pre?.[key]) || !Array.isArray(post?.[key])
      || canonicalJson(pre[key]) !== canonicalJson(post[key]))) {
    fail('REMOTE_POSTCHECK_FAILED', 'F5 release created retroactive mandates, attempts, or financial movement');
  }
  return true;
}

export function verifyProductionSnapshotPair({ pre, post, policy, request, manifest, adapterSourceSha256 }) {
  verifyProductionPreSnapshot({ pre, policy, request, manifest, adapterSourceSha256 });
  validateCapturedEvidence({ evidence: post, phase: 'post', policy, request, manifest, adapterSourceSha256 });
  validateRpcSecurityAttestations(post.rpc_security, advisorExceptionsForPhase(policy, manifest, 'post'));
  const financeTransition = activeFinanceAuthorityTransition(policy, manifest);
  validatePremiumStateTransition(pre.premium_state, post.premium_state, manifest, policy);
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

  verifyCronSnapshotTransition(pre.cron_security.cron, post.cron_security.cron, financeTransition);
  const preExceptions = advisorExceptionsForPhase(policy, manifest, 'pre');
  const postExceptions = advisorExceptionsForPhase(policy, manifest, 'post');
  const preExceptionFingerprints = new Set(preExceptions.map(exception => exception.advisor_fingerprint));
  const postExceptionFingerprints = new Set(postExceptions.map(exception => exception.advisor_fingerprint));
  const introducedExceptions = postExceptions
    .filter(exception => !preExceptionFingerprints.has(exception.advisor_fingerprint));
  const removedExceptionFingerprints = [...preExceptionFingerprints]
    .filter(fingerprint => !postExceptionFingerprints.has(fingerprint));
  validateSecurityAdvisorDelta(
    pre.cron_security.advisors.items,
    post.cron_security.advisors.items,
    introducedExceptions,
    removedExceptionFingerprints,
  );
  const f4Transition = financeTransition?.to_phase === 'f4_general';
  const f5Transition = financeTransition?.to_phase === 'f5_autonomous';
  const financePolicy = value => ({
    activation_mode: value.activation_mode,
    active_authorization_id: value.active_authorization_id,
    platform_fee_bps: value.platform_fee_bps,
    purchase_enabled: value.purchase_enabled,
    refunds_enabled: value.refunds_enabled,
    subscription_enabled: value.subscription_enabled,
  });
  const f4TransitionValid = !f4Transition || (
    canonicalJson(financePolicy(pre.finance.policy)) === canonicalJson(policy.finance_authority_f4_transition.from_policy)
    && canonicalJson(financePolicy(post.finance.policy)) === canonicalJson(policy.finance_authority_f4_transition.to_policy)
    && canonicalJson(post.finance.premium_bindings) === canonicalJson(pre.finance.premium_bindings)
    && Object.values(post.finance.premium_bindings).every(value => value.count === 0)
    && post.finance.premium_transaction_count === 0
    && canonicalJson(post.finance.transactions) === canonicalJson(pre.finance.transactions)
    && canonicalJson(post.finance.ledger_entries) === canonicalJson(pre.finance.ledger_entries)
    && canonicalJson(post.finance_facts.receipts) === '[]\n'
    && canonicalJson(post.finance_facts.periods) === '[]\n'
    && canonicalJson(post.finance_facts.subscriptions) === '[]\n'
    && canonicalJson(post.finance_facts.transactions) === '[]\n'
    && post.finance_facts.release_movement_bdag === '0.00000000'
  );
  const f5TransitionValid = !f5Transition || (
    canonicalJson(post.finance.policy) === canonicalJson(pre.finance.policy)
    && canonicalJson(post.finance.premium_bindings) === canonicalJson(pre.finance.premium_bindings)
    && canonicalJson(post.finance.transactions) === canonicalJson(pre.finance.transactions)
    && canonicalJson(post.finance.ledger_entries) === canonicalJson(pre.finance.ledger_entries)
    && post.finance.premium_transaction_count === pre.finance.premium_transaction_count
    && verifyF5AutonomousPostReleaseFacts(pre.finance_facts, post.finance_facts)
  );
  if ((!financeTransition && post.finance.schema_sha256 !== pre.finance.schema_sha256)
    || (!f4Transition && !f5Transition && canonicalJson(post.finance.premium_bindings) !== canonicalJson(pre.finance.premium_bindings))
    || (!f4Transition && !f5Transition && canonicalJson(post.finance.policy) !== canonicalJson(pre.finance.policy))
    || !f4TransitionValid
    || !f5TransitionValid
    || RECONCILIATION_KEYS.some(key => post.finance.reconciliation[key] !== 0)) {
    fail('REMOTE_POSTCHECK_FAILED', 'finance schema, Premium bindings, policy, or reconciliation changed');
  }
  if (financeTransition && (canonicalJson(pre.finance_authority.legacy_relations) !== canonicalJson(post.finance_authority.legacy_relations)
    || canonicalJson(pre.finance_authority.legacy_functions) !== canonicalJson(post.finance_authority.legacy_functions))) {
    fail('FINANCE_AUTHORITY_MISMATCH', 'legacy ledger authority changed during foundation release');
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
  const phaseExceptions = advisorExceptionsForPhase(policy, manifest, 'recovery', {
    request,
    migrations: recovery.migrations,
  });
  validateRpcSecurityAttestations(recovery.rpc_security, phaseExceptions);
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
  [
    '20261026030000_creator_premium_f4_general_bdag_activation|2818544a84b6844679779d5b23a03199e75c18d5d36d6d160aca9c8191c41097',
    {
      security_definer: true,
      owner: 'postgres',
      search_path: ['search_path=""'],
      acl: [
        { grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false },
        { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ],
      execute: { anon: false, authenticated: true, public: false, service_role: false },
      definition_sha256: '1b33026301062223a91c4e35000a44f8299b639d7a728834150fb32d23d6309a',
    },
  ],
]);

function exactRecoveryAuthorityPhase(policy, manifest, phase, { request, migrations } = {}) {
  if (phase !== 'recovery' || request?.mode !== 'postcheck_recovery'
    || request?.scopeConfirmation !== 'POSTCHECK_RECOVERY_READ_ONLY'
    || manifest?.identity?.mode !== 'postcheck_recovery'
    || canonicalJson(manifest?.resources ?? null) !== canonicalJson({
      config_changed: false,
      function_contracts: [],
      functions: [],
      migrations: [],
    })) return null;
  const recoveryPhases = new Map([
    ['40166468648', {
      expectedLatestMigration: '20261025011000_creator_premium_f3_bounded_financial_activation',
      phase: 'f3_foundation',
    }],
    ['40268500711', {
      expectedLatestMigration: '20261026030000_creator_premium_f4_general_bdag_activation',
      phase: 'f4_general',
    }],
    ['40324910390', {
      expectedLatestMigration: '20261026072512_creator_premium_f5_autonomous_subscriptions',
      phase: 'f5_autonomous',
    }],
  ]);
  const requestedRunId = String(request?.recoverySourceRunId ?? '');
  const recovery = recoveryPhases.get(requestedRunId);
  if (!recovery) return null;
  const source = policy?.postcheck_recovery?.approved_sources?.find(item => (
    item.run_id === requestedRunId
  ));
  if (!source || source.expected_latest_migration !== recovery.expectedLatestMigration
    || source.expected_migration_count !== policy?.baseline?.migration_count + 1
    || !hasExactBaselineMigrationAppend(policy, migrations, source.expected_latest_migration)) return null;
  if (!source.expected_migrations.every(expected => migrations.items.filter(item => (
    `${item?.version}_${item?.name}` === expected.name
  )).length === 1)) return null;
  return recovery.phase;
}

function phaseBoundRpcExceptions(exceptions, manifest, phase, { policy, migrations } = {}) {
  if (phase === 'recovery') {
    const observed = new Set((migrations?.items ?? []).map(migrationIdentity).filter(Boolean));
    const baselineLatest = String(policy?.baseline?.latest_migration ?? '');
    return exceptions.filter(exception => {
      const origin = exception?.origin?.migration;
      if (typeof origin !== 'string') return true;
      return origin <= baselineLatest || observed.has(origin);
    });
  }
  if (phase !== 'pre') return [...exceptions];
  const pendingMigrations = new Map((manifest?.resources?.migrations ?? [])
    .map(item => [migrationIdentity(item), item])
    .filter(([identity]) => Boolean(identity)));
  return exceptions.flatMap(exception => {
    const pending = pendingMigrations.get(exception?.origin?.migration);
    if (!pending) return [exception];
    const predecessor = RPC_REPLACEMENT_PREDECESSOR_ATTESTATIONS.get(
      `${exception.origin.migration}|${exception.advisor_fingerprint}`,
    );
    if (predecessor) return [{ ...exception, attestation: predecessor }];
    const requiresExactSource = exception.origin.migration
      === '20261025231500_creator_premium_f3_final_wallet_integration';
    if (pending.blob !== exception.origin.migration_blob
      || ((requiresExactSource || pending.source_sha !== undefined)
        && pending.source_sha !== exception.origin.source_sha)) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'phase-bound RPC omission lacks exact migration blob/source evidence');
    }
    return [];
  });
}

export function advisorExceptionsForPhase(policy, manifest, phase, context = {}) {
  if (!['pre', 'post', 'recovery'].includes(phase)) fail('INVALID_SNAPSHOT_IDENTITY', 'phase must be pre, post, or recovery');
  const exceptions = policy?.security_advisor?.exceptions;
  if (!Array.isArray(exceptions)) fail('RPC_SECURITY_ATTESTATION_FAILED', 'Security Advisor exceptions are unavailable');
  const transition = activeFinanceAuthorityTransition(policy, manifest);
  const installedFoundation = policy?.baseline?.latest_migration >= '20261025011000_creator_premium_f3_bounded_financial_activation';
  const installedC2 = policy?.baseline?.latest_migration >= '20261025160452_creator_premium_f3_c2_isolated_canary_governance';
  const installedF4 = policy?.baseline?.latest_migration >= '20261026030000_creator_premium_f4_general_bdag_activation';
  const installedF5 = policy?.baseline?.latest_migration >= '20261026072512_creator_premium_f5_autonomous_subscriptions';
  const exactRecoveryPhase = exactRecoveryAuthorityPhase(policy, manifest, phase, context);
  if ((transition && phase !== 'pre') || installedFoundation || exactRecoveryPhase) {
    validateFinancePolicyAuthority(policy);
    const successors = policy.finance_security_advisor.rpc_attestations;
    let result = [...exceptions.filter(exception => !successors.some(item => item.object.name === exception.object.name)),
      ...successors, policy.finance_security_advisor.relation_exception];
    if ((transition?.to_phase === 'f3_c2' && phase !== 'pre') || installedC2
      || ['f3_c2', 'f4_general', 'f5_autonomous'].includes(exactRecoveryPhase)) {
      const replacements = policy.finance_security_advisor.c2_rpc_replacements;
      result = [...result.filter(exception => !replacements.some(item => item.object.name === exception.object.name)),
        ...replacements, policy.finance_security_advisor.c2_relation_exception];
    }
    if ((transition?.to_phase === 'f4_general' && phase !== 'pre') || installedF4
      || ['f4_general', 'f5_autonomous'].includes(exactRecoveryPhase)) {
      const replacements = policy.finance_security_advisor.f4_rpc_replacements;
      result = [...result.filter(exception => !replacements.some(item => item.object.name === exception.object.name)),
        ...replacements];
    }
    if ((transition?.to_phase === 'f5_autonomous' && phase !== 'pre') || installedF5
      || exactRecoveryPhase === 'f5_autonomous') {
      const rpcAdditions = policy.finance_security_advisor.f5_rpc_additions;
      const relationAdditions = policy.finance_security_advisor.f5_relation_additions;
      result = [...result, ...rpcAdditions, ...relationAdditions];
    }
    return phaseBoundRpcExceptions(result, manifest, phase, { policy, migrations: context.migrations });
  }
  return phaseBoundRpcExceptions(exceptions, manifest, phase, { policy, migrations: context.migrations });
}

function rpcIdentitiesFromExceptions(exceptions) {
  return exceptions.filter(exception => Array.isArray(exception?.object?.argument_types)).map(exception => ({
    schema: exception?.object?.schema,
    name: exception?.object?.name,
    argument_types: exception?.object?.argument_types,
  }));
}

export function validateSecurityAdvisorDelta(preItems, postItems, allowedIntroducedExceptions, allowedRemovedFingerprints = []) {
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
  const removed = [...before].filter(fingerprint => !after.has(fingerprint)).sort();
  const expectedRemoved = allowedRemovedFingerprints.filter(fingerprint => before.has(fingerprint)).sort();
  if (canonicalJson(removed) !== canonicalJson(expectedRemoved)
    || preItems.some(item => after.has(item.fingerprint)
      && canonicalJson(item) !== canonicalJson(postItems.find(value => value.fingerprint === item.fingerprint)))) {
    fail('REMOTE_POSTCHECK_FAILED', 'pre-existing Advisor findings disappeared or changed');
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
      || typeof item.identity_arguments !== 'string' || (item.identity_arguments.length === 0 && item.argument_types?.length !== 0)
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

export function validatePremiumStateTransition(preState, postState, manifest = null, policy = null) {
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
  const financeTransition = activeFinanceAuthorityTransition(policy, manifest);
  if (financeTransition && financeTransition.to_phase !== 'f4_general') {
    const relationNames = financeTransition.to_phase === 'f5_autonomous'
      ? ['creator_premium_auto_renewal_attempts','creator_premium_auto_renewal_mandates']
      : [financeTransition.to_phase === 'f3_c2'
        ? 'creator_premium_finance_owner_attestations_f3_c2'
        : 'creator_premium_finance_authorizations'];
    for (const relationName of relationNames) {
      allowedAddedIdentities.push(`private.${relationName}`);
      const actual = postState.relation_security.items.find(row => row.schema === 'private' && row.name === relationName);
      const expected = { schema: 'private', name: relationName, owner: 'postgres',
        rls_enabled: true, force_rls: true, acl: ['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']
          .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })) };
      if (canonicalJson(actual ?? null) !== canonicalJson(expected)) {
        fail('PREMIUM_POSTCHECK_FAILED', 'new finance relation must have exact owner-only ACL and FORCE RLS');
      }
    }
    allowedAddedIdentities.sort();
  }
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
  const migrations = normalizeMigrations(migrationsBody);
  const financeQueries = selectFinanceSnapshotQueries(migrations);
  const requireFinanceAuthority = Boolean(activeFinanceAuthorityTransition(policy, manifest)) || financeQueries.phase !== 'legacy';
  const functionsBody = await get(`${base}/functions`, 'function inventory');
  const advisorsBody = await get(`${base}/advisors/security`, 'security advisors');
  const backupsBody = await get(`${base}/database/backups`, 'database backups');
  const financeBody = await sql(
    FINANCE_SNAPSHOT_SQL,
    [identity.release_id, identity.run_id],
    'finance snapshot',
  );
  const cronBody = await sql(CRON_SNAPSHOT_SQL, null, 'cron snapshot');
  const phaseExceptions = advisorExceptionsForPhase(policy, manifest, phase, { request, migrations });
  const rpcSecurityBody = await sql(
    RPC_SECURITY_ATTESTATION_SQL,
    [JSON.stringify(rpcIdentitiesFromExceptions(phaseExceptions))],
    'RPC security attestation',
  );
  const premiumStateBody = await sql(PREMIUM_POSTCHECK_STATE_SQL, null, 'Premium postcheck state');
  let financeAuthority;
  let financeFacts;
  if (requireFinanceAuthority) {
    assertReadOnlySql(financeQueries.authority);
    assertReadOnlySql(financeQueries.facts);
    financeAuthority = singleSnapshot(await sql(financeQueries.authority, null, 'finance static authority'),
      value => normalizeFinanceAuthority(value, financeQueries.phase), 'finance static authority');
    financeFacts = singleSnapshot(await sql(financeQueries.facts, [identity.release_id, identity.run_id], 'finance fact envelope'),
      value => validateFinanceFacts(value, financeQueries.phase), 'finance fact envelope');
    validateFinanceAuthority(financeAuthority, policy, financeQueries.phase);
  }
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
        ...(requireFinanceAuthority ? [
          { id: 'nelyon-finance-authority-v1', sha256: sha256(financeQueries.authority) },
          { id: `nelyon-finance-facts-${financeQueries.phase}-v1`, sha256: sha256(financeQueries.facts) },
        ] : []),
      ],
    },
    observed_at: new Date(observedAt).toISOString(),
    health: normalizeHealth(healthBody),
    backup: selectRecentCompletedBackup(backupsBody, observedAt, policy.supabase.backup),
    migrations,
    functions: normalizeFunctions(functionsBody),
    cron_security: {
      complete: true,
      cron: singleSnapshot(cronBody, validateCronSnapshot, 'cron snapshot'),
      advisors: normalizeSecurityAdvisors(advisorsBody),
    },
    finance: singleSnapshot(financeBody, validateFinanceSnapshot, 'finance snapshot'),
    ...(requireFinanceAuthority ? { finance_authority: financeAuthority, finance_facts: financeFacts } : {}),
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

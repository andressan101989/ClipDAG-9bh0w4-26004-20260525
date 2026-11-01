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

const STORIES_B1_MIGRATION = '20261027042552_stories_v2_interactive_b1';
const STORIES_SAFETY_C1_MIGRATION = '20261027120000_stories_v2_safety_c1_technical_policy_prep';
const STORIES_B1_RELATION_NAMES = Object.freeze([
  'story_analytics_events',
  'story_b1_worker_lane_state',
  'story_interactive_elements',
  'story_interactive_responses',
  'story_operation_policy',
  'story_safety_state',
]);

export const STORIES_B1_PRE_STATE_SQL = `select pg_catalog.jsonb_build_object(
  'schema_version',1,
  'complete',true,
  'infrastructure_installed',false,
  'owner_approved_policy',exists(
    select 1 from private.content_safety_rules rule
    where rule.approval_state='approved' and rule.enabled and 'story_text'=any(rule.scopes)
  ),
  'activation',false,
  'mode','fail_closed_review',
  'story_count',(select pg_catalog.count(*)::integer from public.stories),
  'direct_story_count',(select pg_catalog.count(*)::integer from public.stories where story_kind='media'),
  'safety_state_counts',pg_catalog.jsonb_build_object('blocked',0,'passed',0,'pending',0,'review',0),
  'complete_evidence_count',0,
  'complete_evidence_non_review_count',0,
  'incomplete_evidence_non_pending_count',0,
  'complete_evidence_pass_count',0,
  'fabricated_pass_count',0,
  'relations','[]'::jsonb
) snapshot;`;

export const STORIES_B1_POST_STATE_SQL = `with counts as (
  select
    pg_catalog.count(*) filter(where state='blocked')::integer blocked,
    pg_catalog.count(*) filter(where state='passed')::integer passed,
    pg_catalog.count(*) filter(where state='pending')::integer pending,
    pg_catalog.count(*) filter(where state='review')::integer review,
    pg_catalog.count(*) filter(where visual_complete and audio_complete and text_complete
      and evidence_generation=generation)::integer complete_evidence,
    pg_catalog.count(*) filter(where
      (visual_complete and audio_complete and text_complete and evidence_generation=generation) is true
      and state is distinct from 'review')::integer complete_evidence_non_review,
    pg_catalog.count(*) filter(where
      (visual_complete and audio_complete and text_complete and evidence_generation=generation) is not true
      and state is distinct from 'pending')::integer incomplete_evidence_non_pending,
    pg_catalog.count(*) filter(where state='passed' and visual_complete and audio_complete and text_complete
      and evidence_generation=generation)::integer complete_evidence_pass,
    pg_catalog.count(*) filter(where state='passed' and (not visual_complete or not audio_complete
      or not text_complete or evidence_generation is distinct from generation
      or evidence_fingerprint is null or policy_digest is null or decided_at is null))::integer fabricated_pass
  from private.story_safety_state
), relation_rows as (
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
    and c.relname=any(array[
      'story_analytics_events','story_b1_worker_lane_state','story_interactive_elements',
      'story_interactive_responses','story_operation_policy','story_safety_state'
    ]::text[])
)
select pg_catalog.jsonb_build_object(
  'schema_version',1,
  'complete',true,
  'infrastructure_installed',
    pg_catalog.to_regclass('private.story_interactive_elements') is not null
    and pg_catalog.to_regclass('private.story_interactive_responses') is not null
    and pg_catalog.to_regclass('private.story_safety_state') is not null,
  'owner_approved_policy',exists(
    select 1 from private.content_safety_rules rule
    where rule.approval_state='approved' and rule.enabled and 'story_text'=any(rule.scopes)
  ),
  'activation',exists(
    select 1 from private.story_safety_state state
    where state.state='passed' or state.policy_digest is not null
  ),
  'mode','fail_closed_review',
  'story_count',(select pg_catalog.count(*)::integer from public.stories),
  'direct_story_count',(select pg_catalog.count(*)::integer from public.stories where story_kind='media'),
  'safety_state_counts',pg_catalog.jsonb_build_object(
    'blocked',counts.blocked,'passed',counts.passed,'pending',counts.pending,'review',counts.review
  ),
  'complete_evidence_count',counts.complete_evidence,
  'complete_evidence_non_review_count',counts.complete_evidence_non_review,
  'incomplete_evidence_non_pending_count',counts.incomplete_evidence_non_pending,
  'complete_evidence_pass_count',counts.complete_evidence_pass,
  'fabricated_pass_count',counts.fabricated_pass,
  'relations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',schema,'name',name,'owner',owner,'rls_enabled',rls_enabled,
    'force_rls',force_rls,'acl',acl
  ) order by schema,name) from relation_rows),'[]'::jsonb)
) snapshot from counts;`;

export const STORIES_SAFETY_C1_STATE_SQL = `with expected(identity) as (
  values
    ('private.content_safety_target_snapshot(text,uuid)'),
    ('private.content_safety_visual_source(text,uuid)'),
    ('private.enqueue_content_safety_scan(text,uuid,text)'),
    ('private.story_author_text_bundle_c1_v1(uuid)'),
    ('private.story_can_access(uuid,boolean)'),
    ('private.story_content_safety_candidate_c1_v1(uuid)'),
    ('private.story_content_safety_control_c1_v1()'),
    ('private.story_content_safety_policy_c1_v1()'),
    ('private.story_current_fingerprint(uuid)'),
    ('private.story_enqueue_media_safety_v1(uuid)'),
    ('private.story_refresh_safety_from_transcript_c1_v1()'),
    ('private.story_sync_safety_from_scan_v1()')
), function_rows as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' identity,
    owner_role.rolname owner,p.prosecdef security_definer,coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    pg_catalog.jsonb_build_object(
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public',pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    ) execute,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable
    ) order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256,
    p.prosrc
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  join expected e on e.identity=n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')'
), trigger_rows as (
  select t.tgname name,n.nspname||'.'||c.relname table_name,t.tgenabled enabled,
    fnn.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' function_identity,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,true),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace fnn on fnn.oid=p.pronamespace
  where not t.tgisinternal and t.tgname='content_safety_story_transcript_refresh_c1'
), installed_state as (
  select (select pg_catalog.count(*) from function_rows)=12
    and (select pg_catalog.count(*) from trigger_rows)=1 installed
), control_source as (
  select prosrc from function_rows where identity='private.story_content_safety_control_c1_v1()'
), policy_source as (
  select prosrc from function_rows where identity='private.story_content_safety_policy_c1_v1()'
), story_inventory as (
  select pg_catalog.count(*)::integer count,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(story)::text,E'\\n' order by story.id),''),'UTF8')),'hex') sha256
  from public.stories story
), safety_inventory as (
  select pg_catalog.count(*)::integer count,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(state)::text,E'\\n' order by state.story_id),''),'UTF8')),'hex') sha256
  from private.story_safety_state state
)
select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',true,'installed',installed_state.installed,
  'policy_id',case when installed_state.installed then
    (select pg_catalog.substring(prosrc,'"policy_id"[[:space:]]*:[[:space:]]*"([^"]+)"') from policy_source) end,
  'policy_artifact_sha256',case when installed_state.installed then
    (select pg_catalog.substring(prosrc,'"policy_artifact_sha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"') from control_source) end,
  'control',case when installed_state.installed then pg_catalog.jsonb_build_object(
    'policy_artifact_sha256',(select pg_catalog.substring(prosrc,'"policy_artifact_sha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"') from control_source),
    'activation',coalesce((select prosrc~'"activation"[[:space:]]*:[[:space:]]*true' from control_source),false),
    'owner_approved_policy',coalesce((select prosrc~'"owner_approved_policy"[[:space:]]*:[[:space:]]*true' from control_source),false),
    'auto_publish_enabled',coalesce((select prosrc~'"auto_publish_enabled"[[:space:]]*:[[:space:]]*true' from control_source),false),
    'mode',(select pg_catalog.substring(prosrc,'"mode"[[:space:]]*:[[:space:]]*"([^"]+)"') from control_source),
    'automatic_allow_authorized',coalesce((select prosrc~'"automatic_allow_authorized"[[:space:]]*:[[:space:]]*true' from control_source),false),
    'automatic_block_authorized',coalesce((select prosrc~'"automatic_block_authorized"[[:space:]]*:[[:space:]]*true' from control_source),false)
  ) end,
  'approved_story_rule_count',(select pg_catalog.count(*)::integer from private.content_safety_rules rule
    where rule.approval_state='approved'
      and rule.scopes&&array['story_image','story_video','story_audio','story_text']::text[]),
  'passed_count',(select pg_catalog.count(*)::integer from private.story_safety_state where state='passed'),
  'policy_digest_count',(select pg_catalog.count(*)::integer from private.story_safety_state where policy_digest is not null),
  'story_count',story_inventory.count,'safety_state_count',safety_inventory.count,
  'story_inventory_sha256',story_inventory.sha256,'safety_inventory_sha256',safety_inventory.sha256,
  'transcript_refresh_trigger_installed',(select pg_catalog.count(*)=1 from trigger_rows),
  'trigger',case when installed_state.installed then (select pg_catalog.jsonb_build_object(
    'name',name,'table',table_name,'enabled',enabled,'function_identity',function_identity,
    'definition_sha256',definition_sha256) from trigger_rows) end,
  'helpers',case when installed_state.installed then coalesce((select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('identity',identity,'owner',owner,'security_definer',security_definer,
      'search_path',search_path,'execute',execute,'acl',acl,'definition_sha256',definition_sha256)
    order by identity) from function_rows),'[]'::jsonb) else '[]'::jsonb end
) snapshot from installed_state cross join story_inventory cross join safety_inventory;`;

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

// C2 captures whole legacy rows: the old `state` alias is also a text column.
// Preserve the historical C1 query bytes while correcting C2's predecessor proof.
export const STORIES_SAFETY_C2_PRE_STATE_SQL = STORIES_SAFETY_C1_STATE_SQL.replace(
  'pg_catalog.to_jsonb(state)::text,E\'\\n\' order by state.story_id)',
  'pg_catalog.to_jsonb(safety)::text,E\'\\n\' order by safety.story_id)',
).replace('from private.story_safety_state state\n)', 'from private.story_safety_state safety\n)');

// C2 preserves the immutable C1 query and captures the separate operating authority.
export const STORIES_SAFETY_C2_STATE_SQL = `with expected(identity) as (
  values
    ('private.create_story_from_content_core_c2_v1(uuid,jsonb,uuid)'),
    ('private.content_safety_target_snapshot(text,uuid)'),
    ('private.content_safety_visual_source(text,uuid)'),
    ('private.enqueue_content_safety_scan(text,uuid,text)'),
    ('private.story_alert_moderation_c2_v1()'),
    ('private.story_author_text_bundle_c1_v1(uuid)'),
    ('private.story_can_access(uuid,boolean)'),
    ('private.story_content_safety_candidate_c1_v1(uuid)'),
    ('private.story_content_safety_control_c1_v1()'),
    ('private.story_content_safety_control_c2_v1()'),
    ('private.story_content_safety_policy_c1_v1()'),
    ('private.story_content_safety_policy_c2_v1()'),
    ('private.story_current_fingerprint(uuid)'),
    ('private.story_enqueue_media_safety_v1(uuid)'),
    ('private.story_initialize_safety()'),
    ('private.story_publish_c2_v1(uuid,uuid)'),
    ('private.story_refresh_safety_from_transcript_c1_v1()'),
    ('private.story_runtime_status_c2_v1(uuid)'),
    ('private.story_sync_safety_from_scan_v1()'),
    ('public.admin_moderate_story(uuid,text,text,uuid)'),
    ('public.create_story_from_content(uuid,jsonb,uuid)'),
    ('public.create_story_from_content(uuid,jsonb,uuid,jsonb)'),
    ('public.create_story_with_media(uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid,jsonb)'),
    ('public.get_admin_story_detail(uuid)'),
    ('public.search_admin_stories(text,text,uuid,timestampwithtimezone,uuid,integer)')
), function_rows as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' identity,
    owner_role.rolname owner,p.prosecdef security_definer,coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    pg_catalog.jsonb_build_object(
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public',pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    ) execute,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable
    ) order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256,
    p.prosrc
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  join expected e on e.identity=n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')'
), trigger_rows as (
  select t.tgname name,n.nspname||'.'||c.relname table_name,t.tgenabled enabled,
    fnn.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' function_identity,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,true),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace fnn on fnn.oid=p.pronamespace
  where not t.tgisinternal and t.tgname='content_safety_story_transcript_refresh_c1'
), alert_trigger_rows as (
  select t.tgname name,n.nspname||'.'||c.relname table_name,t.tgenabled enabled,
    fnn.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' function_identity,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,true),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace fnn on fnn.oid=p.pronamespace
  where not t.tgisinternal and t.tgname='content_safety_story_alert_moderation_c2'
), initialization_trigger_rows as (
  select t.tgname name,n.nspname||'.'||c.relname table_name,t.tgenabled enabled,
    fnn.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' function_identity,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,true),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace fnn on fnn.oid=p.pronamespace
  where not t.tgisinternal and t.tgname='story_initialize_safety'
), installed_state as (
  select (select pg_catalog.count(*) from function_rows)=27
    and (select pg_catalog.count(*) from alert_trigger_rows)=1
    and (select pg_catalog.count(*) from initialization_trigger_rows)=1
    and (select pg_catalog.count(*) from trigger_rows)=1 installed
), control_source as (
  select prosrc from function_rows where identity='private.story_content_safety_control_c2_v1()'
), policy_source as (
  select prosrc from function_rows where identity='private.story_content_safety_policy_c2_v1()'
), story_inventory as (
  select pg_catalog.count(*)::integer count,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(story)::text,E'\\n' order by story.id),''),'UTF8')),'hex') sha256
  from public.stories story
), safety_inventory as (
  select pg_catalog.count(*)::integer count,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(pg_catalog.string_agg(
      (pg_catalog.to_jsonb(safety)-array['publication_status','moderation_status','published_at',
        'publication_policy_id','moderation_actor_id','moderation_reason','moderated_at']::text[])::text,E'\\n' order by safety.story_id),''),'UTF8')),'hex') sha256
  from private.story_safety_state safety
), runtime as (
  select safety.*,case
    when scan.id is null then null
    when scan.status='failed' or scan.text_status='failed' or scan.visual_status in('failed','not_configured')
      or scan.audio_status in('failed','not_configured') then 'failed'
    when safety.visual_complete and safety.audio_complete and safety.text_complete
      and safety.evidence_generation=safety.generation then 'completed'
    when scan.status='processing' or scan.text_status='processing' or scan.visual_status='processing'
      or scan.audio_status='processing' then 'processing' else 'queued' end scan_status
  from private.story_safety_state safety
  left join private.content_safety_scans scan on scan.id=safety.scan_id and scan.target_type='story'
    and scan.target_id=safety.story_id
    and safety.evidence_fingerprint=(select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'version','stories-safety-evidence-c1-v1',
    'story',s.id,'owner',s.user_id,'kind',s.story_kind,'source',s.shared_video_id,
    'legacy',s.media_url,'type',s.media_type,'composition',s.story_composition,
    'author_text',(with definitions as (
    select e.public_config,pg_catalog.row_number() over(order by e.element_id) element_order
    from private.story_interactive_elements e where e.story_id=safety.story_id
  )
  select coalesce(pg_catalog.string_agg(parts.value,E'\\n' order by parts.section,parts.element_order,parts.option_order),'')
  from (
    select 0 section,x.ordinality element_order,0::bigint option_order,x.element->>'text' value
    from public.stories s
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb))
      with ordinality x(element,ordinality)
    where s.id=safety.story_id and x.element->>'type'='text'
    union all
    select 0 section,x.ordinality element_order,0::bigint option_order,x.element->>'value'
    from public.stories s
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb))
      with ordinality x(element,ordinality)
    where s.id=safety.story_id and x.element->>'type'='sticker'
    union all
    select 1,e.element_order,0::bigint,e.public_config->>'prompt'
    from definitions e
    union all
    select 1,e.element_order,1::bigint,e.public_config->>'emoji'
    from definitions e where e.public_config->>'type' in('slider','reaction')
    union all
    select 1,e.element_order,o.ordinality+1,o.option->>'label'
    from definitions e
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(e.public_config->'options','[]'::jsonb))
      with ordinality o(option,ordinality)
  ) parts where parts.value is not null),
    'shared_source',case when s.shared_video_id is not null then pg_catalog.jsonb_build_object(
      'owner',source.snapshot->>'owner_user_id','content_version',source.snapshot->>'content_version') end,
    'definitions',(select pg_catalog.jsonb_agg(e.definition_digest order by e.element_id)
      from private.story_interactive_elements e where e.story_id=s.id),
    'r2',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'link',l.id,'id',a.id,'owner',a.owner_id,'status',a.status,'provider',a.provider,
        'purpose',a.purpose,'visibility',a.visibility,'bucket',a.bucket_name,'key',a.object_key,
        'mime',a.mime_type,'size',a.size_bytes,'deleted_at',a.deleted_at,'public_url',a.public_url,
        'contract',a.lifecycle_contract_version) order by l.id)
      from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0),
    'stream',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'link',l.id,'id',a.id,'owner',a.owner_id,'status',a.status,'provider',a.provider,
        'purpose',a.purpose,'visibility',a.visibility,'uid',a.cloudflare_uid,
        'mime',a.mime_type,'size',a.size_bytes,'duration',a.duration_seconds,
        'max_duration',a.max_duration_seconds,'deleted_at',a.deleted_at,
        'hls_url',a.hls_url,'dash_url',a.dash_url,'thumbnail_url',a.thumbnail_url,
        'signed',a.provider_metadata->'require_signed_urls',
        'contract',a.lifecycle_contract_version) order by l.id)
      from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0)
  )::text,'UTF8')),'hex')
  from public.stories s
  left join lateral (select (select pg_catalog.jsonb_build_object(
      'owner_user_id',video.user_id,
      'content_version',pg_catalog.jsonb_build_object('caption',video.caption,'video_url',video.video_url,
        'media_urls',video.media_urls,'edited_at',video.edited_at,'created_at',video.created_at)::text)
      from public.videos video where video.id=s.shared_video_id) snapshot
    where s.shared_video_id is not null) source on true
  where s.id=safety.story_id)
    and scan.content_fingerprint=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'story|'||safety.story_id::text||'|'||safety.evidence_fingerprint,'UTF8')),'hex')
)
select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',true,'installed',installed_state.installed,
  'policy_id',case when installed_state.installed then
    (select pg_catalog.substring(prosrc,'"policy_id"[[:space:]]*:[[:space:]]*"([^"]+)"') from policy_source) end,
  'policy_artifact_sha256',case when installed_state.installed then
    (select pg_catalog.substring(prosrc,'"policy_artifact_sha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})"') from control_source) end,
  'control',case when installed_state.installed then (select pg_catalog.split_part(prosrc,'$control$',2)::jsonb from control_source) end,
  'approved_story_rule_count',(select pg_catalog.count(*)::integer from private.content_safety_rules rule
    where rule.approval_state='approved'
      and rule.scopes&&array['story_image','story_video','story_audio','story_text']::text[]),
  'passed_count',(select pg_catalog.count(*)::integer from private.story_safety_state where state='passed'),
  'policy_digest_count',(select pg_catalog.count(*)::integer from private.story_safety_state where policy_digest is not null),
  'story_count',story_inventory.count,'safety_state_count',safety_inventory.count,
  'story_inventory_sha256',story_inventory.sha256,'safety_inventory_sha256',safety_inventory.sha256,
  'transcript_refresh_trigger_installed',(select pg_catalog.count(*)=1 from trigger_rows),
  'trigger',case when installed_state.installed then (select pg_catalog.jsonb_build_object(
    'name',name,'table',table_name,'enabled',enabled,'function_identity',function_identity,
    'definition_sha256',definition_sha256) from trigger_rows) end,
  'alert_trigger',(select pg_catalog.jsonb_build_object(
    'name',name,'table',table_name,'enabled',enabled,'function_identity',function_identity,
    'definition_sha256',definition_sha256) from alert_trigger_rows),
  'initialization_trigger',(select pg_catalog.jsonb_build_object(
    'name',name,'table',table_name,'enabled',enabled,'function_identity',function_identity,
    'definition_sha256',definition_sha256) from initialization_trigger_rows),
  'columns',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name',attribute.attname,'type',pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
    'not_null',attribute.attnotnull,'default',pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid))
    order by attribute.attname)
    from pg_catalog.pg_attribute attribute left join pg_catalog.pg_attrdef default_value
      on default_value.adrelid=attribute.attrelid and default_value.adnum=attribute.attnum
    where attribute.attrelid='private.story_safety_state'::regclass and not attribute.attisdropped
      and attribute.attname=any(array['publication_status','moderation_status','published_at','publication_policy_id',
        'moderation_actor_id','moderation_reason','moderated_at']::text[])),
  'enabled_numeric_story_rule_count',(select pg_catalog.count(*)::integer from private.content_safety_rules rule
    where rule.enabled and rule.scopes&&array['story_image','story_video','story_audio','story_text']::text[]),
  'published_without_current_scan_count',(select pg_catalog.count(*)::integer from runtime
    where publication_status='published' and (scan_status is null
      or publication_policy_id is distinct from 'nelyon.stories.general.safety.publish_first.v1' or published_at is null)),
  'no_current_scan_count',(select pg_catalog.count(*)::integer from runtime where scan_status is null),
  'publication_metadata_count',(select pg_catalog.count(*)::integer from runtime where published_at is not null
    or publication_policy_id is not null or moderation_actor_id is not null or moderation_reason is not null or moderated_at is not null),
  'publication_status',(select pg_catalog.jsonb_build_object(
    'unpublished',pg_catalog.count(*) filter(where publication_status='unpublished')::integer,
    'published',pg_catalog.count(*) filter(where publication_status='published')::integer,
    'restricted',pg_catalog.count(*) filter(where publication_status='restricted')::integer,
    'removed',pg_catalog.count(*) filter(where publication_status='removed')::integer
  ) from runtime),
  'moderation_status',(select pg_catalog.jsonb_build_object(
    'unreviewed',pg_catalog.count(*) filter(where moderation_status='unreviewed')::integer,
    'alerted',pg_catalog.count(*) filter(where moderation_status='alerted')::integer,
    'reviewed_keep',pg_catalog.count(*) filter(where moderation_status='reviewed_keep')::integer,
    'reviewed_restrict',pg_catalog.count(*) filter(where moderation_status='reviewed_restrict')::integer,
    'reviewed_remove',pg_catalog.count(*) filter(where moderation_status='reviewed_remove')::integer
  ) from runtime),
  'scan_status',(select pg_catalog.jsonb_build_object(
    'queued',pg_catalog.count(*) filter(where scan_status='queued')::integer,
    'processing',pg_catalog.count(*) filter(where scan_status='processing')::integer,
    'completed',pg_catalog.count(*) filter(where scan_status='completed')::integer,
    'failed',pg_catalog.count(*) filter(where scan_status='failed')::integer
  ) from runtime),
  'helpers',case when installed_state.installed then coalesce((select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('identity',identity,'owner',owner,'security_definer',security_definer,
      'search_path',search_path,'execute',execute,'acl',acl,'definition_sha256',definition_sha256)
    order by identity) from function_rows),'[]'::jsonb) else '[]'::jsonb end
) snapshot from installed_state cross join story_inventory cross join safety_inventory;`;

// QA C1 changes author-text reconstruction without rewriting the historical C2 query.
export const STORIES_SAFETY_C2_QA_STATE_SQL = STORIES_SAFETY_C2_STATE_SQL.replace(
  `    where s.id=safety.story_id and x.element->>'type'='sticker'
    union all
    select 1,e.element_order,0::bigint,e.public_config->>'prompt'`,
  `    where s.id=safety.story_id and x.element->>'type'='sticker'
    union all
    select 0,x.ordinality,q.option_order,q.value
    from public.stories s
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(s.story_composition->'elements','[]'::jsonb)
    ) with ordinality x(element,ordinality)
    cross join lateral (values
      (0::bigint,x.element->>'question'),
      (1::bigint,x.element->>'answer')
    ) q(option_order,value)
    where s.id=safety.story_id and x.element->>'type'='question_answer'
    union all
    select 1,e.element_order,0::bigint,e.public_config->>'prompt'`,
);

export const STORIES_QA_C1_PRE_STATE_SQL = `with expected(identity) as (
  values
    ('private.story_validate_composition(jsonb)'),
    ('private.story_author_text_bundle_c1_v1(uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid,jsonb)'),
    ('public.create_story_from_content(uuid,jsonb,uuid)'),
    ('public.create_story_from_content(uuid,jsonb,uuid,jsonb)')
), allowed(identity) as (
  values
    ('private.story_validate_composition(jsonb)'),
    ('private.story_author_text_bundle_c1_v1(uuid)'),
    ('private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid)'),
    ('public.prepare_story_question_answer(uuid,uuid,uuid)'),
    ('public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb)'),
    ('private.story_check_question_answer_link_qa_c1_v1()'),
    ('public.create_story_with_media(uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid,jsonb)'),
    ('public.create_story_from_content(uuid,jsonb,uuid)'),
    ('public.create_story_from_content(uuid,jsonb,uuid,jsonb)')
), function_rows as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' identity,
    owner_role.rolname owner,p.provolatile volatility,p.prosecdef security_definer,
    coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    pg_catalog.jsonb_build_object(
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public',pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) execute,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable)
      order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  join expected e on e.identity=n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')'
), unexpected_overloads as (
  select pg_catalog.count(*)::integer count
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in (
    ('private','story_validate_composition'),('private','story_author_text_bundle_c1_v1'),
    ('private','story_question_answer_source_qa_c1_v1'),('public','prepare_story_question_answer'),
    ('public','create_story_question_answer_with_media'),('private','story_check_question_answer_link_qa_c1_v1'),
    ('public','create_story_with_media'),('public','create_story_from_content'))
    and not exists(select 1 from allowed a where a.identity=n.nspname||'.'||p.proname||'('||
      pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')')
), future_objects as (
  select ((pg_catalog.to_regprocedure('private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid)') is not null)::integer
    +(pg_catalog.to_regprocedure('public.prepare_story_question_answer(uuid,uuid,uuid)') is not null)::integer
    +(pg_catalog.to_regprocedure('public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb)') is not null)::integer
    +(pg_catalog.to_regprocedure('private.story_check_question_answer_link_qa_c1_v1()') is not null)::integer
    +(pg_catalog.to_regclass('private.story_question_answer_links') is not null)::integer
    +(exists(select 1 from pg_catalog.pg_trigger where not tgisinternal
      and (tgname='story_question_answer_link_required'
        or tgfoid=pg_catalog.to_regprocedure('private.story_check_question_answer_link_qa_c1_v1()'))))::integer) count
)
select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',(select pg_catalog.count(*) from function_rows)=6 and future_objects.count=0
    and (select count from unexpected_overloads)=0,
  'installed',false,'initial_link_count',0,
  'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'identity',identity,'owner',owner,'volatility',volatility,'security_definer',security_definer,
    'search_path',search_path,'execute',execute,'acl',acl,'definition_sha256',definition_sha256) order by identity)
    from function_rows),'[]'::jsonb),
  'relation',null,'trigger',null
) snapshot from future_objects;`;

export const STORIES_QA_C1_POST_STATE_SQL = `with expected(identity) as (
  values
    ('private.story_validate_composition(jsonb)'),
    ('private.story_author_text_bundle_c1_v1(uuid)'),
    ('private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid)'),
    ('public.prepare_story_question_answer(uuid,uuid,uuid)'),
    ('public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb)'),
    ('private.story_check_question_answer_link_qa_c1_v1()'),
    ('public.create_story_with_media(uuid,jsonb,uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid,jsonb)'),
    ('public.create_story_from_content(uuid,jsonb,uuid)'),
    ('public.create_story_from_content(uuid,jsonb,uuid,jsonb)')
), allowed(identity) as (
  values
    ('private.story_validate_composition(jsonb)'),
    ('private.story_author_text_bundle_c1_v1(uuid)'),
    ('private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid)'),
    ('public.prepare_story_question_answer(uuid,uuid,uuid)'),
    ('public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb)'),
    ('private.story_check_question_answer_link_qa_c1_v1()'),
    ('public.create_story_with_media(uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid)'),
    ('public.create_story_with_media(uuid,jsonb,uuid,jsonb)'),
    ('public.create_story_from_content(uuid,jsonb,uuid)'),
    ('public.create_story_from_content(uuid,jsonb,uuid,jsonb)')
), function_rows as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' identity,
    owner_role.rolname owner,p.provolatile volatility,p.prosecdef security_definer,
    coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    pg_catalog.jsonb_build_object(
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public',pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) execute,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable)
      order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  join expected e on e.identity=n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')'
), unexpected_overloads as (
  select pg_catalog.count(*)::integer count
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in (
    ('private','story_validate_composition'),('private','story_author_text_bundle_c1_v1'),
    ('private','story_question_answer_source_qa_c1_v1'),('public','prepare_story_question_answer'),
    ('public','create_story_question_answer_with_media'),('private','story_check_question_answer_link_qa_c1_v1'),
    ('public','create_story_with_media'),('public','create_story_from_content'))
    and not exists(select 1 from allowed a where a.identity=n.nspname||'.'||p.proname||'('||
      pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')')
), relation_row as (
  select n.nspname schema,c.relname name,owner_role.rolname owner,c.relrowsecurity rls_enabled,
    c.relforcerowsecurity force_rls,(select pg_catalog.count(*)::integer from pg_catalog.pg_policy p where p.polrelid=c.oid) policy_count,
    (select pg_catalog.count(*)::integer from pg_catalog.pg_publication_rel pr where pr.prrelid=c.oid) realtime_membership_count,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable)
      order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('position',a.attnum,'name',a.attname,
      'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
      from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns,
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'name',con.conname,'type',con.contype,'definition',pg_catalog.pg_get_constraintdef(con.oid,true),
      'columns',(select pg_catalog.jsonb_agg(a.attname order by key.n) from pg_catalog.unnest(con.conkey) with ordinality key(attnum,n)
        join pg_catalog.pg_attribute a on a.attrelid=con.conrelid and a.attnum=key.attnum),
      'referenced_relation',case when con.confrelid<>0 then rn.nspname||'.'||rc.relname end,
      'referenced_columns',case when con.confrelid<>0 then (select pg_catalog.jsonb_agg(a.attname order by key.n)
        from pg_catalog.unnest(con.confkey) with ordinality key(attnum,n)
        join pg_catalog.pg_attribute a on a.attrelid=con.confrelid and a.attnum=key.attnum) end,
      'update_action',case when con.contype='f' then con.confupdtype::text end,
      'delete_action',case when con.contype='f' then con.confdeltype::text end,
      'valid',con.convalidated,'deferrable',con.condeferrable,'initially_deferred',con.condeferred)) order by con.conname)
      from pg_catalog.pg_constraint con left join pg_catalog.pg_class rc on rc.oid=con.confrelid
      left join pg_catalog.pg_namespace rn on rn.oid=rc.relnamespace where con.conrelid=c.oid) constraints,
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',ic.relname,
      'definition',pg_catalog.pg_get_indexdef(i.indexrelid),'columns',(select pg_catalog.jsonb_agg(a.attname order by key.n)
        from pg_catalog.unnest(i.indkey) with ordinality key(attnum,n)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=key.attnum),
      'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,
      'predicate',pg_catalog.pg_get_expr(i.indpred,i.indrelid),'expression',pg_catalog.pg_get_expr(i.indexprs,i.indrelid)) order by ic.relname)
      from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid) indexes
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=c.relowner
  where n.nspname='private' and c.relname='story_question_answer_links' and c.relkind='r'
), trigger_row as (
  select t.tgname name,n.nspname||'.'||c.relname table_name,
    fnn.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' function_identity,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid,true),'UTF8')),'hex') definition_sha256,
    t.tgtype::integer tgtype,t.tgenabled enabled,t.tgisinternal internal,t.tgdeferrable deferrable,t.tginitdeferred initially_deferred
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace fnn on fnn.oid=p.pronamespace
  where not t.tgisinternal and t.tgname='story_question_answer_link_required'
), protected_trigger_count as (
  select pg_catalog.count(*)::integer count
  from pg_catalog.pg_trigger t
  where not t.tgisinternal and (t.tgname='story_question_answer_link_required'
    or t.tgfoid=pg_catalog.to_regprocedure('private.story_check_question_answer_link_qa_c1_v1()'))
)
select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',(select pg_catalog.count(*) from function_rows)=10
    and (select pg_catalog.count(*) from relation_row)=1 and (select pg_catalog.count(*) from trigger_row)=1
    and (select count from protected_trigger_count)=1 and (select count from unexpected_overloads)=0,
  'installed',(select pg_catalog.count(*) from function_rows)=10
    and (select pg_catalog.count(*) from relation_row)=1 and (select pg_catalog.count(*) from trigger_row)=1
    and (select count from protected_trigger_count)=1 and (select count from unexpected_overloads)=0,
  'initial_link_count',(select pg_catalog.count(*)::integer from private.story_question_answer_links),
  'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'identity',identity,'owner',owner,'volatility',volatility,'security_definer',security_definer,
    'search_path',search_path,'execute',execute,'acl',acl,'definition_sha256',definition_sha256) order by identity)
    from function_rows),'[]'::jsonb),
  'relation',(select pg_catalog.to_jsonb(relation_row) from relation_row),
  'trigger',(select pg_catalog.jsonb_build_object('name',trigger_row.name,'table',trigger_row.table_name,
    'function_identity',trigger_row.function_identity,'definition_sha256',trigger_row.definition_sha256,
    'tgtype',trigger_row.tgtype,'enabled',trigger_row.enabled,'internal',trigger_row.internal,
    'deferrable',trigger_row.deferrable,'initially_deferred',trigger_row.initially_deferred) from trigger_row)
) snapshot;`;

export const SUPERUSER_CONTROL_CENTER_STATE_SQL = `with expected(identity) as (
  values
    ('public.admin_actor_has_capability(text)'),
    ('public.admin_require_capability(text)'),
    ('public.get_my_admin_access()'),
    ('public.search_admin_finance_audit(text,uuid,text,uuid,text,timestampwithtimezone,timestampwithtimezone,timestampwithtimezone,uuid,integer)'),
    ('public.search_admin_financial_transactions(text,text,text,text,timestampwithtimezone,timestampwithtimezone,timestampwithtimezone,uuid,integer)'),
    ('public.search_admin_global_audit(text,text,uuid,text,uuid,text,boolean,timestampwithtimezone,timestampwithtimezone,timestampwithtimezone,uuid,integer)'),
    ('public.search_admin_ledger_accounts(text,text,boolean,uuid,timestampwithtimezone,uuid,integer)'),
    ('public.search_admin_system_audit(text,text,timestampwithtimezone,uuid,integer)'),
    ('public.get_admin_control_center_overview_v1(text,date,date)'),
    ('public.search_admin_advertising_ads(text,integer,timestampwithtimezone,uuid,uuid)')
), function_rows as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' identity,
    owner_role.rolname owner,p.provolatile volatility,p.prosecdef security_definer,
    coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    pg_catalog.jsonb_build_object(
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public',pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) execute,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable)
      order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  join expected e on e.identity=n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')'
), predecessor_row as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' identity,
    owner_role.rolname owner,p.provolatile volatility,p.prosecdef security_definer,
    coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    pg_catalog.jsonb_build_object(
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public',pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) execute,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable)
      order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  where n.nspname='public' and p.proname='search_admin_advertising_ads'
    and pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')='text,integer'
), capability_state as (
  select pg_catalog.count(*)::integer capability_count,
    coalesce(pg_catalog.jsonb_agg(c.capability_code order by c.capability_code)
      filter(where coalesce(pg_catalog.to_jsonb(c)->>'required_aal','aal1')='aal2'),'[]'::jsonb) aal2_codes
  from private.admin_capabilities c
), refund_roles as (
  select coalesce(pg_catalog.jsonb_agg(rc.role_code order by rc.role_code),'[]'::jsonb) items
  from private.admin_role_capabilities rc where rc.capability_code='creator_premium.refunds.write'
), root_role as (
  select pg_catalog.jsonb_build_object('role_code',r.role_code,'is_root',r.is_root,
    'is_exclusive',r.is_exclusive,'is_assignable',r.is_assignable) item
  from private.admin_roles r where r.role_code='SUPER_ADMIN'
), index_row as (
  select n.nspname schema_name,t.relname table_name,i.relname name,owner_role.rolname owner,
    pg_catalog.pg_get_indexdef(i.oid) definition,x.indisvalid valid,x.indisready ready,
    x.indisunique unique_index,x.indisprimary primary_index
  from pg_catalog.pg_class i join pg_catalog.pg_namespace n on n.oid=i.relnamespace
  join pg_catalog.pg_index x on x.indexrelid=i.oid join pg_catalog.pg_class t on t.oid=x.indrelid
  join pg_catalog.pg_roles owner_role on owner_role.oid=i.relowner
  where n.nspname='private' and i.relname='advertising_ads_submitted_cursor_idx'
), bounded_observations as (
  select
    (select pg_catalog.count(*)::integer from (
      select 1 from auth.mfa_factors order by created_at desc,id desc limit 1001
    ) bounded_mfa) mfa_rows,
    (select pg_catalog.count(*)::integer from (
      select 1 from private.admin_action_audit order by created_at desc,id desc limit 1001
    ) bounded_audit) audit_rows,
    (select pg_catalog.count(*)::integer from (
      select 1 from private.advertising_ads order by submitted_at nulls last,id limit 1001
    ) bounded_ads) ads_rows,
    exists(select 1 from private.admin_action_audit audit
      where (($1::text<>'' and pg_catalog.strpos(pg_catalog.concat_ws('|',audit.idempotency_scope,
        audit.idempotency_key::text,audit.target_ref,audit.metadata::text,audit.reason,audit.action),$1::text)>0)
        or ($2::text<>'' and pg_catalog.strpos(pg_catalog.concat_ws('|',audit.idempotency_scope,
        audit.idempotency_key::text,audit.target_ref,audit.metadata::text,audit.reason,audit.action),$2::text)>0))
      limit 1) admin_audit_release_attributed
), install_state as (
  select exists(select 1 from pg_catalog.pg_attribute a
    where a.attrelid='private.admin_capabilities'::pg_catalog.regclass and a.attname='required_aal'
      and a.attnum>0 and not a.attisdropped) has_required_aal,
    (select pg_catalog.count(*) from function_rows)=10 has_functions,
    not exists(select 1 from predecessor_row) predecessor_removed,
    exists(select 1 from index_row) has_index
)
select pg_catalog.jsonb_build_object(
  'schema_version',1,'complete',(select capability_count from capability_state)=54
    and (select pg_catalog.count(*) from root_role)=1,
  'installed',install_state.has_required_aal and install_state.has_functions
    and install_state.predecessor_removed and install_state.has_index,
  'capability_count',(select capability_count from capability_state),
  'aal2_codes',(select aal2_codes from capability_state),
  'refund_roles',(select items from refund_roles),
  'root_role',(select item from root_role),
  'root_grant_rule_count',(select pg_catalog.count(*)::integer from private.admin_role_grant_rules where target_role_code='SUPER_ADMIN'),
  'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'identity',identity,'owner',owner,'volatility',volatility,'security_definer',security_definer,
    'search_path',search_path,'execute',execute,'acl',acl,'definition_sha256',definition_sha256) order by identity)
    from function_rows),'[]'::jsonb),
  'predecessor_function',(select pg_catalog.to_jsonb(predecessor_row) from predecessor_row),
  'index',(select pg_catalog.jsonb_build_object('schema',schema_name,'table',table_name,'name',name,
    'owner',owner,'definition',definition,'valid',valid,'ready',ready,'unique',unique_index,'primary',primary_index) from index_row),
  'bounded_observations',pg_catalog.jsonb_build_object(
    'probe_limit',1001,
    'mfa_factors',pg_catalog.jsonb_build_object('observed_rows',bounded_observations.mfa_rows,
      'saturated',bounded_observations.mfa_rows=1001),
    'admin_action_audit',pg_catalog.jsonb_build_object('observed_rows',bounded_observations.audit_rows,
      'saturated',bounded_observations.audit_rows=1001),
    'advertising_ads',pg_catalog.jsonb_build_object('observed_rows',bounded_observations.ads_rows,
      'saturated',bounded_observations.ads_rows=1001),
    'admin_audit_release_attributed',bounded_observations.admin_audit_release_attributed)
) snapshot from install_state cross join bounded_observations;`;

export const SUPERUSER_QA_PERF_C1_STATE_SQL = `with expected(identity) as (
  values ('public.get_admin_system_health()'),('public.get_marketplace_admin_health()')
), function_rows as (
  select n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')' identity,
    owner_role.rolname owner,p.provolatile volatility,p.prosecdef security_definer,
    coalesce(pg_catalog.to_jsonb(p.proconfig),'[]'::jsonb) search_path,
    pg_catalog.jsonb_build_object(
      'anon',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public',pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'),
      'service_role',pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) execute,
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantee',case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
      'privilege_type',acl.privilege_type,'is_grantable',acl.is_grantable)
      order by case when acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,acl.privilege_type,acl.is_grantable)
      from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=acl.grantee),'[]'::jsonb) acl,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') definition_sha256
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  join expected e on e.identity=n.nspname||'.'||p.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes),' ','')||')'
), cron_history_row as (
  select n.nspname schema_name,c.relname table_name,c.relkind relation_kind,
    schema_owner.rolname schema_owner,table_owner.rolname table_owner,e.extname extension_name,
    primary_index.index_name primary_index_name,
    primary_index.key_columns primary_index_key_columns,
    primary_index.included_columns primary_index_included_columns,
    primary_index.is_primary primary_index_primary,
    primary_index.is_unique primary_index_unique,
    primary_index.is_valid primary_index_valid,
    primary_index.is_ready primary_index_ready,
    primary_index.has_predicate primary_index_predicate,
    primary_index.has_expressions primary_index_expressions,
    'cron_job_run_details_start_job_cover_idx' release_index_name,
    pg_catalog.to_regclass('cron.cron_job_run_details_start_job_cover_idx') is not null release_index_present
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_roles schema_owner on schema_owner.oid=n.nspowner
  join pg_catalog.pg_roles table_owner on table_owner.oid=c.relowner
  join pg_catalog.pg_depend d on d.classid='pg_class'::pg_catalog.regclass and d.objid=c.oid
    and d.refclassid='pg_extension'::pg_catalog.regclass and d.deptype='e'
  join pg_catalog.pg_extension e on e.oid=d.refobjid
  join lateral (
    select index_class.relname index_name,
      (select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(i.indexrelid,position,true)
        order by position),'[]'::jsonb)
       from pg_catalog.generate_series(1,i.indnkeyatts) position) key_columns,
      (select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(i.indexrelid,position,true)
        order by position),'[]'::jsonb)
       from pg_catalog.generate_series(i.indnkeyatts+1,i.indnatts) position) included_columns,
      i.indisprimary is_primary,i.indisunique is_unique,i.indisvalid is_valid,i.indisready is_ready,
      i.indpred is not null has_predicate,i.indexprs is not null has_expressions
    from pg_catalog.pg_index i
    join pg_catalog.pg_class index_class on index_class.oid=i.indexrelid
    where i.indrelid=c.oid and i.indisprimary
  ) primary_index on true
  where n.nspname='cron' and c.relname='job_run_details'
), finance_row as (
  select activation_mode,active_authorization_id is not null active_authorization,
    platform_fee_bps,purchase_enabled,refunds_enabled,subscription_enabled
  from private.creator_premium_finance_policy where singleton
), install_state as (
  select (select pg_catalog.count(*) from function_rows)=2 functions_complete,
    exists(select 1 from function_rows where identity='public.get_admin_system_health()'
      and definition_sha256='59810b955f97c8d9538a8833f4aec5da994de2ff302d5706aceeb80a35f51c72') system_successor,
    exists(select 1 from function_rows where identity='public.get_marketplace_admin_health()'
      and definition_sha256='be6d8747efe5066ecf514e1b38b7d4b28444e1bc53484208430f9a2b7884e233'
      and search_path='["search_path=pg_catalog, private, public","join_collapse_limit=1","from_collapse_limit=1"]'::jsonb) marketplace_successor,
    exists(select 1 from cron_history_row where relation_kind='r'
      and schema_owner='supabase_admin' and table_owner='supabase_admin'
      and extension_name='pg_cron'
      and primary_index_name='job_run_details_pkey'
      and primary_index_key_columns='["runid"]'::jsonb
      and primary_index_included_columns='[]'::jsonb
      and primary_index_primary and primary_index_unique
      and primary_index_valid and primary_index_ready
      and not primary_index_predicate and not primary_index_expressions
      and not release_index_present) cron_history_exact,
    (select pg_catalog.count(*) from finance_row)=1 finance_complete
)
select pg_catalog.jsonb_build_object(
  'schema_version',3,
  'complete',install_state.functions_complete and install_state.finance_complete
    and (select pg_catalog.count(*) from cron_history_row)=1,
  'installed',install_state.functions_complete and install_state.finance_complete
    and install_state.system_successor and install_state.marketplace_successor and install_state.cron_history_exact,
  'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'identity',identity,'owner',owner,'volatility',volatility,'security_definer',security_definer,
    'search_path',search_path,'execute',execute,'acl',acl,'definition_sha256',definition_sha256) order by identity)
    from function_rows),'[]'::jsonb),
  'cron_history',(select pg_catalog.jsonb_build_object('schema',schema_name,'table',table_name,
    'relation_kind',relation_kind,'schema_owner',schema_owner,'table_owner',table_owner,
    'extension',extension_name,'primary_index',pg_catalog.jsonb_build_object(
      'name',primary_index_name,'key_columns',primary_index_key_columns,
      'included_columns',primary_index_included_columns,
      'primary',primary_index_primary,'unique',primary_index_unique,
      'valid',primary_index_valid,'ready',primary_index_ready,
      'predicate',primary_index_predicate,'expressions',primary_index_expressions),
    'release_index_name',release_index_name,
    'release_index_present',release_index_present) from cron_history_row),
  'finance',(select pg_catalog.jsonb_build_object('activation_mode',activation_mode,
    'active_authorization',active_authorization,'platform_fee_bps',platform_fee_bps,
    'purchase_enabled',purchase_enabled,'refunds_enabled',refunds_enabled,
    'subscription_enabled',subscription_enabled) from finance_row)
) snapshot from install_state;`;

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

function storiesB1Transition(policy, manifest) {
  const expected = policy?.stories_b1_transition;
  const attestation = manifest?.resources?.stories_b1_transition;
  if (!attestation) return null;
  const expectedAttestation = expected && {
    ...expected,
    approved_sha: manifest?.identity?.approved_sha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
  };
  if (!expected || canonicalJson(attestation) !== canonicalJson(expectedAttestation)) {
    fail('INVALID_STORIES_B1_TRANSITION', 'Stories B1 manifest attestation differs from policy');
  }
  return expected;
}

function storiesB1RecoverySource(policy, manifest, phase, { request, migrations } = {}) {
  if (phase !== 'recovery' || request?.mode !== 'postcheck_recovery'
    || request?.scopeConfirmation !== 'POSTCHECK_RECOVERY_READ_ONLY'
    || String(request?.recoverySourceRunId ?? '') !== '40473092474'
    || manifest?.identity?.mode !== 'postcheck_recovery'
    || canonicalJson(manifest?.resources ?? null) !== canonicalJson({
      config_changed: false,
      function_contracts: [],
      functions: [],
      migrations: [],
    })) return null;
  const source = policy?.postcheck_recovery?.approved_sources?.find(item => item.run_id === '40473092474');
  if (!source || source.expected_latest_migration !== STORIES_B1_MIGRATION
    || source.expected_migration_count !== policy?.baseline?.migration_count + 1) return null;
  if (migrations && (!hasExactBaselineMigrationAppend(policy, migrations, STORIES_B1_MIGRATION)
    || !source.expected_migrations.every(expected => migrations.items.filter(item => (
      `${item?.version}_${item?.name}` === expected.name
    )).length === 1))) return null;
  return source;
}

function storiesB1StateRequirement(policy, manifest, phase, context = {}) {
  const transition = storiesB1Transition(policy, manifest);
  const installed = String(policy?.baseline?.latest_migration ?? '') >= STORIES_B1_MIGRATION;
  const recovery = storiesB1RecoverySource(policy, manifest, phase, context);
  const required = Boolean(transition) || installed || Boolean(recovery);
  const usePredecessor = Boolean(transition) && phase === 'pre' && !installed;
  return {
    required,
    transition,
    installed,
    recovery,
    query: usePredecessor ? STORIES_B1_PRE_STATE_SQL : STORIES_B1_POST_STATE_SQL,
    query_id: `nelyon-stories-b1-${usePredecessor ? 'pre' : 'post'}-state-v1`,
  };
}

function storiesSafetyC1Transition(policy, manifest) {
  const expected = policy?.stories_safety_c1_transition;
  const attestation = manifest?.resources?.stories_safety_c1_transition;
  if (!attestation) return null;
  const expectedAttestation = expected && {
    ...expected,
    approved_sha: manifest?.identity?.approved_sha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
  };
  if (!expected || canonicalJson(attestation) !== canonicalJson(expectedAttestation)) {
    fail('INVALID_STORIES_SAFETY_C1_TRANSITION',
      'Stories Safety C1 manifest attestation differs from policy');
  }
  return expected;
}

function storiesSafetyC2Transition(policy, manifest) {
  const expected = policy?.stories_safety_c2_transition;
  const attestation = manifest?.resources?.stories_safety_c2_transition;
  if (!attestation) return null;
  if (!expected || canonicalJson(attestation) !== canonicalJson({
    ...expected, approved_sha: manifest?.identity?.approved_sha,
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
  })) fail('INVALID_STORIES_SAFETY_C2_TRANSITION', 'Stories Safety C2 manifest attestation differs from policy');
  return expected;
}

export function storiesSafetyC2StateRequirement(policy, manifest, phase, { request, migrations } = {}) {
  const authority = policy?.stories_safety_c2_transition;
  const migration = authority?.migration_path?.split('/').at(-1)?.replace(/\.sql$/, '');
  const transition = storiesSafetyC2Transition(policy, manifest);
  let observedInstalled = false;
  if (migration && migrations) {
    try {
      validateNormalizedMigrations(migrations);
      observedInstalled = migrations.items.some(item => baselineMigrationName(item) === migration);
    } catch {
      // Incomplete or malformed observations cannot establish installed authority.
    }
  }
  const installed = Boolean(migration)
    && (String(policy?.baseline?.latest_migration ?? '') >= migration || observedInstalled);
  const source = phase === 'recovery' && request?.mode === 'postcheck_recovery'
    && request?.scopeConfirmation === 'POSTCHECK_RECOVERY_READ_ONLY'
    && manifest?.identity?.mode === 'postcheck_recovery'
    && canonicalJson(manifest?.resources ?? null) === canonicalJson({
      config_changed: false, function_contracts: [], functions: [], migrations: [],
    })
    ? policy?.postcheck_recovery?.approved_sources?.find(item => String(item.run_id) === String(request.recoverySourceRunId))
    : null;
  const recovery = Boolean(migration) && source?.expected_latest_migration === migration
    && source.expected_migration_count === policy?.baseline?.migration_count + 1
    && canonicalJson(source.expected_migrations) === canonicalJson([{ name: migration, blob: authority.migration_blob }])
    && canonicalJson((source.edge_functions ?? []).map(item => item.name).sort())
      === canonicalJson((authority.functions ?? []).map(item => item.name).sort())
    && (source.edge_functions ?? []).every(item => item.status === 'ACTIVE'
      && Number.isInteger(item.version) && item.version > 0 && HASH_PATTERN.test(item.source_sha256 ?? '')
      && item.verify_jwt === authority.functions.find(expected => expected.name === item.name)?.verify_jwt)
    && (!migrations || hasExactBaselineMigrationAppend(policy, migrations, migration));
  return {
    required: installed || Boolean(transition && phase !== 'pre') || recovery,
    installed, transition, recovery,
    query_id: 'nelyon-stories-safety-c2-state-v1',
  };
}

function storiesQaC1Transition(policy, manifest) {
  const expected = policy?.stories_qa_c1_transition;
  const attestation = manifest?.resources?.stories_qa_c1_transition;
  if (!attestation) return null;
  if (!expected || canonicalJson(attestation) !== canonicalJson({
    ...expected, approved_sha: manifest?.identity?.approved_sha,
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_source_descendant_verified: true,
  })) fail('INVALID_STORIES_QA_C1_TRANSITION', 'Stories QA C1 manifest attestation differs from policy');
  return expected;
}

function storiesQaC1RecoverySource(policy, manifest, phase, {
  request, migrations, migration, authority,
} = {}) {
  if (phase !== 'recovery') return null;
  const source = policy?.postcheck_recovery?.approved_sources?.find(
    item => String(item?.run_id ?? '') === String(request?.recoverySourceRunId ?? ''),
  );
  const claimsQa = source?.expected_latest_migration === migration
    || (source?.expected_migrations ?? []).some(item => item?.name === migration);
  if (!claimsQa) return null;
  const emptyResources = {
    config_changed: false,
    function_contracts: [],
    functions: [],
    migrations: [],
  };
  const exact = request?.mode === 'postcheck_recovery'
    && request?.scopeConfirmation === 'POSTCHECK_RECOVERY_READ_ONLY'
    && manifest?.identity?.mode === 'postcheck_recovery'
    && canonicalJson(manifest?.resources ?? null) === canonicalJson(emptyResources)
    && source?.repository === policy?.repository
    && source?.mutation_status === 'completed'
    && source?.expected_latest_migration === migration
    && source?.expected_migration_count === policy?.baseline?.migration_count + 1
    && canonicalJson(source?.expected_migrations ?? null) === canonicalJson([{
      blob: authority?.migration_blob,
      name: migration,
    }])
    && canonicalJson(source?.edge_functions ?? null) === canonicalJson([])
    && canonicalJson(source?.productive_resources ?? null) === canonicalJson([`migration:${migration}`])
    && hasExactBaselineMigrationAppend(policy, migrations, migration);
  if (!exact) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED',
      'Stories QA C1 recovery is not bound to the exact approved read-only source and inventory');
  }
  return source;
}

function qaMigrationItems(migrations, { requireAuthoritative = false, version, name } = {}) {
  const rawItems = Array.isArray(migrations)
    ? migrations
    : Array.isArray(migrations?.items) ? migrations.items : [];
  const claimsQaIdentity = rawItems.some(item => {
    const itemVersion = String(item?.version ?? '');
    const itemName = String(item?.name
      ?? item?.path?.split('/').at(-1)?.replace(/^\d{14}_|\.sql$/gu, '') ?? '');
    return itemVersion === version || itemName === name;
  });
  const claimsCompleteEnvelope = !Array.isArray(migrations)
    && migrations !== null && typeof migrations === 'object' && migrations.complete === true;
  if (!requireAuthoritative && !claimsQaIdentity && !claimsCompleteEnvelope) return null;
  if (migrations === undefined || migrations === null || Array.isArray(migrations)) {
    fail('INVALID_REMOTE_INVENTORY', 'Stories QA C1 requires a complete normalized migration inventory');
  }
  let items;
  try {
    items = validateNormalizedMigrations(migrations).items;
  } catch (error) {
    // Historical phase selectors deliberately accept incomplete/hostile legacy
    // fixtures so their own predecessor authority can decide whether to fall
    // back. A QA transition, promoted baseline, QA envelope, or claimed QA
    // migration is different: it must bind complete authoritative inventory.
    if (requireAuthoritative || claimsQaIdentity) throw error;
    return null;
  }
  if (items.some(item => !/^20[0-9]{12}$/.test(item.version) || !item.name)
    || new Set(items.map(item => item.version)).size !== items.length) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED', 'Stories QA C1 migration inventory is incomplete or duplicate');
  }
  return items;
}

export function storiesQaC1StateRequirement(policy, manifest, phase, context = {}) {
  if (!['pre', 'post', 'recovery'].includes(phase)) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED', 'Stories QA C1 phase is invalid');
  }
  const { request, migrations, evidence } = context;
  const authority = policy?.stories_qa_c1_transition;
  const migration = authority?.migration_path?.split('/').at(-1)?.replace(/\.sql$/, '');
  const version = migration?.slice(0, 14);
  const name = migration?.slice(15);
  const transition = storiesQaC1Transition(policy, manifest);
  const promoted = Boolean(migration) && String(policy?.baseline?.latest_migration ?? '') >= migration;
  const recoveryCandidate = phase === 'recovery'
    ? policy?.postcheck_recovery?.approved_sources?.find(
      item => String(item?.run_id ?? '') === String(request?.recoverySourceRunId ?? ''),
    ) : null;
  const recoveryCandidateClaimsQa = recoveryCandidate?.expected_latest_migration === migration
    || (recoveryCandidate?.expected_migrations ?? []).some(item => item?.name === migration);
  const evidenceSignalsQa = evidence !== null && typeof evidence === 'object'
    && (Object.prototype.hasOwnProperty.call(evidence, 'stories_qa_c1_state')
      || (evidence?.adapter?.queries ?? []).some(item => /^nelyon-stories-qa-c1-/u.test(item?.id ?? '')));
  const items = qaMigrationItems(migrations, {
    requireAuthoritative: Boolean(transition) || promoted || evidenceSignalsQa || recoveryCandidateClaimsQa,
    version,
    name,
  });
  const observedInstalled = Boolean(items?.some(item => item.version === version && item.name === name));
  const wrongIdentity = Boolean(items?.some(item => (
    (item.version === version) !== (item.name === name)
  )));
  if (wrongIdentity) fail('STORIES_QA_C1_POSTCHECK_FAILED', 'Stories QA C1 migration identity is inconsistent');
  const recoverySource = recoveryCandidateClaimsQa
    ? storiesQaC1RecoverySource(policy, manifest, phase, {
      request, migrations, migration, authority,
    }) : null;
  if (phase === 'recovery' && observedInstalled && !promoted && !recoverySource) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED',
      'observed Stories QA C1 recovery lacks an exact approved read-only source');
  }
  const installed = promoted || (observedInstalled && phase !== 'recovery') || Boolean(recoverySource);
  const required = Boolean(transition) || installed;
  if (transition && phase === 'post' && items && !observedInstalled) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED', 'Stories QA C1 post state lacks the approved migration');
  }
  if (promoted && items && !observedInstalled) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED', 'promoted Stories QA C1 baseline lacks installed migration evidence');
  }
  const useInstalled = installed || (transition && phase !== 'pre');
  return {
    required,
    installed: Boolean(useInstalled),
    transition,
    recovery: Boolean(recoverySource),
    query: useInstalled ? STORIES_QA_C1_POST_STATE_SQL : STORIES_QA_C1_PRE_STATE_SQL,
    query_id: `nelyon-stories-qa-c1-${useInstalled ? 'post' : 'pre'}-state-v1`,
  };
}

export function storiesSafetyC2AuthorityForPhase(policy, manifest, phase, context = {}) {
  const authority = policy?.stories_safety_c2_transition;
  const qa = storiesQaC1StateRequirement(policy, manifest, phase, context);
  const helpers = (authority?.helper_attestations ?? []).map(item => ({ ...item }));
  if (!qa.installed) return {
    helpers,
    query: STORIES_SAFETY_C2_STATE_SQL,
    query_id: 'nelyon-stories-safety-c2-state-v1',
  };
  const qaAuthority = policy?.stories_qa_c1_transition;
  const replacements = new Map((qaAuthority?.c2_helper_replacements ?? []).map(identity => [
    identity, qaAuthority.helper_attestations?.find(item => item.identity === identity),
  ]));
  if (replacements.size !== 5 || [...replacements.values()].some(item => !item)
    || ![...replacements.keys()].every(identity => helpers.some(item => item.identity === identity))) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED', 'Stories QA C1 C2 helper overlay is incomplete');
  }
  const asC2Helper = item => ({
    identity: item.identity,
    definition_sha256: item.definition_sha256,
    owner: item.owner,
    security_definer: item.security_definer,
    search_path: item.search_path,
    execute: item.execute,
  });
  return {
    helpers: helpers.map(item => asC2Helper(replacements.get(item.identity) ?? item)),
    query: STORIES_SAFETY_C2_QA_STATE_SQL,
    query_id: 'nelyon-stories-safety-c2-qa-state-v1',
  };
}

function effectiveStoriesSafetyC2Transition(policy, manifest, phase, context = {}) {
  const authority = policy?.stories_safety_c2_transition;
  if (!authority) return null;
  const selected = storiesSafetyC2AuthorityForPhase(policy, manifest, phase, context);
  return { ...authority, helper_attestations: selected.helpers };
}

function normalizeStoriesQaC1Functions(rows) {
  const code = 'STORIES_QA_C1_POSTCHECK_FAILED';
  if (!Array.isArray(rows)) fail(code, 'Stories QA C1 function evidence must be an array');
  const items = rows.map(row => {
    exactKeys(row, ['acl', 'definition_sha256', 'execute', 'identity', 'owner', 'search_path',
      'security_definer', 'volatility'], code);
    exactKeys(row.execute, ['anon', 'authenticated', 'public', 'service_role'], code);
    if (typeof row.identity !== 'string' || !HASH_PATTERN.test(row.definition_sha256 ?? '')
      || typeof row.owner !== 'string' || !['i', 's', 'v'].includes(row.volatility)
      || typeof row.security_definer !== 'boolean' || !Array.isArray(row.search_path)
      || row.search_path.some(item => typeof item !== 'string')
      || Object.values(row.execute).some(value => typeof value !== 'boolean')) {
      fail(code, 'Stories QA C1 function evidence is malformed');
    }
    return { ...row, search_path: [...row.search_path].sort(), acl: normalizeAcl(row.acl, code) };
  }).sort((left, right) => left.identity.localeCompare(right.identity));
  if (new Set(items.map(item => item.identity)).size !== items.length) {
    fail(code, 'Stories QA C1 function identities are duplicate');
  }
  return items;
}

function normalizeStoriesQaC1Relation(relation) {
  const code = 'STORIES_QA_C1_POSTCHECK_FAILED';
  if (relation === null) return null;
  exactKeys(relation, ['acl', 'columns', 'constraints', 'force_rls', 'indexes', 'name', 'owner',
    'policy_count', 'realtime_membership_count', 'rls_enabled', 'schema'], code);
  if (!Array.isArray(relation.columns) || !Array.isArray(relation.constraints) || !Array.isArray(relation.indexes)
    || !Number.isInteger(relation.policy_count) || !Number.isInteger(relation.realtime_membership_count)) {
    fail(code, 'Stories QA C1 relation evidence is malformed');
  }
  return {
    ...relation,
    acl: normalizeAcl(relation.acl, code),
    columns: [...relation.columns].sort((a, b) => a.position - b.position),
    constraints: [...relation.constraints].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    indexes: [...relation.indexes].sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

function normalizeStoriesQaC1Trigger(trigger) {
  const code = 'STORIES_QA_C1_POSTCHECK_FAILED';
  if (trigger === null) return null;
  exactKeys(trigger, ['deferrable', 'definition_sha256', 'enabled', 'function_identity', 'initially_deferred',
    'internal', 'name', 'table', 'tgtype'], code);
  if (!HASH_PATTERN.test(trigger.definition_sha256 ?? '') || !Number.isInteger(trigger.tgtype)
    || typeof trigger.enabled !== 'string' || typeof trigger.internal !== 'boolean'
    || typeof trigger.deferrable !== 'boolean' || typeof trigger.initially_deferred !== 'boolean') {
    fail(code, 'Stories QA C1 trigger evidence is malformed');
  }
  return { ...trigger };
}

export function normalizeStoriesQaC1State(snapshot) {
  const code = 'STORIES_QA_C1_POSTCHECK_FAILED';
  const withDigest = Object.hasOwn(snapshot ?? {}, 'sha256');
  exactKeys(snapshot, ['schema_version', 'complete', 'installed', 'initial_link_count', 'functions',
    'relation', 'trigger', ...(withDigest ? ['sha256'] : [])], code);
  if (snapshot.schema_version !== 1 || snapshot.complete !== true || typeof snapshot.installed !== 'boolean'
    || !Number.isInteger(snapshot.initial_link_count) || snapshot.initial_link_count < 0) {
    fail(code, 'Stories QA C1 snapshot shape is invalid');
  }
  const functions = normalizeStoriesQaC1Functions(snapshot.functions);
  const relation = normalizeStoriesQaC1Relation(snapshot.relation);
  const trigger = normalizeStoriesQaC1Trigger(snapshot.trigger);
  const unsigned = { schema_version: 1, complete: true, installed: snapshot.installed,
    initial_link_count: snapshot.initial_link_count, functions, relation, trigger };
  const digest = sha256(canonicalJson(unsigned));
  if (withDigest && snapshot.sha256 !== digest) fail(code, 'Stories QA C1 snapshot digest differs');
  return { ...unsigned, sha256: digest };
}

function expectedQaFunctionRows(items) {
  return items.map(item => ({ ...item, acl: [
    ...(item.execute?.authenticated
      ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }] : []),
    { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
  ] })).sort((a, b) => a.identity.localeCompare(b.identity));
}

function predecessorQaFunctionRows(policy) {
  const c2 = new Map((policy?.stories_safety_c2_transition?.helper_attestations ?? [])
    .map(item => [item.identity, item]));
  const validator = {
    identity: 'private.story_validate_composition(jsonb)',
    definition_sha256: 'bbe80903f672b5e48c41afa17271e8e0a1f22b63385baf7d6ef0fff977ecd46f',
    owner: 'postgres', volatility: 'i', security_definer: false, search_path: ['search_path=""'],
    execute: { anon: false, authenticated: false, public: false, service_role: false },
  };
  const volatilities = new Map([
    ['private.story_author_text_bundle_c1_v1(uuid)', 's'],
    ['public.create_story_with_media(uuid,jsonb,uuid)', 'v'],
    ['public.create_story_with_media(uuid,jsonb,uuid,jsonb)', 'v'],
    ['public.create_story_from_content(uuid,jsonb,uuid)', 'v'],
    ['public.create_story_from_content(uuid,jsonb,uuid,jsonb)', 'v'],
  ]);
  const rows = [validator, ...[...volatilities].map(([identity, volatility]) => ({ ...c2.get(identity), volatility }))];
  if (rows.some(item => !item?.identity)) fail('STORIES_QA_C1_POSTCHECK_FAILED', 'QA predecessor authority is incomplete');
  return expectedQaFunctionRows(rows);
}

export function validateStoriesQaC1InstalledState(snapshot, transition) {
  const state = normalizeStoriesQaC1State(snapshot);
  const expectedFunctions = expectedQaFunctionRows(transition?.helper_attestations ?? []);
  const relation = normalizeStoriesQaC1Relation(transition?.relation_attestation ?? null);
  const trigger = normalizeStoriesQaC1Trigger(transition?.trigger_attestation ?? null);
  if (state.installed !== true || expectedFunctions.length !== 10
    || canonicalJson(state.functions) !== canonicalJson(expectedFunctions)
    || canonicalJson(state.relation) !== canonicalJson(relation)
    || canonicalJson(state.trigger) !== canonicalJson(trigger)) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED', 'Stories QA C1 installed authority differs from reviewed catalog');
  }
  return state;
}

export function validateStoriesQaC1StateTransition(preSnapshot, postSnapshot, transition, policy = null) {
  const pre = normalizeStoriesQaC1State(preSnapshot);
  const post = validateStoriesQaC1InstalledState(postSnapshot, transition);
  const authorityPolicy = policy ?? { stories_safety_c2_transition: {
    helper_attestations: [],
  } };
  if (pre.installed !== false || pre.initial_link_count !== 0 || pre.relation !== null || pre.trigger !== null
    || post.initial_link_count !== 0
    || (policy && canonicalJson(pre.functions) !== canonicalJson(predecessorQaFunctionRows(authorityPolicy)))) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED', 'Stories QA C1 transition mutated data or lacks exact predecessor evidence');
  }
  return true;
}

function validateStoriesQaC1PreState(snapshot, policy) {
  const state = normalizeStoriesQaC1State(snapshot);
  if (state.installed !== false || state.initial_link_count !== 0
    || state.relation !== null || state.trigger !== null
    || canonicalJson(state.functions) !== canonicalJson(predecessorQaFunctionRows(policy))) {
    fail('STORIES_QA_C1_POSTCHECK_FAILED',
      'Stories QA C1 predecessor differs from the exact C2 authority');
  }
  return state;
}

export function validateStoriesQaC1CapturedEvidence(evidence, policy, manifest, phase, context = {}) {
  const code = 'STORIES_QA_C1_POSTCHECK_FAILED';
  try {
    validateNormalizedMigrations(evidence?.migrations);
  } catch {
    fail(code, 'Stories QA C1 migration evidence is invalid');
  }
  const request = context.request;
  const migrations = evidence.migrations;
  const requirement = storiesQaC1StateRequirement(policy, manifest, phase, { request, migrations });
  const queryRows = evidence?.adapter?.queries;
  if (!Array.isArray(queryRows)) fail(code, 'Stories QA C1 adapter query evidence is unavailable');
  const matching = queryRows.filter(item => item?.id === requirement.query_id);
  if (requirement.required) {
    if (matching.length !== 1 || matching[0].sha256 !== sha256(requirement.query)
      || !evidence.stories_qa_c1_state) {
      fail(code, 'Stories QA C1 query receipt or state evidence differs');
    }
    if (requirement.installed) {
      validateStoriesQaC1InstalledState(evidence.stories_qa_c1_state,
        policy?.stories_qa_c1_transition);
    } else {
      validateStoriesQaC1PreState(evidence.stories_qa_c1_state, policy);
    }
  } else if (matching.length !== 0 || evidence?.stories_qa_c1_state !== undefined) {
    fail(code, 'Stories QA C1 evidence exists outside its authorized scope');
  }
  const c2Requirement = storiesSafetyC2StateRequirement(policy, manifest, phase, { request, migrations });
  if (c2Requirement.required) {
    const selected = storiesSafetyC2AuthorityForPhase(policy, manifest, phase, { request, migrations });
    const c2Query = queryRows.filter(item => item?.id === selected.query_id);
    if (c2Query.length !== 1 || c2Query[0].sha256 !== sha256(selected.query)) {
      fail(code, 'Stories Safety C2 successor query receipt differs');
    }
    validateStoriesSafetyC2InstalledState(evidence.stories_safety_c2_state,
      effectiveStoriesSafetyC2Transition(policy, manifest, phase, { request, migrations }));
  }
  return true;
}

function superuserControlCenterTransition(policy, manifest) {
  const expected = policy?.superuser_control_center_transition;
  const attestation = manifest?.resources?.superuser_control_center_transition;
  if (!attestation) return null;
  if (!expected || canonicalJson(attestation) !== canonicalJson({
    ...expected,
    approved_sha: manifest?.identity?.approved_sha,
    baseline_descendant_verified: true,
    integration_base_descendant_verified: true,
    reviewed_bytes_verified: true,
  })) {
    fail('INVALID_SUPERUSER_CONTROL_CENTER_TRANSITION',
      'Superuser Control Center manifest attestation differs from policy');
  }
  return expected;
}

function superuserQaPerfC1Transition(policy, manifest) {
  const expected = policy?.superuser_qa_perf_c1_transition;
  const attestation = manifest?.resources?.superuser_qa_perf_c1_transition;
  if (!attestation) return null;
  if (!expected || canonicalJson(attestation) !== canonicalJson({
    ...expected, approved_sha: manifest?.identity?.approved_sha,
    baseline_descendant_verified: true, integration_base_descendant_verified: true,
    reviewed_bytes_verified: true,
  })) {
    fail('INVALID_SUPERUSER_QA_PERF_C1_TRANSITION', 'PERF C1 manifest attestation differs from policy');
  }
  return expected;
}

export function superuserQaPerfC1StateRequirement(policy, manifest, phase, context = {}) {
  const code = 'SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED';
  if (!['pre','post','recovery'].includes(phase)) fail(code, 'PERF C1 phase is invalid');
  const authority = policy?.superuser_qa_perf_c1_transition;
  const transition = superuserQaPerfC1Transition(policy, manifest);
  const expected = (authority?.migrations ?? []).map(item => ({ version: item.version,
    name: item.path.split('/').at(-1).replace(/^\d{14}_|\.sql$/gu, '') }));
  const finalMigration = authority?.migrations?.at(-1)?.path?.split('/').at(-1)?.replace(/\.sql$/u, '');
  const promoted = Boolean(finalMigration) && String(policy?.baseline?.latest_migration ?? '') >= finalMigration;
  let items = null;
  if (context.migrations !== undefined && context.migrations !== null) {
    try { items = validateNormalizedMigrations(context.migrations).items; }
    catch (error) { if (transition || promoted) throw error; }
  }
  const claimedItems = (items ?? []).filter(item => expected.some(expectedItem => (
    item.version === expectedItem.version || item.name === expectedItem.name
  )));
  const exactItems = claimedItems.filter(item => expected.some(expectedItem => (
    item.version === expectedItem.version && item.name === expectedItem.name
  )));
  const exactIdentities = new Set(exactItems.map(item => `${item.version}_${item.name}`));
  if (claimedItems.length !== exactItems.length
    || exactItems.length !== exactIdentities.size
    || (exactItems.length !== 0 && exactItems.length !== expected.length)) {
    fail(code, 'PERF C1 migration inventory is partially installed or has inconsistent identity');
  }
  const installedCount = exactItems.length;
  const observedInstalled = expected.length === 1 && installedCount === expected.length;
  if (transition && phase === 'pre' && observedInstalled) fail(code, 'PERF C1 pre state already contains the transition');
  if (transition && phase === 'post' && !observedInstalled) fail(code, 'PERF C1 post state lacks reviewed migrations');
  if (promoted && items && !observedInstalled) fail(code, 'promoted PERF C1 baseline lacks exact migration evidence');
  const installed = promoted || (observedInstalled && phase !== 'pre');
  return { required: Boolean(transition) || installed, installed, transition,
    query: SUPERUSER_QA_PERF_C1_STATE_SQL, query_id: 'nelyon-superuser-qa-perf-c1-state-v3' };
}

export function superuserControlCenterStateRequirement(policy, manifest, phase, context = {}) {
  const code = 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED';
  if (!['pre', 'post', 'recovery'].includes(phase)) fail(code, 'Control Center phase is invalid');
  const authority = policy?.superuser_control_center_transition;
  const transition = superuserControlCenterTransition(policy, manifest);
  const expected = (authority?.migrations ?? []).map(item => ({ version: item.version,
    name: item.path.split('/').at(-1).replace(/^\d{14}_|\.sql$/gu, '') }));
  const finalMigration = authority?.migrations?.at(-1)?.path?.split('/').at(-1)?.replace(/\.sql$/u, '');
  const promoted = Boolean(finalMigration)
    && String(policy?.baseline?.latest_migration ?? '') >= finalMigration;
  let items = null;
  if (context.migrations !== undefined && context.migrations !== null) {
    try {
      items = validateNormalizedMigrations(context.migrations).items;
    } catch (error) {
      if (transition || promoted) throw error;
    }
  }
  const installedCount = expected.filter(expectedItem => items?.some(item => (
    item.version === expectedItem.version && item.name === expectedItem.name
  ))).length;
  const claimedCount = expected.filter(expectedItem => items?.some(item => (
    item.version === expectedItem.version || item.name === expectedItem.name
  ))).length;
  if (claimedCount !== 0 && claimedCount !== expected.length) {
    fail(code, 'Control Center migration inventory is partially installed or has inconsistent identity');
  }
  const observedInstalled = expected.length === 3 && installedCount === expected.length;
  if (transition && phase === 'pre' && observedInstalled) {
    fail(code, 'Control Center pre state already contains the transition migrations');
  }
  if (transition && phase === 'post' && !observedInstalled) {
    fail(code, 'Control Center post state lacks one or more reviewed migrations');
  }
  if (promoted && items && !observedInstalled) {
    fail(code, 'promoted Control Center baseline lacks exact migration evidence');
  }
  const installed = promoted || (observedInstalled && phase !== 'pre');
  return {
    required: Boolean(transition) || installed,
    installed,
    transition,
    query: SUPERUSER_CONTROL_CENTER_STATE_SQL,
    query_id: 'nelyon-superuser-control-center-state-v1',
  };
}

function normalizeControlCenterFunctions(rows, code = 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED') {
  if (!Array.isArray(rows)) fail(code, 'Control Center function evidence must be an array');
  const items = rows.map(row => {
    exactKeys(row, ['acl','definition_sha256','execute','identity','owner','search_path',
      'security_definer','volatility'], code);
    exactKeys(row.execute, ['anon','authenticated','public','service_role'], code);
    if (typeof row.identity !== 'string' || !HASH_PATTERN.test(row.definition_sha256 ?? '')
      || typeof row.owner !== 'string' || !['i','s','v'].includes(row.volatility)
      || typeof row.security_definer !== 'boolean' || !Array.isArray(row.search_path)
      || row.search_path.some(item => typeof item !== 'string')
      || Object.values(row.execute).some(value => typeof value !== 'boolean')) {
      fail(code, 'Control Center function evidence is malformed');
    }
    return { ...row, search_path: [...row.search_path].sort(), acl: normalizeAcl(row.acl, code) };
  }).sort((left, right) => left.identity.localeCompare(right.identity));
  if (new Set(items.map(item => item.identity)).size !== items.length) {
    fail(code, 'Control Center function identities are duplicate');
  }
  return items;
}

function normalizeControlCenterIndex(index, code = 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED') {
  if (index === null) return null;
  exactKeys(index, ['definition','name','owner','primary','ready','schema','table','unique','valid'], code);
  if (['definition','name','owner','schema','table'].some(key => typeof index[key] !== 'string')
    || ['primary','ready','unique','valid'].some(key => typeof index[key] !== 'boolean')) {
    fail(code, 'Control Center index evidence is malformed');
  }
  return { ...index };
}

function normalizeControlCenterBoundedObservations(observations) {
  const code = 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED';
  exactKeys(observations, ['admin_action_audit','admin_audit_release_attributed',
    'advertising_ads','mfa_factors','probe_limit'], code);
  if (!Number.isInteger(observations.probe_limit) || observations.probe_limit < 1
    || typeof observations.admin_audit_release_attributed !== 'boolean') {
    fail(code, 'Control Center bounded observation envelope is malformed');
  }
  const probes = {};
  for (const key of ['mfa_factors','admin_action_audit','advertising_ads']) {
    const probe = observations[key];
    exactKeys(probe, ['observed_rows','saturated'], code);
    if (!Number.isInteger(probe.observed_rows) || probe.observed_rows < 0
      || probe.observed_rows > observations.probe_limit || typeof probe.saturated !== 'boolean'
      || probe.saturated !== (probe.observed_rows === observations.probe_limit)) {
      fail(code, 'Control Center bounded observation exceeds its fixed probe');
    }
    probes[key] = { observed_rows: probe.observed_rows, saturated: probe.saturated };
  }
  return { probe_limit: observations.probe_limit, ...probes,
    admin_audit_release_attributed: observations.admin_audit_release_attributed };
}

export function normalizeSuperuserControlCenterState(snapshot) {
  const code = 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED';
  const withDigest = Object.hasOwn(snapshot ?? {}, 'sha256');
  exactKeys(snapshot, ['schema_version','complete','installed','capability_count','aal2_codes',
    'refund_roles','root_role','root_grant_rule_count','functions','predecessor_function','index',
    'bounded_observations',
    ...(withDigest ? ['sha256'] : [])], code);
  if (snapshot.schema_version !== 1 || snapshot.complete !== true || typeof snapshot.installed !== 'boolean'
    || !Number.isInteger(snapshot.capability_count) || snapshot.capability_count < 1
    || !Array.isArray(snapshot.aal2_codes) || snapshot.aal2_codes.some(item => typeof item !== 'string')
    || !Array.isArray(snapshot.refund_roles) || snapshot.refund_roles.some(item => typeof item !== 'string')
    || !Number.isInteger(snapshot.root_grant_rule_count) || snapshot.root_grant_rule_count < 0) {
    fail(code, 'Control Center snapshot shape is invalid');
  }
  exactKeys(snapshot.root_role, ['is_assignable','is_exclusive','is_root','role_code'], code);
  if (typeof snapshot.root_role.role_code !== 'string'
    || ['is_assignable','is_exclusive','is_root'].some(key => typeof snapshot.root_role[key] !== 'boolean')) {
    fail(code, 'Control Center root role evidence is malformed');
  }
  const unsigned = {
    schema_version: 1, complete: true, installed: snapshot.installed,
    capability_count: snapshot.capability_count,
    aal2_codes: [...snapshot.aal2_codes].sort(),
    refund_roles: [...snapshot.refund_roles].sort(),
    root_role: { ...snapshot.root_role },
    root_grant_rule_count: snapshot.root_grant_rule_count,
    functions: normalizeControlCenterFunctions(snapshot.functions),
    predecessor_function: snapshot.predecessor_function === null ? null
      : normalizeControlCenterFunctions([snapshot.predecessor_function])[0],
    index: normalizeControlCenterIndex(snapshot.index),
    bounded_observations: normalizeControlCenterBoundedObservations(snapshot.bounded_observations),
  };
  const digest = sha256(canonicalJson(unsigned));
  if (withDigest && snapshot.sha256 !== digest) fail(code, 'Control Center snapshot digest differs');
  return { ...unsigned, sha256: digest };
}

function expectedControlCenterFunctionRows(items) {
  return items.map(item => ({ ...item, search_path: [...item.search_path].sort(),
    acl: normalizeAcl(item.acl, 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED') }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

export function validateSuperuserControlCenterInstalledState(snapshot, transition) {
  const code = 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED';
  const state = normalizeSuperuserControlCenterState(snapshot);
  const index = transition?.index_attestation;
  const expectedIndex = index && { schema: index.schema, table: index.table, name: index.name,
    owner: index.owner, definition: index.definition, valid: index.valid, ready: index.ready,
    unique: index.unique, primary: index.primary };
  const bounded = transition?.bounded_postcheck;
  if (state.installed !== true
    || state.capability_count !== transition?.required_aal_catalog?.capability_count
    || canonicalJson(state.aal2_codes) !== canonicalJson([...transition.required_aal_catalog.aal2_codes].sort())
    || canonicalJson(state.refund_roles) !== canonicalJson(transition.required_aal_catalog.refund_roles)
    || canonicalJson(state.root_role) !== canonicalJson(transition.required_aal_catalog.root_role)
    || state.root_grant_rule_count !== transition.required_aal_catalog.root_grant_rule_count
    || canonicalJson(state.functions) !== canonicalJson(expectedControlCenterFunctionRows(transition.function_definitions))
    || state.predecessor_function !== null
    || canonicalJson(state.index) !== canonicalJson(expectedIndex)
    || state.bounded_observations.probe_limit !== bounded?.probe_limit
    || state.bounded_observations.admin_audit_release_attributed !== false
    || bounded?.admin_audit_release_attribution_required_zero !== true
    || bounded?.advertising_ads_probe_must_not_saturate !== true
    || state.bounded_observations.advertising_ads.saturated !== false
    || transition?.index_attestation?.plan?.probe_limit !== bounded?.probe_limit) {
    fail(code, 'Control Center installed authority differs from the reviewed catalog');
  }
  return state;
}

function validateSuperuserControlCenterPreState(snapshot, transition) {
  const code = 'SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED';
  const state = normalizeSuperuserControlCenterState(snapshot);
  const predecessor = transition?.security_advisor?.predecessor_exception;
  const expectedPredecessor = predecessor && expectedControlCenterFunctionRows([{
    identity: 'public.search_admin_advertising_ads(text,integer)',
    ...predecessor.attestation,
    volatility: 's',
  }])[0];
  const bounded = transition?.bounded_postcheck;
  if (state.installed !== false || state.capability_count !== transition?.required_aal_catalog?.capability_count
    || canonicalJson(state.aal2_codes) !== canonicalJson([])
    || canonicalJson(state.refund_roles) !== canonicalJson([])
    || canonicalJson(state.root_role) !== canonicalJson(transition.required_aal_catalog.root_role)
    || state.root_grant_rule_count !== transition.required_aal_catalog.root_grant_rule_count
    || canonicalJson(state.predecessor_function) !== canonicalJson(expectedPredecessor)
    || state.index !== null
    || state.bounded_observations.probe_limit !== bounded?.probe_limit
    || state.bounded_observations.admin_audit_release_attributed !== false
    || bounded?.admin_audit_release_attribution_required_zero !== true
    || bounded?.advertising_ads_probe_must_not_saturate !== true
    || state.bounded_observations.advertising_ads.saturated !== false) {
    fail(code, 'Control Center predecessor differs from the exact production authority');
  }
  return state;
}

export function validateSuperuserControlCenterStateTransition(preSnapshot, postSnapshot, transition) {
  validateSuperuserControlCenterPreState(preSnapshot, transition);
  validateSuperuserControlCenterInstalledState(postSnapshot, transition);
  return true;
}

function normalizeSuperuserQaPerfC1State(snapshot) {
  const code = 'SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED';
  const withDigest = Object.hasOwn(snapshot ?? {}, 'sha256');
  exactKeys(snapshot, ['schema_version','complete','installed','functions','cron_history','finance',
    ...(withDigest ? ['sha256'] : [])], code);
  if (snapshot.schema_version !== 3 || snapshot.complete !== true || typeof snapshot.installed !== 'boolean') {
    fail(code, 'PERF C1 snapshot envelope is invalid');
  }
  exactKeys(snapshot.cron_history, ['extension','primary_index','relation_kind','release_index_name',
    'release_index_present','schema','schema_owner','table','table_owner'], code);
  if (['extension','relation_kind','release_index_name','schema','schema_owner','table','table_owner']
    .some(key => typeof snapshot.cron_history[key] !== 'string')
    || typeof snapshot.cron_history.release_index_present !== 'boolean') {
    fail(code, 'PERF C1 cron history evidence is malformed');
  }
  exactKeys(snapshot.cron_history.primary_index, ['expressions','included_columns','key_columns','name',
    'predicate','primary','ready','unique','valid'], code);
  if (typeof snapshot.cron_history.primary_index.name !== 'string'
    || !Array.isArray(snapshot.cron_history.primary_index.key_columns)
    || snapshot.cron_history.primary_index.key_columns.some(value => typeof value !== 'string')
    || !Array.isArray(snapshot.cron_history.primary_index.included_columns)
    || snapshot.cron_history.primary_index.included_columns.some(value => typeof value !== 'string')
    || ['primary','unique','valid','ready','predicate','expressions']
      .some(key => typeof snapshot.cron_history.primary_index[key] !== 'boolean')) {
    fail(code, 'PERF C1 primary index evidence is malformed');
  }
  exactKeys(snapshot.finance, ['activation_mode','active_authorization','platform_fee_bps',
    'purchase_enabled','refunds_enabled','subscription_enabled'], code);
  if (typeof snapshot.finance.activation_mode !== 'string'
    || typeof snapshot.finance.active_authorization !== 'boolean'
    || !Number.isInteger(snapshot.finance.platform_fee_bps)
    || ['purchase_enabled','refunds_enabled','subscription_enabled']
      .some(key => typeof snapshot.finance[key] !== 'boolean')) {
    fail(code, 'PERF C1 Finance evidence is malformed');
  }
  const unsigned = { schema_version: 3, complete: true, installed: snapshot.installed,
    functions: normalizeControlCenterFunctions(snapshot.functions, code),
    cron_history: { ...snapshot.cron_history }, finance: { ...snapshot.finance } };
  const digest = sha256(canonicalJson(unsigned));
  if (withDigest && snapshot.sha256 !== digest) fail(code, 'PERF C1 snapshot digest differs');
  return { ...unsigned, sha256: digest };
}

function expectedPerfC1CronHistory(transition) {
  const history = transition?.cron_history_attestation;
  return history && { schema: history.schema, table: history.table,
    relation_kind: history.relation_kind, schema_owner: history.schema_owner,
    table_owner: history.table_owner, extension: history.extension,
    primary_index: { ...history.primary_index },
    release_index_name: history.release_index_name,
    release_index_present: history.release_index_expected };
}

function expectedPerfC1Finance(transition) {
  return { activation_mode: 'general', active_authorization: true,
    platform_fee_bps: transition?.finance_policy?.platform_fee_bps,
    purchase_enabled: transition?.finance_policy?.purchase_enabled,
    refunds_enabled: transition?.finance_policy?.refunds_enabled,
    subscription_enabled: transition?.finance_policy?.subscription_enabled };
}

export function validateSuperuserQaPerfC1InstalledState(snapshot, transition) {
  const code = 'SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED';
  const state = normalizeSuperuserQaPerfC1State(snapshot);
  if (state.installed !== true
    || canonicalJson(state.functions) !== canonicalJson(expectedControlCenterFunctionRows(transition?.function_definitions ?? []))
    || canonicalJson(state.cron_history) !== canonicalJson(expectedPerfC1CronHistory(transition))
    || canonicalJson(state.finance) !== canonicalJson(expectedPerfC1Finance(transition))
    || transition?.cron_history_attestation?.release_mutation !== 'forbidden'
    || canonicalJson(transition?.cron_history_attestation?.metrics_contract ?? null) !== canonicalJson({
      probe_order: ['runid'], probe_direction: 'desc', probe_limit: 50000,
      complete_only_when_unsaturated: true, exact_only_when_complete: true,
      unavailable_reason: 'history_probe_limit_reached', unavailable_value: null,
    })) {
    fail(code, 'PERF C1 installed state differs from the reviewed authority');
  }
  return state;
}

function validateSuperuserQaPerfC1PreState(snapshot, transition) {
  const code = 'SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED';
  const state = normalizeSuperuserQaPerfC1State(snapshot);
  const expectedRecovery = {
    migration_inventory: 'baseline_without_c1',
    accepted_states: [
      { functions: 'predecessor', cron_history: 'exact_extension_owned', release_index: 'absent' },
    ],
    finance_policy_exact: true,
    mixed_function_catalog_rejected: true,
  };
  const predecessor = expectedControlCenterFunctionRows(transition?.predecessor_functions ?? []);
  const predecessorExact = state.installed === false
    && canonicalJson(state.functions) === canonicalJson(predecessor)
    && canonicalJson(state.cron_history) === canonicalJson(expectedPerfC1CronHistory(transition));
  if (canonicalJson(transition?.pre_snapshot_recovery ?? null) !== canonicalJson(expectedRecovery)
    || canonicalJson(state.finance) !== canonicalJson(expectedPerfC1Finance(transition))
    || !predecessorExact) {
    fail(code, 'PERF C1 predecessor/recovery state is outside the exact fail-closed authority');
  }
  return state;
}

export function validateSuperuserQaPerfC1StateTransition(preSnapshot, postSnapshot, transition) {
  validateSuperuserQaPerfC1PreState(preSnapshot, transition);
  validateSuperuserQaPerfC1InstalledState(postSnapshot, transition);
  return true;
}

export function validateAdminRecoveryControlCenterPostState({ migrations, state, policy }) {
  const code = 'ADMIN_RECOVERY_POSTCHECK_FAILED';
  const transition = policy?.superuser_control_center_transition;
  if (!transition || migrations?.complete !== true || !Array.isArray(migrations.items)) {
    fail(code, 'Admin recovery migration or Control Center authority is incomplete');
  }
  validateNormalizedMigrations(migrations);
  const expected = transition.migrations.map(item => ({
    version: item.version,
    name: item.path.replace(/^.*\//u, '').replace(/\.sql$/u, '').slice(15),
  }));
  const baselineCount = policy?.baseline?.migration_count;
  const baselineNames = migrations.items.slice(0, baselineCount).map(baselineMigrationName);
  if (!Number.isInteger(baselineCount) || baselineCount < 0
    || !HASH_PATTERN.test(policy?.baseline?.evidence_digests?.migrations ?? '')
    || migrations.count !== baselineCount + expected.length
    || migrations.items.length !== migrations.count
    || sha256(canonicalJson(baselineNames)) !== policy.baseline.evidence_digests.migrations
    || canonicalJson(migrations.items.slice(baselineCount)) !== canonicalJson(expected)
    || migrations.latest?.version !== expected.at(-1)?.version
    || migrations.latest?.name !== expected.at(-1)?.name) {
    fail(code, 'Admin recovery requires the exact post-Control-Center migration inventory');
  }
  validateSuperuserControlCenterInstalledState(state, transition);
  return true;
}

export function verifyAdminRecoveryInfrastructurePostState({ post, policy }) {
  const code = 'ADMIN_RECOVERY_POSTCHECK_FAILED';
  const transition = policy?.superuser_control_center_transition;
  if (!post || !transition) fail(code, 'Admin recovery infrastructure evidence is unavailable');
  validateAdminRecoveryControlCenterPostState({
    migrations: post.migrations,
    state: post.superuser_control_center_state,
    policy,
  });
  const expectedAppendCount = transition.migrations.length;
  const expectedLatestMigration = transition.migrations.at(-1)?.path
    ?.replace(/^.*\//u, '').replace(/\.sql$/u, '');
  verifyRecoveryInfrastructureBaseline({
    policy,
    migrations: post.migrations,
    functions: post.functions,
    expectedLatestMigration,
    functionTransitions: [],
    expectedAppendCount,
  });

  validateNormalizedAdvisors(post.cron_security?.advisors);
  validateCronSnapshot(post.cron_security?.cron);
  const advisorAuthority = transition.security_advisor;
  const advisorTransition = advisorAuthority?.transition;
  const predecessor = advisorAuthority?.predecessor_exception;
  const additions = advisorAuthority?.introduced_exceptions;
  if (!advisorTransition || !predecessor || !Array.isArray(additions)
    || additions.length === 0
    || post.cron_security.advisors.count !== advisorTransition.after_count
    || post.cron_security.advisors.sha256 !== advisorTransition.after_sha256) {
    fail(code, 'Admin recovery Security Advisor state differs from the reviewed post-state');
  }
  const additionFingerprints = new Set(additions.map(item => item?.advisor_fingerprint));
  const currentAdvisorItems = post.cron_security.advisors.items;
  if (additionFingerprints.size !== additions.length
    || additions.some(item => currentAdvisorItems.filter(current => (
      current.fingerprint === item.advisor_fingerprint
      && current.level === item.advisor_severity
      && current.resource_kind === item.advisor_type
    )).length !== 1)
    || currentAdvisorItems.some(item => item.fingerprint === predecessor.advisor_fingerprint)) {
    fail(code, 'Admin recovery Security Advisor transition is incomplete or ambiguous');
  }
  const baselineAdvisorItems = [
    ...currentAdvisorItems.filter(item => !additionFingerprints.has(item.fingerprint)),
    {
      fingerprint: predecessor.advisor_fingerprint,
      level: predecessor.advisor_severity,
      resource_kind: predecessor.advisor_type,
    },
  ].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  if (new Set(baselineAdvisorItems.map(item => item.fingerprint)).size !== baselineAdvisorItems.length) {
    fail(code, 'Admin recovery reconstructed Advisor baseline is duplicated');
  }
  const baselineMigrationItems = post.migrations.items.slice(0, policy.baseline.migration_count);
  const baselineEvidence = {
    ...post,
    migrations: {
      complete: true,
      count: baselineMigrationItems.length,
      items: baselineMigrationItems,
      latest: baselineMigrationItems.at(-1) ?? null,
      sha256: sha256(canonicalJson(baselineMigrationItems)),
    },
    cron_security: {
      ...post.cron_security,
      advisors: {
        complete: true,
        count: baselineAdvisorItems.length,
        items: baselineAdvisorItems,
        sha256: sha256(canonicalJson(baselineAdvisorItems)),
      },
    },
  };
  const reconstructedDigests = buildProductionBaselineDigests({ evidence: baselineEvidence, policy });
  if (canonicalJson(reconstructedDigests) !== canonicalJson(policy.baseline.evidence_digests)) {
    fail(code, 'Admin recovery migrations, Edge, cron, Advisor, or Finance drifted from the reviewed baseline');
  }
  return reconstructedDigests;
}

function storiesSafetyC1StateRequirement(policy, manifest, phase = 'pre', context = {}) {
  const transition = storiesSafetyC1Transition(policy, manifest);
  const installed = String(policy?.baseline?.latest_migration ?? '') >= STORIES_SAFETY_C1_MIGRATION;
  const c2Predecessor = phase === 'pre' && Boolean(storiesSafetyC2Transition(policy, manifest));
  return {
    required: (Boolean(transition) || installed)
      && !storiesSafetyC2StateRequirement(policy, manifest, phase, context).required,
    transition,
    installed,
    query: c2Predecessor ? STORIES_SAFETY_C2_PRE_STATE_SQL : STORIES_SAFETY_C1_STATE_SQL,
    query_id: c2Predecessor ? 'nelyon-stories-safety-c2-predecessor-state-v1' : 'nelyon-stories-safety-c1-state-v1',
  };
}

function normalizeStoriesB1Relations(rows) {
  if (!Array.isArray(rows)) fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 relation evidence must be an array');
  const items = rows.map(row => {
    exactKeys(row, ['acl', 'force_rls', 'name', 'owner', 'rls_enabled', 'schema'],
      'STORIES_B1_POSTCHECK_FAILED');
    if (row.schema !== 'private' || !STORIES_B1_RELATION_NAMES.includes(row.name)
      || typeof row.owner !== 'string' || typeof row.rls_enabled !== 'boolean'
      || typeof row.force_rls !== 'boolean') {
      fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 relation authority is incomplete');
    }
    return {
      schema: row.schema,
      name: row.name,
      owner: row.owner,
      rls_enabled: row.rls_enabled,
      force_rls: row.force_rls,
      acl: normalizeAcl(row.acl, 'STORIES_B1_POSTCHECK_FAILED'),
    };
  }).sort((left, right) => `${left.schema}.${left.name}`.localeCompare(`${right.schema}.${right.name}`));
  if (new Set(items.map(item => `${item.schema}.${item.name}`)).size !== items.length) {
    fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 relation identities are duplicate');
  }
  return items;
}

function expectedStoriesB1Relations() {
  return STORIES_B1_RELATION_NAMES.map(name => ({
    schema: 'private',
    name,
    owner: 'postgres',
    rls_enabled: true,
    force_rls: true,
    acl: ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
      .map(privilege_type => ({ grantee: 'postgres', privilege_type, is_grantable: false })),
  })).sort((left, right) => `${left.schema}.${left.name}`.localeCompare(`${right.schema}.${right.name}`));
}

export function normalizeStoriesB1State(snapshot) {
  const withDigest = Object.hasOwn(snapshot ?? {}, 'sha256');
  exactKeys(snapshot, [
    'schema_version', 'complete', 'infrastructure_installed', 'owner_approved_policy',
    'activation', 'mode', 'story_count', 'direct_story_count', 'safety_state_counts',
    'complete_evidence_count', 'complete_evidence_non_review_count',
    'incomplete_evidence_non_pending_count', 'complete_evidence_pass_count', 'fabricated_pass_count',
    'relations',
    ...(withDigest ? ['sha256'] : []),
  ], 'STORIES_B1_POSTCHECK_FAILED');
  exactKeys(snapshot.safety_state_counts, ['blocked', 'passed', 'pending', 'review'],
    'STORIES_B1_POSTCHECK_FAILED');
  const integerFields = [
    snapshot.story_count,
    snapshot.direct_story_count,
    snapshot.complete_evidence_count,
    snapshot.complete_evidence_non_review_count,
    snapshot.incomplete_evidence_non_pending_count,
    snapshot.complete_evidence_pass_count,
    snapshot.fabricated_pass_count,
    ...Object.values(snapshot.safety_state_counts),
  ];
  if (snapshot.schema_version !== 1 || snapshot.complete !== true
    || typeof snapshot.infrastructure_installed !== 'boolean'
    || typeof snapshot.owner_approved_policy !== 'boolean'
    || typeof snapshot.activation !== 'boolean'
    || snapshot.mode !== 'fail_closed_review'
    || integerFields.some(value => !Number.isInteger(value) || value < 0)
    || snapshot.direct_story_count > snapshot.story_count
    || snapshot.complete_evidence_count > snapshot.story_count
    || snapshot.complete_evidence_non_review_count > snapshot.complete_evidence_count
    || snapshot.incomplete_evidence_non_pending_count > snapshot.story_count - snapshot.complete_evidence_count
    || snapshot.complete_evidence_pass_count > snapshot.complete_evidence_count
    || snapshot.fabricated_pass_count > snapshot.safety_state_counts.passed) {
    fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 snapshot has an invalid shape or count');
  }
  const relations = normalizeStoriesB1Relations(snapshot.relations);
  const { sha256: claimed, ...rawUnsigned } = snapshot;
  const unsigned = { ...rawUnsigned, relations };
  const digest = sha256(canonicalJson(unsigned));
  if (withDigest && (!HASH_PATTERN.test(claimed ?? '') || claimed !== digest)) {
    fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 snapshot digest differs');
  }
  return { ...unsigned, sha256: digest };
}

export function validateStoriesB1StateTransition(preSnapshot, postSnapshot, transition) {
  const pre = normalizeStoriesB1State(preSnapshot);
  const post = normalizeStoriesB1State(postSnapshot);
  const safety = transition?.safety;
  if (transition?.from_phase !== 'stories_v2_legacy'
    || transition?.to_phase !== 'stories_v2_interactive_b1_fail_closed'
    || canonicalJson(safety ?? null) !== canonicalJson({
      activation: false,
      complete_evidence_state: 'review',
      fabricated_pass_allowed: false,
      incomplete_evidence_state: 'pending',
      mode: 'fail_closed_review',
      owner_approved_policy: false,
      physical_readiness_claim_allowed: false,
    })
    || pre.infrastructure_installed !== false || post.infrastructure_installed !== true
    || pre.owner_approved_policy !== false || post.owner_approved_policy !== false
    || pre.activation !== false || post.activation !== false
    || pre.relations.length !== 0
    || canonicalJson(post.relations) !== canonicalJson(expectedStoriesB1Relations())
    || post.safety_state_counts.blocked !== 0
    || post.safety_state_counts.passed !== 0
    || post.complete_evidence_non_review_count !== 0
    || post.incomplete_evidence_non_pending_count !== 0
    || post.complete_evidence_pass_count !== 0 || post.fabricated_pass_count !== 0
    || Object.values(pre.safety_state_counts).some(value => value !== 0)
    || Object.values(post.safety_state_counts).reduce((sum, value) => sum + value, 0) !== post.story_count
    || post.story_count !== pre.story_count || post.direct_story_count !== pre.direct_story_count) {
    fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 release is not exact fail-closed infrastructure');
  }
  return true;
}

function validateStoriesB1InstalledState(snapshot) {
  const stories = normalizeStoriesB1State(snapshot);
  if (stories.infrastructure_installed !== true || stories.owner_approved_policy !== false
    || stories.activation !== false
    || canonicalJson(stories.relations) !== canonicalJson(expectedStoriesB1Relations())
    || stories.safety_state_counts.blocked !== 0 || stories.safety_state_counts.passed !== 0
    || stories.complete_evidence_non_review_count !== 0
    || stories.incomplete_evidence_non_pending_count !== 0
    || stories.complete_evidence_pass_count !== 0 || stories.fabricated_pass_count !== 0
    || Object.values(stories.safety_state_counts).reduce((sum, value) => sum + value, 0) !== stories.story_count) {
    fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 installed state is not exact fail-closed infrastructure');
  }
  return stories;
}

function normalizeStoriesSafetyC1Helpers(rows) {
  if (!Array.isArray(rows)) {
    fail('STORIES_SAFETY_C1_POSTCHECK_FAILED', 'Stories Safety C1 helper evidence must be an array');
  }
  const items = rows.map(row => {
    exactKeys(row, [
      'acl', 'definition_sha256', 'execute', 'identity', 'owner', 'search_path', 'security_definer',
    ], 'STORIES_SAFETY_C1_POSTCHECK_FAILED');
    exactKeys(row.execute, ['anon', 'authenticated', 'public', 'service_role'],
      'STORIES_SAFETY_C1_POSTCHECK_FAILED');
    if (typeof row.identity !== 'string' || !HASH_PATTERN.test(row.definition_sha256 ?? '')
      || typeof row.owner !== 'string' || typeof row.security_definer !== 'boolean'
      || !Array.isArray(row.search_path) || row.search_path.some(item => typeof item !== 'string')
      || Object.values(row.execute).some(value => typeof value !== 'boolean')) {
      fail('STORIES_SAFETY_C1_POSTCHECK_FAILED', 'Stories Safety C1 helper evidence is malformed');
    }
    return {
      identity: row.identity,
      definition_sha256: row.definition_sha256,
      owner: row.owner,
      security_definer: row.security_definer,
      search_path: [...row.search_path].sort(),
      acl: normalizeAcl(row.acl, 'STORIES_SAFETY_C1_POSTCHECK_FAILED'),
      execute: {
        anon: row.execute.anon,
        authenticated: row.execute.authenticated,
        public: row.execute.public,
        service_role: row.execute.service_role,
      },
    };
  }).sort((left, right) => left.identity.localeCompare(right.identity));
  if (new Set(items.map(item => item.identity)).size !== items.length) {
    fail('STORIES_SAFETY_C1_POSTCHECK_FAILED', 'Stories Safety C1 helper identities are duplicate');
  }
  return items;
}

function normalizeStoriesSafetyC1Trigger(value) {
  if (value === null) return null;
  exactKeys(value, ['definition_sha256', 'enabled', 'function_identity', 'name', 'table'],
    'STORIES_SAFETY_C1_POSTCHECK_FAILED');
  if (!HASH_PATTERN.test(value.definition_sha256 ?? '') || typeof value.enabled !== 'string'
    || typeof value.function_identity !== 'string' || typeof value.name !== 'string'
    || typeof value.table !== 'string') {
    fail('STORIES_SAFETY_C1_POSTCHECK_FAILED', 'Stories Safety C1 trigger evidence is malformed');
  }
  return { ...value };
}

export function normalizeStoriesSafetyC1State(snapshot) {
  const withDigest = Object.hasOwn(snapshot ?? {}, 'sha256');
  exactKeys(snapshot, [
    'schema_version', 'complete', 'installed', 'policy_id', 'policy_artifact_sha256', 'control',
    'approved_story_rule_count', 'passed_count', 'policy_digest_count', 'story_count',
    'safety_state_count', 'story_inventory_sha256', 'safety_inventory_sha256',
    'transcript_refresh_trigger_installed', 'trigger', 'helpers',
    ...(withDigest ? ['sha256'] : []),
  ], 'STORIES_SAFETY_C1_POSTCHECK_FAILED');
  const integerFields = [
    snapshot.approved_story_rule_count, snapshot.passed_count, snapshot.policy_digest_count,
    snapshot.story_count, snapshot.safety_state_count,
  ];
  if (snapshot.schema_version !== 1 || snapshot.complete !== true
    || typeof snapshot.installed !== 'boolean'
    || typeof snapshot.transcript_refresh_trigger_installed !== 'boolean'
    || integerFields.some(value => !Number.isInteger(value) || value < 0)
    || !HASH_PATTERN.test(snapshot.story_inventory_sha256 ?? '')
    || !HASH_PATTERN.test(snapshot.safety_inventory_sha256 ?? '')) {
    fail('STORIES_SAFETY_C1_POSTCHECK_FAILED', 'Stories Safety C1 snapshot shape or count is invalid');
  }
  let control = null;
  if (snapshot.control !== null) {
    exactKeys(snapshot.control, [
      'activation', 'automatic_allow_authorized', 'automatic_block_authorized',
      'auto_publish_enabled', 'mode', 'owner_approved_policy', 'policy_artifact_sha256',
    ], 'STORIES_SAFETY_C1_POSTCHECK_FAILED');
    if (!HASH_PATTERN.test(snapshot.control.policy_artifact_sha256 ?? '')
      || typeof snapshot.control.activation !== 'boolean'
      || typeof snapshot.control.owner_approved_policy !== 'boolean'
      || typeof snapshot.control.auto_publish_enabled !== 'boolean'
      || typeof snapshot.control.automatic_allow_authorized !== 'boolean'
      || typeof snapshot.control.automatic_block_authorized !== 'boolean'
      || typeof snapshot.control.mode !== 'string') {
      fail('STORIES_SAFETY_C1_POSTCHECK_FAILED', 'Stories Safety C1 control evidence is malformed');
    }
    control = { ...snapshot.control };
  }
  const helpers = normalizeStoriesSafetyC1Helpers(snapshot.helpers);
  const trigger = normalizeStoriesSafetyC1Trigger(snapshot.trigger);
  const { sha256: claimed, ...rawUnsigned } = snapshot;
  const unsigned = { ...rawUnsigned, control, helpers, trigger };
  const digest = sha256(canonicalJson(unsigned));
  if (withDigest && (!HASH_PATTERN.test(claimed ?? '') || claimed !== digest)) {
    fail('STORIES_SAFETY_C1_POSTCHECK_FAILED', 'Stories Safety C1 snapshot digest differs');
  }
  return { ...unsigned, sha256: digest };
}

function expectedStoriesSafetyC1Helpers(transition) {
  return (transition?.helper_attestations ?? []).map(item => ({
    ...item,
    acl: [
      ...(item.execute?.authenticated
        ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }]
        : []),
      { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
    ],
  })).sort((left, right) => left.identity.localeCompare(right.identity));
}

function validateStoriesSafetyC1InstalledState(snapshot, transition) {
  const state = normalizeStoriesSafetyC1State(snapshot);
  const expectedControl = {
    policy_artifact_sha256: transition?.policy_artifact?.sha256,
    activation: false,
    owner_approved_policy: false,
    auto_publish_enabled: false,
    mode: 'fail_closed_review',
    automatic_allow_authorized: false,
    automatic_block_authorized: false,
  };
  if (state.installed !== true
    || state.policy_id !== transition?.policy_artifact?.policy_id
    || state.policy_artifact_sha256 !== transition?.policy_artifact?.sha256
    || canonicalJson(state.control) !== canonicalJson(expectedControl)
    || state.approved_story_rule_count !== 0 || state.passed_count !== 0
    || state.policy_digest_count !== 0
    || state.transcript_refresh_trigger_installed !== true
    || canonicalJson(state.trigger) !== canonicalJson(transition?.trigger_attestation ?? null)
    || canonicalJson(state.helpers) !== canonicalJson(expectedStoriesSafetyC1Helpers(transition))) {
    fail('STORIES_SAFETY_C1_POSTCHECK_FAILED',
      'Stories Safety C1 installed state is not exact fail-closed technical preparation');
  }
  return state;
}

export function validateStoriesSafetyC1StateTransition(preSnapshot, postSnapshot, transition) {
  const pre = normalizeStoriesSafetyC1State(preSnapshot);
  const post = validateStoriesSafetyC1InstalledState(postSnapshot, transition);
  if (transition?.from_phase !== 'stories_v2_interactive_b1_fail_closed'
    || transition?.to_phase !== 'stories_v2_safety_c1_technical_prep_fail_closed'
    || canonicalJson(transition?.safety ?? null) !== canonicalJson({
      activation: false,
      automatic_allow_authorized: false,
      automatic_block_authorized: false,
      auto_publish_enabled: false,
      decisions: ['pending', 'review'],
      mode: 'fail_closed_review',
      owner_approved_policy: false,
    })
    || pre.installed !== false || pre.policy_id !== null
    || pre.policy_artifact_sha256 !== null || pre.control !== null
    || pre.approved_story_rule_count !== 0 || pre.passed_count !== 0
    || pre.policy_digest_count !== 0 || pre.transcript_refresh_trigger_installed !== false
    || pre.trigger !== null || pre.helpers.length !== 0
    || post.story_count !== pre.story_count || post.safety_state_count !== pre.safety_state_count
    || post.story_inventory_sha256 !== pre.story_inventory_sha256
    || post.safety_inventory_sha256 !== pre.safety_inventory_sha256) {
    fail('STORIES_SAFETY_C1_POSTCHECK_FAILED',
      'Stories Safety C1 release activated policy or mutated protected Story inventories');
  }
  return true;
}

const STORIES_C2_STATUS_VALUES = Object.freeze({
  publication_status: ['unpublished', 'published', 'restricted', 'removed'],
  moderation_status: ['unreviewed', 'alerted', 'reviewed_keep', 'reviewed_restrict', 'reviewed_remove'],
  scan_status: ['queued', 'processing', 'completed', 'failed'],
});

export function normalizeStoriesSafetyC2State(snapshot) {
  const code = 'STORIES_SAFETY_C2_POSTCHECK_FAILED';
  const { publication_status, moderation_status, scan_status, enabled_numeric_story_rule_count,
    published_without_current_scan_count, no_current_scan_count, publication_metadata_count,
    alert_trigger, initialization_trigger, columns, control, sha256: claimed, ...legacy } = snapshot ?? {};
  let base;
  try {
    base = normalizeStoriesSafetyC1State({ ...legacy, control: null });
  } catch {
    fail(code, 'Stories Safety C2 base evidence is malformed');
  }
  delete base.sha256;
  exactKeys(control, ['policy_id', 'policy_artifact_sha256', 'activation', 'owner_approved_operating_model',
    'owner_approved_policy', 'mode', 'automatic_allow_authorized', 'automatic_block_authorized',
    'numeric_thresholds', 'historical_backfill'], code);
  const statuses = { publication_status, moderation_status, scan_status };
  for (const [key, values] of Object.entries(STORIES_C2_STATUS_VALUES)) {
    exactKeys(statuses[key], values, code);
    if (Object.values(statuses[key]).some(value => !Number.isInteger(value) || value < 0)
      || Object.values(statuses[key]).reduce((sum, value) => sum + value, 0)
        + (key === 'scan_status' ? no_current_scan_count : 0) !== base.safety_state_count) {
      fail(code, `Stories Safety C2 ${key} inventory is incomplete`);
    }
  }
  if (![enabled_numeric_story_rule_count, published_without_current_scan_count,
    no_current_scan_count, publication_metadata_count]
    .every(value => Number.isInteger(value) && value >= 0)) {
    fail(code, 'Stories Safety C2 invariant counts are malformed');
  }
  let normalizedAlertTrigger;
  let normalizedInitializationTrigger;
  try {
    normalizedAlertTrigger = normalizeStoriesSafetyC1Trigger(alert_trigger);
    normalizedInitializationTrigger = normalizeStoriesSafetyC1Trigger(initialization_trigger);
  }
  catch { fail(code, 'Stories Safety C2 alert trigger evidence is malformed'); }
  if (!Array.isArray(columns) || columns.length !== 7) fail(code, 'Stories Safety C2 columns are incomplete');
  const normalizedColumns = columns.map(column => {
    exactKeys(column, ['name', 'type', 'not_null', 'default'], code);
    if (typeof column.name !== 'string' || typeof column.type !== 'string'
      || typeof column.not_null !== 'boolean' || !(column.default === null || typeof column.default === 'string')) {
      fail(code, 'Stories Safety C2 column evidence is malformed');
    }
    return { ...column };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(normalizedColumns.map(column => column.name)).size !== 7) fail(code, 'Stories Safety C2 columns are duplicate');
  const unsigned = { ...base, control, ...statuses, enabled_numeric_story_rule_count, published_without_current_scan_count,
    no_current_scan_count, publication_metadata_count, alert_trigger: normalizedAlertTrigger,
    initialization_trigger: normalizedInitializationTrigger, columns: normalizedColumns };
  const digest = sha256(canonicalJson(unsigned));
  if (Object.hasOwn(snapshot ?? {}, 'sha256') && claimed !== digest) {
    fail(code, 'Stories Safety C2 snapshot digest differs');
  }
  return { ...unsigned, sha256: digest };
}

export function validateStoriesSafetyC2InstalledState(snapshot, transition) {
  const state = normalizeStoriesSafetyC2State(snapshot);
  const expectedControl = {
    policy_id: transition?.policy_artifact?.policy_id,
    policy_artifact_sha256: transition?.policy_artifact?.sha256,
    activation: true, owner_approved_operating_model: true, owner_approved_policy: false,
    mode: 'PUBLISH_FIRST_ASYNC_REVIEW', automatic_allow_authorized: false, automatic_block_authorized: false,
    numeric_thresholds: null, historical_backfill: false,
  };
  const expectedHelpers = (transition?.helper_attestations ?? []).map(item => ({
    ...item,
    acl: [
      ...(item.execute?.authenticated ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }] : []),
      { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ...(item.execute?.service_role ? [{ grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }] : []),
    ],
  })).sort((left, right) => left.identity.localeCompare(right.identity));
  if (state.installed !== true || !expectedHelpers.length
    || state.policy_id !== transition?.policy_artifact?.policy_id
    || state.policy_artifact_sha256 !== transition?.policy_artifact?.sha256
    || canonicalJson(state.control) !== canonicalJson(expectedControl)
    || state.approved_story_rule_count !== 0 || state.enabled_numeric_story_rule_count !== 0
    || state.passed_count !== 0 || state.policy_digest_count !== 0
    || state.published_without_current_scan_count !== 0
    || state.transcript_refresh_trigger_installed !== true
    || canonicalJson(state.trigger) !== canonicalJson(transition?.trigger_attestation ?? null)
    || canonicalJson(state.alert_trigger) !== canonicalJson(transition?.alert_trigger_attestation ?? null)
    || canonicalJson(state.initialization_trigger) !== canonicalJson(transition?.initialization_trigger_attestation ?? null)
    || canonicalJson(state.columns) !== canonicalJson(transition?.column_attestations ?? null)
    || canonicalJson(state.helpers) !== canonicalJson(expectedHelpers)) {
    fail('STORIES_SAFETY_C2_POSTCHECK_FAILED', 'Stories Safety C2 installed authority differs from exact publish-first controls');
  }
  return state;
}

export function validateStoriesSafetyC2StateTransition(preSnapshot, postSnapshot, transition, predecessor) {
  const code = 'STORIES_SAFETY_C2_POSTCHECK_FAILED';
  let pre;
  try {
    pre = validateStoriesSafetyC1InstalledState(preSnapshot, predecessor);
  } catch {
    fail(code, 'Stories Safety C2 predecessor is not exact C1 technical preparation');
  }
  const post = validateStoriesSafetyC2InstalledState(postSnapshot, transition);
  if (transition?.from_phase !== 'stories_v2_safety_c1_technical_prep_fail_closed'
    || transition?.to_phase !== 'stories_v2_safety_c2_publish_first_async_review'
    || post.story_count !== pre.story_count || post.safety_state_count !== pre.safety_state_count
    || post.story_inventory_sha256 !== pre.story_inventory_sha256
    || post.safety_inventory_sha256 !== pre.safety_inventory_sha256
    || post.publication_metadata_count !== 0
    || post.publication_status.unpublished !== pre.safety_state_count
    || post.moderation_status.unreviewed !== pre.safety_state_count) {
    fail(code, 'Stories Safety C2 release changed historical Story publication, moderation, scans or inventories');
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
  const storiesRequirement = storiesB1StateRequirement(policy, manifest, phase, {
    request,
    migrations: evidence?.migrations,
  });
  const requireStoriesB1 = storiesRequirement.required;
  const storiesQuery = storiesRequirement.query;
  const storiesSafetyRequirement = storiesSafetyC1StateRequirement(policy, manifest, phase, { request, migrations: evidence?.migrations });
  const requireStoriesSafetyC1 = storiesSafetyRequirement.required;
  const storiesSafetyC2Requirement = storiesSafetyC2StateRequirement(policy, manifest, phase, { request, migrations: evidence?.migrations });
  const requireStoriesSafetyC2 = storiesSafetyC2Requirement.required;
  const storiesSafetyC2Authority = storiesSafetyC2AuthorityForPhase(policy, manifest, phase, {
    request,
    migrations: evidence?.migrations,
  });
  const storiesQaRequirement = storiesQaC1StateRequirement(policy, manifest, phase, {
    evidence,
    request,
    migrations: evidence?.migrations,
  });
  const requireStoriesQaC1 = storiesQaRequirement.required;
  const controlCenterRequirement = superuserControlCenterStateRequirement(policy, manifest, phase, {
    evidence,
    request,
    migrations: evidence?.migrations,
  });
  const requireControlCenter = controlCenterRequirement.required;
  const perfC1Requirement = superuserQaPerfC1StateRequirement(policy, manifest, phase, {
    evidence,
    request,
    migrations: evidence?.migrations,
  });
  const requirePerfC1 = perfC1Requirement.required;
  exactKeys(evidence, [
    'adapter', 'backup', 'complete', 'cron_security', 'evidence_sha256', 'finance', 'functions',
    'health', 'identity', 'migrations', 'observed_at', 'phase', 'premium_state', 'project_ref',
    'requests', 'rpc_security', 'schema_version',
    ...(requireFinanceAuthority ? ['finance_authority','finance_facts'] : []),
    ...(requireStoriesB1 ? ['stories_b1_state'] : []),
    ...(requireStoriesSafetyC1 ? ['stories_safety_c1_state'] : []),
    ...(requireStoriesSafetyC2 ? ['stories_safety_c2_state'] : []),
    ...(requireStoriesQaC1 ? ['stories_qa_c1_state'] : []),
    ...(requireControlCenter ? ['superuser_control_center_state'] : []),
    ...(requirePerfC1 ? ['superuser_qa_perf_c1_state'] : []),
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
    ...(requireStoriesB1 ? [{
      id: storiesRequirement.query_id,
      sha256: sha256(storiesQuery),
    }] : []),
    ...(requireStoriesSafetyC2 ? [{
      id: storiesSafetyC2Authority.query_id, sha256: sha256(storiesSafetyC2Authority.query),
    }] : []),
    ...(requireStoriesSafetyC1 ? [{
      id: storiesSafetyRequirement.query_id,
      sha256: sha256(storiesSafetyRequirement.query),
    }] : []),
    ...(requireStoriesQaC1 ? [{
      id: storiesQaRequirement.query_id,
      sha256: sha256(storiesQaRequirement.query),
    }] : []),
    ...(requireControlCenter ? [{
      id: controlCenterRequirement.query_id,
      sha256: sha256(controlCenterRequirement.query),
    }] : []),
    ...(requirePerfC1 ? [{
      id: perfC1Requirement.query_id,
      sha256: sha256(perfC1Requirement.query),
    }] : []),
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
  if (requireStoriesB1) expectedRequests.push(['POST', `${base}/database/query/read-only`, 201]);
  if (requireStoriesSafetyC1) expectedRequests.push(['POST', `${base}/database/query/read-only`, 201]);
  if (requireStoriesSafetyC2) expectedRequests.push(['POST', `${base}/database/query/read-only`, 201]);
  if (requireStoriesQaC1) expectedRequests.push(['POST', `${base}/database/query/read-only`, 201]);
  if (requireControlCenter) expectedRequests.push(['POST', `${base}/database/query/read-only`, 201]);
  if (requirePerfC1) expectedRequests.push(['POST', `${base}/database/query/read-only`, 201]);
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
  if (requireStoriesB1) normalizeStoriesB1State(evidence.stories_b1_state);
  if (requireStoriesSafetyC1) normalizeStoriesSafetyC1State(evidence.stories_safety_c1_state);
  if (requireStoriesSafetyC2) validateStoriesSafetyC2InstalledState(
    evidence.stories_safety_c2_state,
    effectiveStoriesSafetyC2Transition(policy, manifest, phase, {
      request,
      migrations: evidence.migrations,
    }),
  );
  validateStoriesQaC1CapturedEvidence(evidence, policy, manifest, phase, {
    request,
    migrations: evidence.migrations,
  });
  if (requireControlCenter) {
    const matching = evidence.adapter.queries.filter(item => item?.id === controlCenterRequirement.query_id);
    if (matching.length !== 1 || matching[0].sha256 !== sha256(controlCenterRequirement.query)) {
      fail('SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED',
        'Control Center query receipt differs from the fixed authority');
    }
    if (controlCenterRequirement.installed) {
      validateSuperuserControlCenterInstalledState(
        evidence.superuser_control_center_state,
        policy?.superuser_control_center_transition,
      );
    } else {
      validateSuperuserControlCenterPreState(
        evidence.superuser_control_center_state,
        policy?.superuser_control_center_transition,
      );
    }
  }
  if (requirePerfC1) {
    const matching = evidence.adapter.queries.filter(item => item?.id === perfC1Requirement.query_id);
    if (matching.length !== 1 || matching[0].sha256 !== sha256(perfC1Requirement.query)) {
      fail('SUPERUSER_QA_PERF_C1_POSTCHECK_FAILED',
        'PERF C1 query receipt differs from the fixed authority');
    }
    if (perfC1Requirement.installed) {
      validateSuperuserQaPerfC1InstalledState(
        evidence.superuser_qa_perf_c1_state,
        policy?.superuser_qa_perf_c1_transition,
      );
    } else {
      validateSuperuserQaPerfC1PreState(
        evidence.superuser_qa_perf_c1_state,
        policy?.superuser_qa_perf_c1_transition,
      );
    }
  }
  return evidence;
}

function baselineMigrationName(item) {
  return `${item.version}_${item.name}`;
}

function hasExactBaselineMigrationAppend(policy, migrations, expectedLatestMigration, expectedAppendCount = 1) {
  const baseline = policy?.baseline;
  const baselineCount = baseline?.migration_count;
  if (!Number.isInteger(baselineCount) || baselineCount < 0
    || !HASH_PATTERN.test(baseline?.evidence_digests?.migrations ?? '')
    || !Number.isInteger(expectedAppendCount) || expectedAppendCount < 1
    || migrations?.complete !== true || migrations.count !== baselineCount + expectedAppendCount
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
  expectedAppendCount = 1,
}) {
  validateNormalizedMigrations(migrations);
  validateNormalizedFunctions(functions);
  if (!hasExactBaselineMigrationAppend(policy, migrations, expectedLatestMigration, expectedAppendCount)) {
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
  const storiesB1Installed = (evidence.migrations?.items ?? [])
    .some(item => baselineMigrationName(item) === STORIES_B1_MIGRATION);
  const storiesAdvisor = policy?.stories_b1_transition?.security_advisor;
  if (storiesB1Installed) {
    const stories = normalizeStoriesB1State(evidence.stories_b1_state);
    if (stories.infrastructure_installed !== true || stories.owner_approved_policy !== false
      || stories.activation !== false || canonicalJson(stories.relations) !== canonicalJson(expectedStoriesB1Relations())
      || stories.safety_state_counts.blocked !== 0 || stories.safety_state_counts.passed !== 0
      || stories.complete_evidence_non_review_count !== 0
      || stories.incomplete_evidence_non_pending_count !== 0
      || stories.complete_evidence_pass_count !== 0 || stories.fabricated_pass_count !== 0
      || !Array.isArray(storiesAdvisor?.introduced_exceptions)
      || storiesAdvisor.introduced_exceptions.length !== 15
      || !Array.isArray(storiesAdvisor?.removed_findings)
      || storiesAdvisor.removed_findings.length !== 2) {
      fail('REMOTE_BASELINE_MISMATCH', 'Stories B1 baseline evidence is not exact fail-closed infrastructure');
    }
  }
  const storiesSafetyC1Installed = (evidence.migrations?.items ?? [])
    .some(item => baselineMigrationName(item) === STORIES_SAFETY_C1_MIGRATION);
  const storiesSafetyC2Installed = (evidence.migrations?.items ?? []).some(item =>
    baselineMigrationName(item) === policy?.stories_safety_c2_transition?.migration_path?.split('/').at(-1)?.replace(/\.sql$/, ''));
  if (storiesSafetyC2Installed) {
    validateStoriesSafetyC2InstalledState(
      evidence.stories_safety_c2_state,
      effectiveStoriesSafetyC2Transition(policy, null, 'post', { migrations: evidence.migrations }),
    );
  }
  if (storiesSafetyC1Installed && !storiesSafetyC2Installed) {
    try {
      validateStoriesSafetyC1InstalledState(
        evidence.stories_safety_c1_state,
        policy?.stories_safety_c1_transition,
      );
    } catch {
      fail('REMOTE_BASELINE_MISMATCH',
        'Stories Safety C1 baseline evidence is not exact fail-closed technical preparation');
    }
  }
  const storiesQaRequirement = storiesQaC1StateRequirement(policy, null, 'post', {
    evidence,
    migrations: evidence.migrations,
  });
  if (storiesQaRequirement.required) {
    validateStoriesQaC1InstalledState(evidence.stories_qa_c1_state,
      policy?.stories_qa_c1_transition);
  }
  const attestedRpcIdentities = new Set((evidence.rpc_security?.items ?? []).map(rpcIdentity));
  if (storiesB1Installed) {
    const expectedStoriesRpcIdentities = storiesAdvisor.introduced_exceptions
      .filter(exception => Array.isArray(exception?.object?.argument_types))
      .map(exception => rpcIdentity(exception.object));
    if (expectedStoriesRpcIdentities.some(identity => !attestedRpcIdentities.has(identity))) {
      fail('REMOTE_BASELINE_MISMATCH', 'Stories B1 RPC authority evidence is incomplete');
    }
  }
  const effectiveExceptions = advisorExceptionsForPhase(policy, null, 'post', {
    migrations: evidence.migrations,
  });
  const deployedExceptionFingerprints = new Set(effectiveExceptions
    .filter(exception => !Array.isArray(exception?.object?.argument_types)
      || attestedRpcIdentities.has(rpcIdentity(exception.object)))
    .map(exception => exception.advisor_fingerprint));
  let historicalAdvisorItems = evidence.cron_security.advisors.items
    .filter(item => !deployedExceptionFingerprints.has(item.fingerprint));
  if (storiesB1Installed) {
    const removedFindings = storiesAdvisor.removed_findings.map(item => ({
      fingerprint: item?.fingerprint,
      level: item?.level,
      resource_kind: item?.resource_kind,
    }));
    if (removedFindings.some(item => !HASH_PATTERN.test(item.fingerprint ?? '')
      || typeof item.level !== 'string' || typeof item.resource_kind !== 'string')
      || new Set(removedFindings.map(item => item.fingerprint)).size !== removedFindings.length
      || removedFindings.some(item => evidence.cron_security.advisors.items
        .some(current => current.fingerprint === item.fingerprint))) {
      fail('REMOTE_BASELINE_MISMATCH', 'Stories B1 removed Advisor evidence is invalid or still present');
    }
    historicalAdvisorItems = [...historicalAdvisorItems, ...removedFindings]
      .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  }
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
  validateRpcSecurityAttestations(pre.rpc_security, advisorExceptionsForPhase(policy, manifest, 'pre', {
    request,
    migrations: pre.migrations,
  }));
  const storiesTransition = storiesB1Transition(policy, manifest);
  if (storiesTransition) {
    const stories = normalizeStoriesB1State(pre.stories_b1_state);
    if (stories.infrastructure_installed !== false || stories.owner_approved_policy !== false
      || stories.activation !== false || stories.complete_evidence_count !== 0
      || stories.complete_evidence_non_review_count !== 0
      || stories.incomplete_evidence_non_pending_count !== 0
      || stories.complete_evidence_pass_count !== 0 || stories.fabricated_pass_count !== 0
      || Object.values(stories.safety_state_counts).some(value => value !== 0)) {
      fail('STORIES_B1_POSTCHECK_FAILED', 'Stories B1 pre-snapshot is not the exact fail-closed predecessor');
    }
  } else if (storiesB1StateRequirement(policy, manifest, 'pre', {
    request,
    migrations: pre.migrations,
  }).required) {
    validateStoriesB1InstalledState(pre.stories_b1_state);
  }
  const storiesSafetyTransition = storiesSafetyC1Transition(policy, manifest);
  if (storiesSafetyTransition) {
    const storiesSafety = normalizeStoriesSafetyC1State(pre.stories_safety_c1_state);
    if (storiesSafety.installed !== false || storiesSafety.policy_id !== null
      || storiesSafety.policy_artifact_sha256 !== null || storiesSafety.control !== null
      || storiesSafety.approved_story_rule_count !== 0 || storiesSafety.passed_count !== 0
      || storiesSafety.policy_digest_count !== 0
      || storiesSafety.transcript_refresh_trigger_installed !== false
      || storiesSafety.trigger !== null || storiesSafety.helpers.length !== 0) {
      fail('STORIES_SAFETY_C1_POSTCHECK_FAILED',
        'Stories Safety C1 pre-snapshot is not the exact B1 fail-closed predecessor');
    }
  } else if (storiesSafetyC1StateRequirement(policy, manifest, 'pre', { request, migrations: pre.migrations }).required) {
    validateStoriesSafetyC1InstalledState(
      pre.stories_safety_c1_state,
      policy?.stories_safety_c1_transition,
    );
  }
  if (storiesSafetyC2StateRequirement(policy, manifest, 'pre', { request, migrations: pre.migrations }).required) {
    validateStoriesSafetyC2InstalledState(
      pre.stories_safety_c2_state,
      effectiveStoriesSafetyC2Transition(policy, manifest, 'pre', { request, migrations: pre.migrations }),
    );
  }
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
  validateRpcSecurityAttestations(post.rpc_security, advisorExceptionsForPhase(policy, manifest, 'post', {
    request,
    migrations: post.migrations,
  }));
  const financeTransition = activeFinanceAuthorityTransition(policy, manifest);
  const storiesTransition = storiesB1Transition(policy, manifest);
  if (storiesTransition) {
    validateStoriesB1StateTransition(pre.stories_b1_state, post.stories_b1_state, storiesTransition);
  } else if (storiesB1StateRequirement(policy, manifest, 'post', {
    request,
    migrations: post.migrations,
  }).required) {
    validateStoriesB1InstalledState(post.stories_b1_state);
  }
  const storiesSafetyTransition = storiesSafetyC1Transition(policy, manifest);
  if (storiesSafetyTransition) {
    validateStoriesSafetyC1StateTransition(
      pre.stories_safety_c1_state,
      post.stories_safety_c1_state,
      storiesSafetyTransition,
    );
  } else if (storiesSafetyC1StateRequirement(policy, manifest, 'post', { request, migrations: post.migrations }).required) {
    validateStoriesSafetyC1InstalledState(
      post.stories_safety_c1_state,
      policy?.stories_safety_c1_transition,
    );
  }
  const c2Transition = storiesSafetyC2Transition(policy, manifest);
  if (c2Transition) {
    validateStoriesSafetyC2StateTransition(pre.stories_safety_c1_state, post.stories_safety_c2_state,
      c2Transition, policy?.stories_safety_c1_transition);
  } else if (storiesSafetyC2StateRequirement(policy, manifest, 'post', { request, migrations: post.migrations }).required) {
    validateStoriesSafetyC2InstalledState(
      post.stories_safety_c2_state,
      effectiveStoriesSafetyC2Transition(policy, manifest, 'post', { request, migrations: post.migrations }),
    );
  }
  const qaTransition = storiesQaC1Transition(policy, manifest);
  if (qaTransition) {
    validateStoriesQaC1StateTransition(
      pre.stories_qa_c1_state,
      post.stories_qa_c1_state,
      qaTransition,
      policy,
    );
  } else if (storiesQaC1StateRequirement(policy, manifest, 'post', {
    request,
    migrations: post.migrations,
  }).required) {
    validateStoriesQaC1InstalledState(post.stories_qa_c1_state,
      policy?.stories_qa_c1_transition);
  }
  const controlCenterTransition = superuserControlCenterTransition(policy, manifest);
  if (controlCenterTransition) {
    validateSuperuserControlCenterStateTransition(
      pre.superuser_control_center_state,
      post.superuser_control_center_state,
      controlCenterTransition,
    );
    const advisorTransition = controlCenterTransition.security_advisor.transition;
    if (pre.cron_security.advisors.count !== advisorTransition.before_count
      || pre.cron_security.advisors.sha256 !== advisorTransition.before_sha256
      || post.cron_security.advisors.count !== advisorTransition.after_count
      || post.cron_security.advisors.sha256 !== advisorTransition.after_sha256) {
      fail('SUPERUSER_CONTROL_CENTER_POSTCHECK_FAILED',
        'Control Center Security Advisor transition differs from the exact canonical digest');
    }
  } else if (superuserControlCenterStateRequirement(policy, manifest, 'post', {
    request,
    migrations: post.migrations,
  }).required) {
    validateSuperuserControlCenterInstalledState(
      post.superuser_control_center_state,
      policy?.superuser_control_center_transition,
    );
  }
  const perfC1Transition = superuserQaPerfC1Transition(policy, manifest);
  if (perfC1Transition) {
    validateSuperuserQaPerfC1StateTransition(
      pre.superuser_qa_perf_c1_state,
      post.superuser_qa_perf_c1_state,
      perfC1Transition,
    );
  } else if (superuserQaPerfC1StateRequirement(policy, manifest, 'post', {
    request,
    migrations: post.migrations,
  }).required) {
    validateSuperuserQaPerfC1InstalledState(
      post.superuser_qa_perf_c1_state,
      policy?.superuser_qa_perf_c1_transition,
    );
  }
  validatePremiumStateTransition(pre.premium_state, post.premium_state, manifest, policy);
  if (Date.parse(post.observed_at) < Date.parse(pre.observed_at)
    || Date.parse(post.finance.database_time) < Date.parse(pre.finance.database_time)) {
    fail('INVALID_SNAPSHOT_ORDER', 'post-release evidence predates pre-release evidence');
  }

  const manifestMigrations = [...(manifest?.resources?.migrations ?? [])].map(item => {
    const filename = typeof item?.path === 'string' ? item.path.split('/').at(-1) : '';
    const match = /^(20[0-9]{12})_(.+)\.sql$/u.exec(filename);
    if (!match || item?.version !== match[1]) {
      fail('REMOTE_POSTCHECK_FAILED', 'manifest migration identity is invalid');
    }
    return { version: item.version, name: match[2] };
  }).sort((left, right) => left.version.localeCompare(right.version)
    || left.name.localeCompare(right.name));
  if (new Set(manifestMigrations.map(item => `${item.version}_${item.name}`)).size
    !== manifestMigrations.length) {
    fail('REMOTE_POSTCHECK_FAILED', 'manifest migration inventory is invalid');
  }
  const byMigrationIdentity = (left, right) => left.version.localeCompare(right.version)
    || left.name.localeCompare(right.name);
  const preMigrations = pre.migrations.items.map(item => ({ version: item.version, name: item.name }))
    .sort(byMigrationIdentity);
  const postMigrations = post.migrations.items.map(item => ({ version: item.version, name: item.name }))
    .sort(byMigrationIdentity);
  const expectedPostMigrations = [...preMigrations, ...manifestMigrations]
    .sort(byMigrationIdentity);
  if (canonicalJson(postMigrations) !== canonicalJson(expectedPostMigrations)) {
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
  const preExceptions = advisorExceptionsForPhase(policy, manifest, 'pre', {
    request,
    migrations: pre.migrations,
  });
  const postExceptions = advisorExceptionsForPhase(policy, manifest, 'post', {
    request,
    migrations: post.migrations,
  });
  const preExceptionFingerprints = new Set(preExceptions.map(exception => exception.advisor_fingerprint));
  const postExceptionFingerprints = new Set(postExceptions.map(exception => exception.advisor_fingerprint));
  const introducedExceptions = postExceptions
    .filter(exception => !preExceptionFingerprints.has(exception.advisor_fingerprint));
  const removedExceptionFingerprints = [...preExceptionFingerprints]
    .filter(fingerprint => !postExceptionFingerprints.has(fingerprint));
  const allowedRemovedFindings = storiesTransition
    ? storiesTransition?.security_advisor?.removed_findings
    : removedExceptionFingerprints;
  validateSecurityAdvisorDelta(
    pre.cron_security.advisors.items,
    post.cron_security.advisors.items,
    introducedExceptions,
    allowedRemovedFindings,
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
  if (storiesB1StateRequirement(policy, manifest, 'recovery', {
    request,
    migrations: recovery.migrations,
  }).required) {
    validateStoriesB1InstalledState(recovery.stories_b1_state);
  }
  if (storiesSafetyC1StateRequirement(policy, manifest, 'recovery', { request, migrations: recovery.migrations }).required) {
    validateStoriesSafetyC1InstalledState(
      recovery.stories_safety_c1_state,
      policy?.stories_safety_c1_transition,
    );
  }
  if (storiesSafetyC2StateRequirement(policy, manifest, 'recovery', { request, migrations: recovery.migrations }).required) {
    validateStoriesSafetyC2InstalledState(
      recovery.stories_safety_c2_state,
      effectiveStoriesSafetyC2Transition(policy, manifest, 'recovery', {
        request,
        migrations: recovery.migrations,
      }),
    );
  }
  if (storiesQaC1StateRequirement(policy, manifest, 'recovery', {
    evidence: recovery,
    request,
    migrations: recovery.migrations,
  }).required) {
    validateStoriesQaC1InstalledState(recovery.stories_qa_c1_state,
      policy?.stories_qa_c1_transition);
  }
  return {
    result: 'RECOVERY_SNAPSHOT_VERIFIED',
    evidence_sha256: recovery.evidence_sha256,
    rpc_security_sha256: recovery.rpc_security.sha256,
    premium_state_sha256: recovery.premium_state.sha256,
  };
}

export function verifyProductionAdminRecoverySnapshot({ post, policy, request, manifest, adapterSourceSha256 }) {
  const code = 'ADMIN_RECOVERY_POSTCHECK_FAILED';
  if (request?.mode !== 'admin_recovery'
    || request?.scopeConfirmation !== 'ADMIN_RECOVERY_EXACT_SOURCE'
    || manifest?.identity?.mode !== 'admin_recovery'
    || manifest?.identity?.approved_sha !== request?.approvedSha
    || manifest?.recovery?.kind !== 'admin_cloudflare_forward_completion'
    || manifest?.recovery?.source_run_id !== String(request?.recoverySourceRunId ?? '')
    || canonicalJson(manifest?.resources) !== canonicalJson({
      config_changed: false, function_contracts: [], functions: [], migrations: [],
    })) {
    fail(code, 'Admin recovery request or manifest is not exact and read-only');
  }
  validateCapturedEvidence({ evidence: post, phase: 'post', policy, request, manifest, adapterSourceSha256 });
  validateRpcSecurityAttestations(post.rpc_security, advisorExceptionsForPhase(policy, manifest, 'post', {
    request, migrations: post.migrations,
  }));
  validatePremiumPostcheckState(post.premium_state);
  const baselineDigests = verifyAdminRecoveryInfrastructurePostState({ post, policy });
  if (canonicalJson({
    platform_fee_bps: post.finance?.policy?.platform_fee_bps,
    purchase_enabled: post.finance?.policy?.purchase_enabled,
    refunds_enabled: post.finance?.policy?.refunds_enabled,
    subscription_enabled: post.finance?.policy?.subscription_enabled,
  }) !== canonicalJson(policy?.supabase?.finance_policy)
    || RECONCILIATION_KEYS.some(key => post.finance?.reconciliation?.[key] !== 0)) {
    fail(code, 'Admin recovery observed Finance drift or unreconciled state');
  }
  return {
    schema_version: 1,
    result: 'ADMIN_RECOVERY_POSTCHECK_VERIFIED',
    source_run_id: String(request.recoverySourceRunId),
    evidence_sha256: post.evidence_sha256,
    rpc_security_sha256: post.rpc_security.sha256,
    premium_state_sha256: post.premium_state.sha256,
    baseline_digests: baselineDigests,
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
  for (const key of ['categories', 'facing', 'level', 'metadata', 'name']) {
    if (Object.hasOwn(lint ?? {}, key)) stable[key] = stableAdvisorMetadata(lint[key]);
  }
  if (stable.categories) stable.categories.sort();
  // Match the provider's current cache format, but derive it from semantic
  // identity so missing or changed transport cache keys have no authority.
  const metadata = stable.metadata;
  stable.cache_key = metadata.type === 'auth' ? stable.name
    : `${stable.name}_${metadata.schema}_${metadata.name ?? metadata.table}`
      + (Object.hasOwn(metadata, 'arguments') ? `_${metadata.arguments}` : '');
  return stable;
}

export function normalizeSecurityAdvisors(body) {
  const lints = body?.lints;
  if (!Array.isArray(lints)) fail('INVALID_REMOTE_INVENTORY', 'security advisor inventory is invalid');
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validFields = lint => isRecord(lint) && typeof lint.name === 'string' && lint.name.length > 0
    && typeof lint.level === 'string' && lint.level.length > 0
    && (!Object.hasOwn(lint, 'facing') || (typeof lint.facing === 'string' && lint.facing.length > 0))
    && (!Object.hasOwn(lint, 'categories') || (Array.isArray(lint.categories)
      && lint.categories.every(category => typeof category === 'string' && category.length > 0)));
  const findings = lints.flatMap(lint => {
    if (!isRecord(lint)) fail('INVALID_REMOTE_INVENTORY', 'security advisor finding is malformed');
    if (!Object.hasOwn(lint, 'findings') && !Object.hasOwn(lint, 'count')) return [lint];
    if (!validFields(lint) || !Number.isInteger(lint.count) || lint.count < 0
      || !Array.isArray(lint.findings) || lint.count !== lint.findings.length) {
      fail('INVALID_REMOTE_INVENTORY', 'security advisor group count or findings are invalid');
    }
    const { count: ignoredCount, findings: grouped, ...fields } = lint;
    return grouped.map(finding => {
      if (!isRecord(finding) || Object.hasOwn(finding, 'findings') || Object.hasOwn(finding, 'count')) {
        fail('INVALID_REMOTE_INVENTORY', 'security advisor grouped finding is malformed');
      }
      return { ...fields, ...finding };
    });
  });
  const identities = new Set();
  const items = findings.map(lint => {
    const metadata = lint.metadata;
    if (!validFields(lint) || !isRecord(metadata)
      || (metadata.type !== 'auth' && (typeof metadata.schema !== 'string' || metadata.schema.length === 0
        || typeof (metadata.name ?? metadata.table) !== 'string' || (metadata.name ?? metadata.table).length === 0))
      || (Object.hasOwn(metadata, 'arguments') && typeof metadata.arguments !== 'string')) {
      fail('INVALID_REMOTE_INVENTORY', 'security advisor semantic identity is malformed');
    }
    const identity = canonicalJson([lint.name, metadata.schema ?? null, metadata.name ?? metadata.table ?? null,
      metadata.arguments ?? null]);
    if (identities.has(identity)) fail('INVALID_REMOTE_INVENTORY', 'security advisor semantic identities are duplicate');
    identities.add(identity);
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
    ['40473092474', {
      expectedLatestMigration: STORIES_B1_MIGRATION,
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
  let result = [...exceptions];
  if ((transition && phase !== 'pre') || installedFoundation || exactRecoveryPhase) {
    validateFinancePolicyAuthority(policy);
    const successors = policy.finance_security_advisor.rpc_attestations;
    result = [...result.filter(exception => !successors.some(item => item.object.name === exception.object.name)),
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
  }
  const storiesTransition = storiesB1Transition(policy, manifest);
  const installedStoriesB1 = String(policy?.baseline?.latest_migration ?? '') >= STORIES_B1_MIGRATION;
  const recoveryStoriesB1 = storiesB1RecoverySource(policy, manifest, phase, context);
  if ((storiesTransition && phase !== 'pre') || installedStoriesB1 || recoveryStoriesB1) {
    const additions = policy?.stories_b1_transition?.security_advisor?.introduced_exceptions;
    if (!Array.isArray(additions) || additions.length !== 15) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'Stories B1 advisor attestations are unavailable');
    }
    const additionsByFingerprint = new Map(additions.map(item => [item?.advisor_fingerprint, item]));
    if (additionsByFingerprint.size !== additions.length) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'Stories B1 advisor attestations are duplicate');
    }
    result = [...result.filter(item => !additionsByFingerprint.has(item?.advisor_fingerprint)), ...additions];
  }
  if (storiesSafetyC2StateRequirement(policy, manifest, phase, context).required) {
    const authority = policy.stories_safety_c2_transition;
    const helpers = new Map((authority.helper_attestations ?? []).map(item => [item.identity, item]));
    result = result.map(exception => {
      if (!Array.isArray(exception?.object?.argument_types)) return exception;
      const helper = helpers.get(rpcIdentity(exception.object).replaceAll(' ', ''));
      if (!helper) return exception;
      const attestation = { ...helper };
      delete attestation.identity;
      return {
        ...exception,
        attestation: {
          ...attestation,
          acl: [
            ...(helper.execute.authenticated ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }] : []),
            { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
            ...(helper.execute.service_role ? [{ grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }] : []),
          ],
        },
        origin: {
          migration: authority.migration_path.split('/').at(-1).replace(/\.sql$/, ''),
          migration_blob: authority.migration_blob, source_sha: authority.reviewed_source_sha,
        },
      };
    });
  }
  const qaRequirement = storiesQaC1StateRequirement(policy, manifest, phase, context);
  if (qaRequirement.required) {
    const predecessor = policy?.stories_qa_c1_transition?.rpc_predecessor_exception;
    const identity = Array.isArray(predecessor?.object?.argument_types)
      ? rpcIdentity(predecessor.object).replaceAll(' ', '') : null;
    if (identity !== 'public.create_story_from_content(uuid,jsonb,uuid)'
      || predecessor?.advisor_fingerprint
        !== '010c78c43ba2cb32439c48ef8433d2706776f45f128fc2aa0572eb3b15377a14') {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'Stories QA C1 predecessor RPC authority is unavailable');
    }
    const matching = result.filter(item => item?.advisor_fingerprint === predecessor.advisor_fingerprint);
    if (matching.length > 1 || (matching.length === 1
      && canonicalJson(matching[0]) !== canonicalJson(predecessor))) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'Stories QA C1 predecessor RPC authority is inconsistent');
    }
    if (matching.length === 0) result = [...result, predecessor];
  }
  if (qaRequirement.installed) {
    const authority = policy?.stories_qa_c1_transition;
    const replacements = new Set(authority?.rpc_replacements ?? []);
    const helpers = new Map((authority?.helper_attestations ?? []).map(item => [item.identity, item]));
    const additions = authority?.security_advisor?.introduced_exceptions;
    if (replacements.size !== 4 || [...replacements].some(identity => !helpers.has(identity))
      || !Array.isArray(additions) || additions.length !== 3
      || new Set(additions.map(item => item?.advisor_fingerprint)).size !== additions.length) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'Stories QA C1 advisor authority is unavailable');
    }
    result = result.map(exception => {
      if (!Array.isArray(exception?.object?.argument_types)) return exception;
      const identity = rpcIdentity(exception.object).replaceAll(' ', '');
      if (!replacements.has(identity)) return exception;
      const helper = helpers.get(identity);
      return {
        ...exception,
        attestation: {
          security_definer: helper.security_definer,
          owner: helper.owner,
          search_path: helper.search_path,
          acl: [
            ...(helper.execute.authenticated
              ? [{ grantee: 'authenticated', privilege_type: 'EXECUTE', is_grantable: false }]
              : []),
            { grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
            ...(helper.execute.service_role
              ? [{ grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }]
              : []),
          ],
          execute: helper.execute,
          definition_sha256: helper.definition_sha256,
        },
        origin: {
          migration: authority.migration_path.split('/').at(-1).replace(/\.sql$/, ''),
          migration_blob: authority.migration_blob,
          source_sha: authority.reviewed_source_sha,
        },
      };
    });
    const fingerprints = new Set(additions.map(item => item.advisor_fingerprint));
    result = [...result.filter(item => !fingerprints.has(item?.advisor_fingerprint)), ...additions];
  }
  const controlCenterRequirement = superuserControlCenterStateRequirement(policy, manifest, phase, context);
  if (controlCenterRequirement.required) {
    const authority = policy?.superuser_control_center_transition;
    const predecessor = authority?.security_advisor?.predecessor_exception;
    const additions = authority?.security_advisor?.introduced_exceptions;
    if (predecessor?.advisor_fingerprint
        !== 'b1b08a6ee6057c6e739057eb823c034e95b6be56a2a6ed33ce73d11969b76713'
      || !Array.isArray(additions) || additions.length !== 2
      || new Set(additions.map(item => item?.advisor_fingerprint)).size !== additions.length) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'Control Center Advisor authority is unavailable');
    }
    const predecessorMatches = result.filter(item => item?.advisor_fingerprint === predecessor.advisor_fingerprint);
    if (!controlCenterRequirement.installed) {
      if (predecessorMatches.length > 1 || (predecessorMatches.length === 1
        && canonicalJson(predecessorMatches[0]) !== canonicalJson(predecessor))) {
        fail('RPC_SECURITY_ATTESTATION_FAILED', 'Control Center predecessor Advisor authority is inconsistent');
      }
      if (predecessorMatches.length === 0) result = [...result, predecessor];
    } else {
      const additionFingerprints = new Set(additions.map(item => item.advisor_fingerprint));
      result = [...result.filter(item => item?.advisor_fingerprint !== predecessor.advisor_fingerprint
        && !additionFingerprints.has(item?.advisor_fingerprint)), ...additions];
    }
  }
  return phaseBoundRpcExceptions(result, manifest, phase, { policy, migrations: context.migrations });
}

function rpcIdentitiesFromExceptions(exceptions) {
  return exceptions.filter(exception => Array.isArray(exception?.object?.argument_types)).map(exception => ({
    schema: exception?.object?.schema,
    name: exception?.object?.name,
    argument_types: exception?.object?.argument_types,
  }));
}

export function validateSecurityAdvisorDelta(preItems, postItems, allowedIntroducedExceptions, allowedRemovedFindings = []) {
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
  const normalizedRemoved = allowedRemovedFindings.map(item => {
    if (typeof item === 'string') return { fingerprint: item, descriptor: null };
    const descriptor = {
      fingerprint: item?.fingerprint,
      level: item?.level,
      resource_kind: item?.resource_kind,
    };
    if (!HASH_PATTERN.test(descriptor.fingerprint ?? '') || typeof descriptor.level !== 'string'
      || descriptor.level.length === 0 || typeof descriptor.resource_kind !== 'string'
      || descriptor.resource_kind.length === 0) {
      fail('REMOTE_POSTCHECK_FAILED', 'approved removed Advisor finding is malformed');
    }
    return { fingerprint: descriptor.fingerprint, descriptor };
  });
  if (new Set(normalizedRemoved.map(item => item.fingerprint)).size !== normalizedRemoved.length) {
    fail('REMOTE_POSTCHECK_FAILED', 'approved removed Advisor findings are duplicate');
  }
  const expectedRemoved = normalizedRemoved.map(item => item.fingerprint)
    .filter(fingerprint => before.has(fingerprint)).sort();
  const removedDescriptorsValid = normalizedRemoved.every(({ fingerprint, descriptor }) => {
    if (!before.has(fingerprint) || descriptor === null) return true;
    const observed = preItems.find(item => item.fingerprint === fingerprint);
    return canonicalJson(observed ?? null) === canonicalJson(descriptor);
  });
  if (canonicalJson(removed) !== canonicalJson(expectedRemoved)
    || !removedDescriptorsValid
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

function permitsLegacyStoriesServiceRole(item) {
  if (item?.schema !== 'public' || item?.name !== 'create_story_with_media') return false;
  return canonicalJson(item.argument_types) === canonicalJson(['uuid'])
    || canonicalJson(item.argument_types) === canonicalJson(['uuid', 'jsonb', 'uuid']);
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
      || item.execute.public !== false || item.execute.anon !== false
      || item.execute.authenticated !== true || typeof item.execute.service_role !== 'boolean'
      || (item.execute.service_role === true && !permitsLegacyStoriesServiceRole(item))) {
      fail('RPC_SECURITY_ATTESTATION_FAILED', 'protected RPC authority is unsafe or incomplete');
    }
    normalizeAcl(item.acl, 'RPC_SECURITY_ATTESTATION_FAILED');
    identities.push(rpcIdentity(item));
  }
  if (new Set(identities).size !== identities.length
    || canonicalJson(identities) !== canonicalJson([...identities]
      .sort((left, right) => left.localeCompare(right)))) {
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
    .sort((left, right) => left.localeCompare(right));
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
  const storiesRequirement = storiesB1StateRequirement(policy, manifest, phase, { request, migrations });
  const storiesQuery = storiesRequirement.query;
  const storiesSafetyRequirement = storiesSafetyC1StateRequirement(policy, manifest, phase, { request, migrations });
  const storiesSafetyC2Requirement = storiesSafetyC2StateRequirement(policy, manifest, phase, { request, migrations });
  const storiesSafetyC2Authority = storiesSafetyC2AuthorityForPhase(policy, manifest, phase, { request, migrations });
  const storiesQaRequirement = storiesQaC1StateRequirement(policy, manifest, phase, { request, migrations });
  const controlCenterRequirement = superuserControlCenterStateRequirement(
    policy, manifest, phase, { request, migrations },
  );
  const perfC1Requirement = superuserQaPerfC1StateRequirement(
    policy, manifest, phase, { request, migrations },
  );
  if (storiesRequirement.required) assertReadOnlySql(storiesQuery);
  if (storiesSafetyRequirement.required) assertReadOnlySql(storiesSafetyRequirement.query);
  if (storiesSafetyC2Requirement.required) assertReadOnlySql(storiesSafetyC2Authority.query);
  if (storiesQaRequirement.required) assertReadOnlySql(storiesQaRequirement.query);
  if (controlCenterRequirement.required) assertReadOnlySql(controlCenterRequirement.query);
  if (perfC1Requirement.required) assertReadOnlySql(perfC1Requirement.query);
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
  const storiesB1State = storiesRequirement.required
    ? singleSnapshot(
      await sql(storiesQuery, null, 'Stories B1 fail-closed state'),
      normalizeStoriesB1State,
      'Stories B1 fail-closed state',
    )
    : null;
  const storiesSafetyC1State = storiesSafetyRequirement.required
    ? singleSnapshot(
      await sql(storiesSafetyRequirement.query, null, 'Stories Safety C1 predecessor state'),
      normalizeStoriesSafetyC1State,
      'Stories Safety C1 fail-closed state',
    )
    : null;
  const storiesSafetyC2State = storiesSafetyC2Requirement.required
    ? singleSnapshot(await sql(storiesSafetyC2Authority.query, null, 'Stories Safety C2 publish-first state'),
      normalizeStoriesSafetyC2State, 'Stories Safety C2 publish-first state') : null;
  const storiesQaC1State = storiesQaRequirement.required
    ? singleSnapshot(await sql(storiesQaRequirement.query, null, 'Stories QA C1 authority state'),
      normalizeStoriesQaC1State, 'Stories QA C1 authority state') : null;
  const superuserControlCenterState = controlCenterRequirement.required
    ? singleSnapshot(await sql(controlCenterRequirement.query, [identity.release_id, identity.run_id],
      'Superuser Control Center authority state'),
      normalizeSuperuserControlCenterState, 'Superuser Control Center authority state') : null;
  const superuserQaPerfC1State = perfC1Requirement.required
    ? singleSnapshot(await sql(perfC1Requirement.query, null, 'Superuser QA PERF C1 authority state'),
      normalizeSuperuserQaPerfC1State, 'Superuser QA PERF C1 authority state') : null;
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
        ...(storiesRequirement.required ? [{
          id: storiesRequirement.query_id,
          sha256: sha256(storiesQuery),
        }] : []),
        ...(storiesSafetyC2Requirement.required ? [{
          id: storiesSafetyC2Authority.query_id, sha256: sha256(storiesSafetyC2Authority.query),
        }] : []),
        ...(storiesSafetyRequirement.required ? [{
          id: storiesSafetyRequirement.query_id,
          sha256: sha256(storiesSafetyRequirement.query),
        }] : []),
        ...(storiesQaRequirement.required ? [{
          id: storiesQaRequirement.query_id,
          sha256: sha256(storiesQaRequirement.query),
        }] : []),
        ...(controlCenterRequirement.required ? [{
          id: controlCenterRequirement.query_id,
          sha256: sha256(controlCenterRequirement.query),
        }] : []),
        ...(perfC1Requirement.required ? [{
          id: perfC1Requirement.query_id,
          sha256: sha256(perfC1Requirement.query),
        }] : []),
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
    ...(storiesRequirement.required ? { stories_b1_state: storiesB1State } : {}),
    ...(storiesSafetyRequirement.required
      ? { stories_safety_c1_state: storiesSafetyC1State }
      : {}),
    ...(storiesSafetyC2Requirement.required ? { stories_safety_c2_state: storiesSafetyC2State } : {}),
    ...(storiesQaRequirement.required ? { stories_qa_c1_state: storiesQaC1State } : {}),
    ...(controlCenterRequirement.required
      ? { superuser_control_center_state: superuserControlCenterState }
      : {}),
    ...(perfC1Requirement.required
      ? { superuser_qa_perf_c1_state: superuserQaPerfC1State }
      : {}),
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

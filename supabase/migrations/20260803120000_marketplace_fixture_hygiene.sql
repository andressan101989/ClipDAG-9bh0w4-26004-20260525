-- Production fixture hygiene. Identification is ownership-first: a user must
-- match a verifier-generated email/username signature before descendants are
-- registered. Titles and descriptions are corroborating evidence only.
create schema if not exists fixture_ops;
revoke all on schema fixture_ops from public, anon, authenticated;

create table if not exists fixture_ops.internal_test_fixture_registry (
  entity_type text not null,
  entity_id uuid not null,
  fixture_suite text not null,
  fixture_run_id text not null,
  created_at timestamptz not null default now(),
  cleanup_status text not null default 'registered'
    check (cleanup_status in ('registered','quarantined','deleted','preserved')),
  primary key (entity_type, entity_id)
);
alter table fixture_ops.internal_test_fixture_registry enable row level security;
revoke all on fixture_ops.internal_test_fixture_registry from public, anon, authenticated;

create table if not exists fixture_ops.fixture_cleanup_audits (
  audit_id uuid primary key default gen_random_uuid(),
  phase text not null,
  counts jsonb not null,
  reconciliation jsonb not null default '{}'::jsonb,
  protected_products_hash text,
  created_at timestamptz not null default now()
);
alter table fixture_ops.fixture_cleanup_audits enable row level security;
revoke all on fixture_ops.fixture_cleanup_audits from public, anon, authenticated;

create or replace function fixture_ops.is_fixture(p_type text, p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from fixture_ops.internal_test_fixture_registry
    where entity_type=p_type and entity_id=p_id
  )
$$;
revoke all on function fixture_ops.is_fixture(text,uuid) from public,anon,authenticated;

-- Discover historical verifier principals. No real account is selected merely
-- for interacting with a fixture session/product.
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'auth_user',u.id,
  case when u.email like 'mkt-a4b-%' then 'mkt-a4b'
       when u.email like 'mkt-a4a-%' then 'mkt-a4a'
       when u.email like 'mkt-a3d2-ms-%' then 'mkt-a3d2-multiseller'
       else 'mkt-a3d2-settlement' end,
  coalesce(substring(u.email from '([a-z0-9]+)@example\.invalid$'),'historical')
from auth.users u left join public.user_profiles p on p.id=u.id
where u.email ~ '^mkt-a(4[ab]|3d2)(-ms)?-[a-z0-9-]+-[a-z0-9]+@example\.invalid$'
   or (u.email like '%@example.invalid' and
       (p.username like 'a4b\_%' escape '\' or p.username like 'a4a\_%' escape '\'
        or p.username like 'a3d2\_%' escape '\' or p.username like 'ms\_%' escape '\'))
on conflict do nothing;

insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'profile',p.id,r.fixture_suite,r.fixture_run_id from public.user_profiles p
join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user' and r.entity_id=p.id
on conflict do nothing;
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'seller',s.user_id,r.fixture_suite,r.fixture_run_id from public.marketplace_sellers s
join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user' and r.entity_id=s.user_id
on conflict do nothing;
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'store',s.id,r.fixture_suite,r.fixture_run_id from public.marketplace_stores s
join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user' and r.entity_id=s.seller_id
where s.slug ~ '^(a4b-(seller|creator)-|a4a-|a3d2-|ms-[ab]-)'
on conflict do nothing;
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'product',p.id,r.fixture_suite,r.fixture_run_id from public.products p
join fixture_ops.internal_test_fixture_registry r on r.entity_type='store' and r.entity_id=p.store_id
where p.seller_id in (select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='auth_user')
on conflict do nothing;

-- Descendants are registered only through proven fixture roots.
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'variant',v.id,r.fixture_suite,r.fixture_run_id from public.marketplace_product_variants v
join fixture_ops.internal_test_fixture_registry r on r.entity_type='product' and r.entity_id=v.product_id on conflict do nothing;
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'live_session',l.id,r.fixture_suite,r.fixture_run_id from public.live_sessions l
join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user' and r.entity_id=l.host_id on conflict do nothing;
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'pin',p.id,r.fixture_suite,r.fixture_run_id from public.live_session_products p
join fixture_ops.internal_test_fixture_registry r on r.entity_type='product' and r.entity_id=p.product_id on conflict do nothing;
insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
select 'affiliate_offer',o.id,r.fixture_suite,r.fixture_run_id from public.marketplace_live_affiliate_offers o
join fixture_ops.internal_test_fixture_registry r on r.entity_type='product' and r.entity_id=o.product_id on conflict do nothing;

-- Snapshot counts and every nonfixture product row before mutation. The hash is
-- stable because fixture products are excluded from the aggregate.
insert into fixture_ops.fixture_cleanup_audits(phase,counts,reconciliation,protected_products_hash)
select 'pre_quarantine', jsonb_build_object(
 'fixture_runs',(select count(distinct (fixture_suite,fixture_run_id)) from fixture_ops.internal_test_fixture_registry where entity_type='auth_user'),
 'auth_users',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='auth_user'),
 'profiles',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='profile'),
 'sellers',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='seller'),
 'stores',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='store'),
 'products',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='product'),
 'pagination_products',(select count(*) from public.products p join fixture_ops.internal_test_fixture_registry r on r.entity_type='product' and r.entity_id=p.id where p.title ~ '^Pagination Product [0-9]{2}$' or p.title ~ '^A4A Product [0-9]{2}$'),
 'variants',(select count(*) from public.marketplace_product_variants v where fixture_ops.is_fixture('product',v.product_id)),
 'inventory_rows',(select count(*) from public.marketplace_inventory_levels i join public.marketplace_product_variants v on v.id=i.variant_id where fixture_ops.is_fixture('product',v.product_id)),
 'live_sessions',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='live_session'),
 'pins',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='pin'),
 'affiliate_offers',(select count(*) from fixture_ops.internal_test_fixture_registry where entity_type='affiliate_offer'),
 'checkouts',(select count(distinct o.checkout_id) from public.marketplace_orders o where fixture_ops.is_fixture('store',o.store_id)),
 'orders',(select count(*) from public.marketplace_orders o where fixture_ops.is_fixture('store',o.store_id)),
 'reservations',(select count(*) from public.marketplace_inventory_reservations x join public.marketplace_orders o on o.id=x.order_id where fixture_ops.is_fixture('store',o.store_id)),
 'payments',(select count(distinct p.id) from public.marketplace_payments p join public.marketplace_payment_allocations a on a.payment_id=p.id where fixture_ops.is_fixture('store',a.store_id)),
 'allocations',(select count(*) from public.marketplace_payment_allocations a where fixture_ops.is_fixture('store',a.store_id)),
 'financial_transactions',(select count(distinct f.id) from public.financial_transactions f left join public.marketplace_orders o on f.reference_type='marketplace_order' and f.reference_id=o.id::text where fixture_ops.is_fixture('auth_user',f.initiated_by) or fixture_ops.is_fixture('store',o.store_id)),
 'ledger_entries',(select count(distinct le.id) from public.ledger_entries le join public.financial_transactions f on f.id=le.txn_id left join public.marketplace_orders o on f.reference_type='marketplace_order' and f.reference_id=o.id::text where fixture_ops.is_fixture('auth_user',f.initiated_by) or fixture_ops.is_fixture('store',o.store_id)),
 'purchase_events',(select count(*) from public.live_commerce_purchase_events e where fixture_ops.is_fixture('product',e.product_id)),
 'settlements',(select count(*) from public.marketplace_order_settlements s join public.marketplace_orders o on o.id=s.order_id where fixture_ops.is_fixture('store',o.store_id)),
 'settlement_legs',(select count(*) from public.marketplace_settlement_legs l join public.marketplace_order_settlements s on s.id=l.settlement_id join public.marketplace_orders o on o.id=s.order_id where fixture_ops.is_fixture('store',o.store_id))
), jsonb_build_object('payments',public.reconcile_marketplace_payments(),'settlements',public.reconcile_marketplace_settlements(),'commissions',public.reconcile_marketplace_live_commissions()),
encode(extensions.digest(coalesce((select string_agg(to_jsonb(p)::text,'' order by p.id) from public.products p where not fixture_ops.is_fixture('product',p.id)),''),'sha256'),'hex');
-- Immediate quarantine. Financial and audit rows remain immutable and intact.
update public.live_session_products set status='removed',is_featured=false,unpinned_at=coalesce(unpinned_at,now()),updated_at=now(),version=version+1
where status='active' and fixture_ops.is_fixture('pin',id);
update public.marketplace_live_affiliate_offers set status='removed',updated_at=now()
where status='active' and fixture_ops.is_fixture('affiliate_offer',id);
update public.live_sessions set status='ended',ended_at=coalesce(ended_at,now())
where status='live' and fixture_ops.is_fixture('live_session',id);
update public.products set status='paused',moderation_status='suspended',published_at=null,updated_at=now()
where fixture_ops.is_fixture('product',id) and status<>'deleted';
update public.marketplace_stores set status='suspended',updated_at=now()
where fixture_ops.is_fixture('store',id) and status<>'suspended';
update fixture_ops.internal_test_fixture_registry set cleanup_status=case when entity_type in('product','store','live_session','pin','affiliate_offer') then 'quarantined' else 'preserved' end;

insert into fixture_ops.fixture_cleanup_audits(phase,counts,reconciliation,protected_products_hash)
select 'post_quarantine',jsonb_build_object(
 'active_products',(select count(*) from public.products where fixture_ops.is_fixture('product',id) and status='active' and moderation_status='approved' and deleted_at is null),
 'active_stores',(select count(*) from public.marketplace_stores where fixture_ops.is_fixture('store',id) and status='active'),
 'live_sessions',(select count(*) from public.live_sessions where fixture_ops.is_fixture('live_session',id) and status='live'),
 'active_pins',(select count(*) from public.live_session_products where fixture_ops.is_fixture('pin',id) and status='active'),
 'active_offers',(select count(*) from public.marketplace_live_affiliate_offers where fixture_ops.is_fixture('affiliate_offer',id) and status='active'),
 'rows_quarantined',(select count(*) from fixture_ops.internal_test_fixture_registry where cleanup_status='quarantined'),
 'financial_rows_preserved',(select (counts->>'financial_transactions')::int+(counts->>'ledger_entries')::int+(counts->>'payments')::int+(counts->>'allocations')::int+(counts->>'settlements')::int+(counts->>'settlement_legs')::int from fixture_ops.fixture_cleanup_audits where phase='pre_quarantine' order by created_at desc limit 1)
),jsonb_build_object('payments',public.reconcile_marketplace_payments(),'settlements',public.reconcile_marketplace_settlements(),'commissions',public.reconcile_marketplace_live_commissions()),
encode(extensions.digest(coalesce((select string_agg(to_jsonb(p)::text,'' order by p.id) from public.products p where not fixture_ops.is_fixture('product',p.id)),''),'sha256'),'hex');

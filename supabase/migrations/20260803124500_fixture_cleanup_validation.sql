insert into fixture_ops.fixture_cleanup_audits(phase,counts,reconciliation,protected_products_hash)
select 'final_validation',jsonb_build_object(
 'public_shop_fixture_products',(select count(*) from public.products p join public.marketplace_stores s on s.id=p.store_id where fixture_ops.is_fixture('product',p.id)and p.status='active'and p.moderation_status='approved'and p.deleted_at is null and s.status='active'),
 'live_candidate_fixture_products',(select count(*) from public.products p join public.marketplace_stores s on s.id=p.store_id join public.marketplace_sellers ms on ms.user_id=p.seller_id where fixture_ops.is_fixture('product',p.id)and p.status='active'and p.moderation_status='approved'and p.deleted_at is null and s.status='active'and ms.status='approved'),
 'active_fixture_sessions',(select count(*)from public.live_sessions where fixture_ops.is_fixture('live_session',id)and status='live'),
 'purchasable_fixture_pins',(select count(*)from public.live_session_products p join public.products x on x.id=p.product_id join public.live_sessions l on l.id=p.session_id where fixture_ops.is_fixture('pin',p.id)and p.status='active'and x.status='active'and l.status='live'),
 'active_fixture_offers',(select count(*)from public.marketplace_live_affiliate_offers where fixture_ops.is_fixture('affiliate_offer',id)and status='active'),
 'orphan_variants',(select count(*)from public.marketplace_product_variants v left join public.products p on p.id=v.product_id where p.id is null),
 'orphan_inventory',(select count(*)from public.marketplace_inventory_levels i left join public.marketplace_product_variants v on v.id=i.variant_id where v.id is null),
 'orphan_reservations',(select count(*)from public.marketplace_inventory_reservations r left join public.marketplace_orders o on o.id=r.order_id left join public.marketplace_product_variants v on v.id=r.variant_id where o.id is null or v.id is null),
 'rows_deleted',0,
 'auth_users_deleted',0,
 'auth_users_retained',(select count(*)from fixture_ops.internal_test_fixture_registry where entity_type='auth_user')
),jsonb_build_object('payments',public.reconcile_marketplace_payments(),'settlements',public.reconcile_marketplace_settlements(),'commissions',public.reconcile_marketplace_live_commissions()),
encode(extensions.digest(coalesce((select string_agg(to_jsonb(p)::text,''order by p.id)from public.products p where not fixture_ops.is_fixture('product',p.id)),''),'sha256'),'hex');

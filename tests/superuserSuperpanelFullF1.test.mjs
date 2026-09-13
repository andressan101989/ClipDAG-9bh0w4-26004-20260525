import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const app=read('apps/admin-web/src/App.tsx');
const shell=read('apps/admin-web/src/layout/AdminShell.tsx');
const navigation=read('apps/admin-web/src/layout/adminNavigation.ts');
const finance=read('apps/admin-web/src/pages/AdminFinanceAuditSystemPages.tsx');
const financeApi=read('apps/admin-web/src/lib/adminObservabilityApi.ts');
const marketplaceApi=read('apps/admin-web/src/lib/adminApi.ts');
const migration=read('supabase/migrations/20260913201918_repair_admin_finance_reconciliation_projection.sql');

const sections={
  finance:[
    ['/finance','finance.ledger.read','Resumen'],['/finance/accounts','finance.ledger.read','Cuentas'],
    ['/finance/transactions','finance.ledger.read','Transacciones'],['/finance/reconciliation','finance.reconciliation.read','Reconciliación'],
    ['/finance/anomalies','finance.anomalies.read','Anomalías'],['/finance/audit','finance.audit.read','Auditoría'],
  ],
  marketplace:[
    ['/marketplace','marketplace.overview.read','Resumen'],['/marketplace/orders','marketplace.orders.read','Pedidos'],
    ['/marketplace/disputes','marketplace.disputes.read','Disputas'],['/marketplace/sellers','marketplace.sellers.read','Vendedores'],
    ['/marketplace/products','marketplace.products.read','Productos'],['/marketplace/creator-commerce','marketplace.creators.read','Creator Commerce'],
    ['/marketplace/promotions','marketplace.promotions.read','Promociones'],['/marketplace/ads','marketplace.ads.read','Ads'],
    ['/marketplace/health','marketplace.health.read','Salud'],['/marketplace/activity','marketplace.audit.read','Actividad'],
  ],
  system:[['/system','system.health.read','Salud'],['/system/jobs','system.jobs.read','Jobs'],['/system/audit','system.audit.read','Auditoría']],
};

test('one capability-driven navigation authority exposes every grouped route',()=>{
  for(const [group,items] of Object.entries(sections))for(const [path,capability,label] of items){
    assert.match(navigation,new RegExp(`to:\"${path.replaceAll('/','\\/')}\"[^\\n]+capability:\"${capability.replaceAll('.','\\.')}\"[^\\n]+group:\"${group}\"[^\\n]+sectionLabel:\"${label}`));
    assert.match(app,new RegExp(`path=\"${path.replaceAll('/','\\/')}\"`));
  }
  assert.doesNotMatch(shell,/sectionLinks|admin-section-nav|SUPER_ADMIN|SUPERUSER|role_code/);
  assert.match(shell,/authorizedChildren/);
  assert.match(shell,/aria-expanded=\{expanded\}/);
});

test('all Marketplace list and detail routes remain wired to their existing pages',()=>{
  for(const path of [
    '/marketplace','/marketplace/orders','/marketplace/orders/:orderId','/marketplace/disputes','/marketplace/disputes/:id',
    '/marketplace/sellers','/marketplace/sellers/:id','/marketplace/products','/marketplace/products/:id',
    '/marketplace/creator-commerce','/marketplace/creator-commerce/:id','/marketplace/promotions','/marketplace/promotions/:id',
    '/marketplace/ads','/marketplace/ads/:id','/marketplace/health','/marketplace/activity',
  ])assert.match(app,new RegExp(`path=\"${path.replaceAll('/','\\/')}\"`),path);
  assert.match(marketplaceApi,/rpc\("admin_resolve_marketplace_dispute"/);
  assert.match(marketplaceApi,/rpc\("admin_moderate_marketplace_seller"/);
  assert.match(marketplaceApi,/rpc\("admin_moderate_marketplace_product"/);
});

test('Finance pages use the one canonical read API and expose no money controls',()=>{
  for(const rpc of [
    'get_admin_finance_overview','search_admin_ledger_accounts','search_admin_financial_transactions',
    'get_admin_financial_transaction_detail','get_admin_finance_reconciliation','search_admin_finance_anomalies','search_admin_finance_audit',
  ])assert.match(financeApi,new RegExp(`rpc\\(\"${rpc}\"`));
  assert.match(finance,/AdminFactGrid/);
  assert.match(finance,/transactions_by_operation/);
  assert.match(finance,/settlement_reversals/);
  assert.doesNotMatch(finance,/onClick=.*(?:reconcile|settle|refund|retry|repair)/i);
});

test('Finance repair changes only the read projection and fixes the nonexistent reversal status',()=>{
  assert.match(migration,/create or replace function public\.get_admin_finance_reconciliation\(\)/);
  assert.match(migration,/admin_require_capability\('finance\.reconciliation\.read'\)/);
  assert.match(migration,/from public\.marketplace_settlement_reversals group by reason_code/);
  assert.doesNotMatch(migration,/marketplace_settlement_reversals group by status/);
  assert.match(migration,/stable[\s\S]*security definer[\s\S]*set search_path=''/);
  assert.match(migration,/revoke all on function public\.get_admin_finance_reconciliation\(\) from public,anon,authenticated,service_role/);
  assert.match(migration,/grant execute on function public\.get_admin_finance_reconciliation\(\) to authenticated/);
  assert.doesNotMatch(migration,/(?:insert into|update|delete from|create table|alter table|drop table|truncate)\s/i);
});

test('canonical presentation remains singular and F1 duplicate helpers are not imported',()=>{
  assert.ok(existsSync('apps/admin-web/src/components/AdminPresentation.tsx'));
  assert.ok(existsSync('apps/admin-web/src/components/AdminReportSubject.tsx'));
  assert.ok(!existsSync('apps/admin-web/src/components/AdminProfileCard.tsx'));
  assert.ok(!existsSync('apps/admin-web/src/lib/adminDetail.ts'));
  assert.doesNotMatch(read('apps/admin-web/src/layout/AdminShell.tsx')+finance,/AdminProfileCard|adminDetail/);
});

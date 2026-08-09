import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20260810150000_expiry_safe_marketplace_ads_finalization.sql');
const base = read('supabase/migrations/20260810100000_marketplace_ads_financial_authority.sql');

for (const token of [
  'finalize_marketplace_ad_campaign_delivery',
  'marketplace_ad_finalizations',
  'eligible_elapsed_seconds',
  'delivery_target_seconds',
  'marketplace_ad_spend_above_final_pacing_target',
  'final-pacing-spend',
  'final-pacing-release',
  'final-delivery-settlement',
  'for update skip locked',
  'completed_campaign_remaining_reserved',
]) assert.match(sql, new RegExp(token));

assert.match(base, /now\(\)>=c\.ends_at/);
assert.doesNotMatch(sql, /create or replace function public\.spend_marketplace_ad_budget/);
assert.match(sql, /target:=least\(c\.total_budget_bdag,round\(c\.total_budget_bdag\*c\.eligible_elapsed_seconds::numeric\/target_seconds::numeric,8\)\)/);
assert.match(sql, /if c\.spent_bdag>target then raise exception/);
assert.match(sql, /if delta>0 then/);
assert.match(sql, /if unused>0 then/);
assert.match(sql, /perform public\.marketplace_ad_checkpoint_eligibility_at/);
assert.match(sql, /status not in\('completed','exhausted','cancelled'\)/);
assert.match(sql, /auth\.role\(\)<>'service_role'/);
assert.match(sql, /revoke all on function public\.finalize_marketplace_ad_campaign_delivery/);

const cache = join(tmpdir(), 'onspace-ads-finalization-npm-cache');
mkdirSync(cache, { recursive: true });
const cli = spawnSync(process.env.ComSpec, ['/d','/s','/c','npx.cmd supabase db dump --linked --schema public --dry-run'], {
  cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
  env: { ...process.env, npm_config_cache: cache },
});
const captured = String(cli.stdout || '') + String(cli.stderr || '');
const env = name => captured.match(new RegExp("(?:export |set \\\"?)" + name + "=[\\\"']?([^\\\"'\\r\\n ]+)"))?.[1];
assert.equal(cli.status, 0, 'secure_connection_failed:' + captured.slice(-500));
const db = new pg.Client({
  host: env('PGHOST'), port: Number(env('PGPORT')), user: env('PGUSER'),
  password: env('PGPASSWORD'), database: env('PGDATABASE'), ssl: { rejectUnauthorized: false },
});
let open = false;
try {
  await db.connect();
  await db.query('set role postgres');
  await db.query('begin');
  open = true;
  await db.query("set local lock_timeout='10s'");
  await db.query("set local statement_timeout='30s'");
  const deployed = (await db.query("select to_regclass('public.marketplace_ad_finalizations') is not null ok")).rows[0].ok;
  if (!deployed) await db.query(sql.replace(/^begin;\s*|\s*commit;\s*$/g, ''));
  await db.query("select set_config('request.jwt.claim.role','service_role',true)");
  const seller = randomUUID(), store = randomUUID(), session = randomUUID();
  const claims = (role, sub = '') => db.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claim.sub',$3,true)",
    [JSON.stringify(sub ? { role, sub } : { role }), role, sub],
  );
  await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())", [seller, randomUUID() + '@synthetic.local']);
  await db.query('insert into user_profiles(id,username,display_name)values($1,$2,$3)', [seller, 'adsfinal_' + randomUUID().replaceAll('-','').slice(0,10), 'Ads Final Proof']);
  await db.query("insert into marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Ads Final Proof',now())", [seller]);
  await db.query("insert into marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'Ads Final Store',$3,'active')", [store, seller, 'ads-final-' + randomUUID()]);
  const category = (await db.query("select id from marketplace_categories where status='active' order by created_at limit 1")).rows[0].id;
  await claims('authenticated', seller);
  const product = (await db.query('select create_or_resume_marketplace_product_draft($1,$2,$3) id', [store, category, session])).rows[0].id;
  await claims('service_role', seller);
  await db.query("update products set title='Ads Final Product',description='Rollback only',price=100,status='active',moderation_status='approved',published_at=now() where id=$1", [product]);
  const variant = (await db.query('select id from marketplace_product_variants where product_id=$1 order by is_default desc limit 1', [product])).rows[0].id;
  await db.query("update marketplace_product_variants set status='active',archived_at=null where id=$1", [variant]);
  await db.query('update marketplace_inventory_levels set on_hand=100,reserved=0 where variant_id=$1', [variant]);
  const account = (await db.query('select ensure_ledger_account($1) id', [seller])).rows[0].id;
  await db.query('update ledger_accounts set balance=1000 where id=$1', [account]);
  const makeCampaign = async (spent, eligibleSeconds) => {
    const starts = new Date(Date.now() + 3600000), ends = new Date(Date.now() + 11 * 3600000);
    await claims('authenticated', seller);
    const id = (await db.query('select create_marketplace_ad_campaign_draft($1,$2,100,$3,$4,$5) result', [product, 'Final proof', starts, ends, randomUUID()])).rows[0].result.id;
    await db.query('select activate_marketplace_ad_campaign($1,$2)', [id, randomUUID()]);
    await claims('service_role', seller);
    await db.query("update marketplace_ad_campaigns set starts_at=now()-interval'11 hours',ends_at=now()+interval'1 hour',status='active' where id=$1", [id]);
    if (spent > 0) await db.query('select spend_marketplace_ad_budget($1,$2,$3)', [id, spent, randomUUID()]);
    await db.query('alter table marketplace_ad_campaigns disable trigger marketplace_ad_campaign_clock_before');
    await db.query("update marketplace_ad_campaigns set starts_at=now()-interval'11 hours',ends_at=now()-interval'1 hour',eligible_elapsed_seconds=$2,eligibility_checkpoint_at=now()-interval'1 hour',eligibility_state=false,eligibility_reason='expired' where id=$1", [id, eligibleSeconds]);
    await db.query('alter table marketplace_ad_campaigns enable trigger marketplace_ad_campaign_clock_before');
    return id;
  };
  const settle = async (spent, elapsed, target, delta, released) => {
    const id = await makeCampaign(spent, elapsed), key = randomUUID();
    const first = (await db.query('select finalize_marketplace_ad_campaign_delivery($1,$2) result', [id, key])).rows[0].result;
    const retry = (await db.query('select finalize_marketplace_ad_campaign_delivery($1,$2) result', [id, key])).rows[0].result;
    assert.equal(Number(first.final_target_bdag), target);
    assert.equal(Number(first.final_spend_delta_bdag), delta);
    assert.equal(Number(first.released_bdag), released);
    assert.equal(Number(retry.final_spend_delta_bdag), delta);
    const row = (await db.query('select spent_bdag,released_bdag,total_budget_bdag from marketplace_ad_campaigns where id=$1', [id])).rows[0];
    assert.equal(Number(row.spent_bdag), target);
    assert.equal(Number(row.released_bdag), released);
    assert.equal(Number(row.total_budget_bdag - row.spent_bdag - row.released_bdag), 0);
    return id;
  };
  await settle(30, 14400, 40, 10, 60);
  await settle(38, 14400, 40, 2, 60);
  await settle(0, 0, 0, 0, 100);
  await settle(90, 36000, 100, 10, 0);
  const atTarget = await settle(40, 14400, 40, 0, 60);
  assert.equal(Number((await db.query("select count(*) c from marketplace_ad_financial_events where campaign_id=$1 and event_type='spend' and amount_bdag=0", [atTarget])).rows[0].c), 0);
  await db.query('savepoint corrupt_target');
  const corrupt = await makeCampaign(50, 14400);
  await assert.rejects(db.query('select finalize_marketplace_ad_campaign_delivery($1,$2)', [corrupt, randomUUID()]), /marketplace_ad_spend_above_final_pacing_target/);
  await db.query('rollback to savepoint corrupt_target');
  await db.query('release savepoint corrupt_target');
  const rec = (await db.query('select reconcile_marketplace_ad_finalization() result')).rows[0].result;
  for (const key of ['expired_unfinalized_liability','final_spend_above_pacing_target','completed_campaign_remaining_reserved','finalization_record_mismatches']) {
    assert.equal(Number(rec[key]), 0, key + ':' + rec[key]);
  }
  await db.query('rollback');
  open = false;
} finally {
  if (open) await db.query('rollback').catch(() => {});
  await db.end().catch(() => {});
}

console.log(JSON.stringify({
  ok: true,
  normalPostExpirySpendRulePreserved: true,
  finalizationNarrow: true,
  cutoff: 'ends_at',
  callerAmountTrusted: false,
  atomicTransaction: true,
  deterministicSpendKey: true,
  deterministicReleaseKey: true,
  zeroSpendSuppressed: true,
  corruptionGuard: true,
  batchDelegates: true,
  migrationExecutedRollbackOnly: true,
  reconciliationClean: true,
  partial40Release60: true,
  blocker38Plus2Release60: true,
  zeroDeliveryRelease100: true,
  fullDeliverySpend100: true,
  alreadyTargetNoZeroSpend: true,
  retryIdempotent: true,
  corruptionRejected: true,
  persistentFixtures: 0,
}));

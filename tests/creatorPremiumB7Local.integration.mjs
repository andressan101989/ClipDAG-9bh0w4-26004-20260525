import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.RUN_CREATOR_PREMIUM_B7_LOCAL === '1';
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'supabase_db_clipdag-local-test';
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'premium_b5_template';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const phases = [
  '_creator_premium_b1_canonical_foundation.sql',
  '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql',
  '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql',
  '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql',
];
const chain = phases.map(suffix => {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix));
  return {
    suffix,
    found,
    sql: found.length === 1 ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8') : '',
  };
});

function docker(command, { input = '', allowFailure = false } = {}) {
  const result = spawnSync('docker', ['exec', '-i', container, 'bash', '-lc', command], {
    encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker command failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, options = {}) {
  assert.match(db, /^[a-z0-9_]+$/);
  return docker(`psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`, { input: sql, ...options });
}

function asRole(db, role, actor, sql, options = {}) {
  return psql(db, `begin;set local request.jwt.claim.sub='${actor}';set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`, options);
}

function expectFailure(result, expected) {
  assert.notEqual(result.status, 0, `expected failure matching ${expected}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expected, 'i'));
}

test('B7 disposable harness targets the complete single-migration Premium chain', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix);
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_b7_full_functional_commercial_completion\.sql$/);
  assert.ok(chain.at(-1).sql.length > 20_000);
});

test('B7 disposable database proves moderation, safe commerce, reporting, policy gates, refunds, and entitlement', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `premium_b7_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const creator = randomUUID();
  const buyer = randomUUID();
  const admin = randomUUID();
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, chain.map(item => item.sql).join('\n'));

    // The detailed disposable fixture is deliberately server-side and rolls
    // back financial mutations. This smoke section first proves the new
    // authority surface compiles and remains inaccessible without capability.
    const functions = psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('search_admin_creator_premium_content_v1','get_admin_creator_premium_content_v1','admin_review_creator_premium_content_v1','get_creator_premium_commerce_v1','get_my_creator_premium_subscriptions_v1','get_my_creator_premium_commercial_summary_v1','admin_refund_creator_premium_purchase_v1','admin_refund_creator_premium_subscription_period_v1')`).stdout;
    assert.equal(functions, '8');

    psql(db, `set session_replication_role=replica;insert into auth.users(id,is_anonymous) values ('${creator}',false),('${buyer}',false),('${admin}',false);insert into public.user_profiles(id,username) values ('${creator}','b7_creator'),('${buyer}','b7_buyer'),('${admin}','b7_admin');set session_replication_role=origin;`);
    expectFailure(asRole(db, 'authenticated', buyer, `select public.admin_review_creator_premium_content_v1('${randomUUID()}','approve','reviewed','${randomUUID()}')`, { allowFailure: true }), 'admin_capability_forbidden');
    expectFailure(asRole(db, 'authenticated', admin, `select public.admin_refund_creator_premium_purchase_v1('${randomUUID()}','${randomUUID()}','admin_requested')`, { allowFailure: true }), 'admin_capability_forbidden');

    const policy = psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy where singleton`).stdout;
    assert.equal(policy, 'false|false|false|0');
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true });
  }
});

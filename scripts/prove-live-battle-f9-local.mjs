// Local-only bootstrap/SQL runner. Never accepts a remote connection or project ref.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const container = 'clipdag-lb4-f9-proof';
const evidence = 'docs/validation/lb4-f9-a/';
const action = process.argv[2];
function sql(input, label) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 30e6 });
  writeFileSync(evidence + label + '.log', result.stdout + result.stderr);
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr.slice(-1800)}`);
  console.log(`${label}: PASS`);
}
if (action === 'bootstrap') {
  assert.ok(process.env.LB4_F9_BASE_SCHEMA, 'Provide the same sanitized schema-only F4D fixture used for C1');
  const schema = readFileSync(process.env.LB4_F9_BASE_SCHEMA, 'utf8');
  writeFileSync(evidence + 'bootstrap.json', JSON.stringify({ container, schemaSHA256: createHash('sha256').update(schema).digest('hex'), source: 'C1 sanitized F4D schema fixture; no production access', image: 'public.ecr.aws/supabase/postgres:17.6.1.165' }, null, 2));
  sql('create extension if not exists pg_cron; create extension if not exists plpgsql_check; drop schema if exists auth cascade; drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists fixture_ops cascade;', 'bootstrap-extensions');
  sql(schema, 'bootstrap-schema');
  sql('create extension if not exists pg_cron; create extension if not exists plpgsql_check; grant usage on schema cron to postgres; grant select on cron.job to postgres;', 'bootstrap-local-extensions');
  // Restore catalog fixtures locally, as in C1; never modifies repository catalog or prices.
  let catalog = readFileSync('supabase/migrations/20260711041318_live_gift_economy.sql', 'utf8').match(/insert into public.gift_catalog[\s\S]*?on conflict \(id\) do nothing;/)[0].replace('do nothing', 'do update set cost_coins=excluded.cost_coins');
  const premium = readFileSync('supabase/migrations/20260711180000_live_gift_premium_catalog.sql', 'utf8');
  catalog += '\n' + premium.slice(premium.indexOf('update public.gift_catalog'), premium.indexOf('create index if not exists gift_catalog_enabled_display_idx'));
  for (const name of ['20260711193000_replace_sports_car_with_private_jet.sql']) catalog += '\n' + readFileSync('supabase/migrations/' + name, 'utf8');
  sql('set role postgres;\n' + catalog, 'bootstrap-catalog');
  const power = readFileSync('supabase/migrations/20260830053531_live_battles_lb4_f4d_a_power_engine.sql', 'utf8');
  const rules = power.match(/insert into public.live_battle_rule_sets \([\s\S]*?'fixed_battle_grant'\);/)[0];
  sql(rules + "\ninsert into public.live_battle_current_rule_set(singleton,rule_set_id) select true,id from public.live_battle_rule_sets where rule_version=2;", 'bootstrap-rules');
  for (const name of readdirSync('supabase/migrations').filter(n => n >= '20260830162244' && n < '20260906053652').sort()) {
    sql('set role postgres;\n' + readFileSync('supabase/migrations/' + name, 'utf8'), 'bootstrap-' + name);
  }
  sql('select cron.alter_job(jobid,active := false) from cron.job;', 'bootstrap-disable-jobs');
} else if (action === 'sql') {
  const file = process.argv[3];
  assert.ok(file.startsWith('supabase/'));
  sql('set role postgres;\n' + readFileSync(file, 'utf8'), process.argv[4] ?? 'postgres');
} else throw new Error('Expected bootstrap or sql');

// Runs only in a disposable database inside the local compile container.
// NELYON_PLR1_LOCAL=1 enables the lifecycle and concurrency proof.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const enabled = process.env.NELYON_PLR1_LOCAL === '1';
const container = 'nelyon-ads-v2-d-compile';
const database = `plr1_${process.pid}`;
const ids = {
  adult: '10000000-0000-4000-8000-000000000001',
  teen: '10000000-0000-4000-8000-000000000002',
  under13: '10000000-0000-4000-8000-000000000003',
  invalid: '10000000-0000-4000-8000-000000000004',
  evaluated: '10000000-0000-4000-8000-000000000005',
  concurrent: '10000000-0000-4000-8000-000000000006',
  signupAdult: '10000000-0000-4000-8000-000000000007',
  signupUnknown: '10000000-0000-4000-8000-000000000008',
};

const psqlArgs = (db, ...extra) => ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db, ...extra];
const run = (sql, db = database) => execFileSync('docker', psqlArgs(db, '-At'), { input: sql, encoding: 'utf8' }).trim();
const runAsync = (sql) => new Promise((resolve, reject) => {
  const child = spawn('docker', psqlArgs(database, '-At'));
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim())));
  child.stdin.end(sql);
});
const migration = (path) => fs.readFileSync(path, 'utf8');
const asActor = (id, expression) => run(`begin; set local request.jwt.claim.sub='${id}'; set local role authenticated; select ${expression}; commit;`)
  .split('\n').find((line) => line.startsWith('{') || /^(true|false)$/.test(line));

test('PLR-1 backfill, remediation, concurrency, signup and gates work in an isolated database', { skip: !enabled, timeout: 120_000 }, async () => {
  run(`create database ${database};`, 'postgres');
  try {
    run(`
      create schema auth;
      create schema private;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    run(migration('supabase/migrations/20260920183107_age_eligibility_foundation_b1.sql'));
    run(migration('supabase/migrations/20260920193000_age_eligibility_signup_enforcement_b2.sql'));
    run(migration('supabase/migrations/20260920222527_age_policy_account13_creator18_c1.sql'));
    run(`
      create function private.ads_actor_is_advertiser_age_eligible(p_actor uuid)
      returns boolean language sql stable security definer set search_path='' as $$
        select coalesce(exists (
          select 1 from private.user_age_eligibility e
          join private.age_eligibility_policy p on p.singleton
          where e.user_id=p_actor and e.status='eligible' and e.age_band='age_18_plus'
            and e.minimum_age=p.minimum_age and e.policy_version=p.policy_version
            and p.creator_exclusive_minimum_age=18 and e.evaluated_at is not null
        ),false)
      $$;
      revoke all on function private.ads_actor_is_advertiser_age_eligible(uuid) from public, anon, authenticated, service_role;
      insert into auth.users(id,raw_user_meta_data) values
        ('${ids.adult}','{}'),('${ids.teen}','{}'),('${ids.under13}','{}'),('${ids.invalid}','{}'),
        ('${ids.evaluated}',jsonb_build_object('date_of_birth','1990-01-01')),('${ids.concurrent}','{}');
      delete from private.user_age_eligibility where user_id <> '${ids.evaluated}';
    `);

    const plr = migration('supabase/migrations/20260923214108_ads_v2_plr_1_age_eligibility_readiness.sql');
    run(plr);
    assert.equal(run("select count(*) from private.user_age_eligibility where status='unknown_legacy' and age_band='unknown_legacy' and evaluated_at is null and source='legacy_unknown'"), '5');
    assert.equal(run(`select status||'|'||age_band||'|'||source from private.user_age_eligibility where user_id='${ids.evaluated}'`), 'eligible|age_18_plus|signup_metadata');
    assert.equal(run('select count(*) from private.user_age_eligibility'), '6');
    run(plr);
    assert.equal(run('select count(*) from private.user_age_eligibility'), '6');

    const readUnknown = JSON.parse(asActor(ids.adult, 'public.get_my_age_eligibility()'));
    assert.deepEqual({ status: readUnknown.status, evaluated: readUnknown.evaluated, adult: readUnknown.advertiser_18_plus_eligible }, { status: 'unknown_legacy', evaluated: false, adult: false });
    const adult = JSON.parse(asActor(ids.adult, "public.remediate_my_age_eligibility('1990-05-10')"));
    const teen = JSON.parse(asActor(ids.teen, "public.remediate_my_age_eligibility(((current_date - interval '15 years')::date)::text)"));
    const under13 = JSON.parse(asActor(ids.under13, "public.remediate_my_age_eligibility(((current_date - interval '10 years')::date)::text)"));
    assert.equal(adult.age_band, 'age_18_plus');
    assert.equal(teen.age_band, 'age_13_17');
    assert.equal(under13.age_band, 'under_13');
    assert.equal(run(`select private.ads_actor_is_advertiser_age_eligible('${ids.adult}'), private.ads_actor_is_advertiser_age_eligible('${ids.teen}'), private.ads_actor_is_advertiser_age_eligible('${ids.under13}'), private.ads_actor_is_advertiser_age_eligible('${ids.invalid}')`), 't|f|f|f');
    assert.equal(JSON.parse(asActor(ids.adult, "public.remediate_my_age_eligibility(((current_date - interval '15 years')::date)::text)")).age_band, 'age_18_plus');
    assert.equal(run("select count(*) from information_schema.columns where table_schema='private' and table_name='user_age_eligibility' and column_name like '%birth%'"), '0');

    assert.throws(() => asActor(ids.invalid, "public.remediate_my_age_eligibility('bad-date')"), /age_eligibility_invalid_date_of_birth/);
    assert.throws(() => asActor(ids.invalid, "public.remediate_my_age_eligibility('2999-01-01')"), /age_eligibility_invalid_date_of_birth/);
    assert.equal(run(`select status from private.user_age_eligibility where user_id='${ids.invalid}'`), 'unknown_legacy');

    const call = (dob) => `begin; set local request.jwt.claim.sub='${ids.concurrent}'; set local role authenticated; select public.remediate_my_age_eligibility('${dob}'); commit;`;
    const [first, second] = await Promise.all([runAsync(call('1990-01-01')), runAsync(call('2010-01-01'))]);
    assert.equal(JSON.parse(first.split('\n').find((line) => line.startsWith('{'))).age_band, JSON.parse(second.split('\n').find((line) => line.startsWith('{'))).age_band);
    assert.equal(run(`select count(*) from private.user_age_eligibility where user_id='${ids.concurrent}' and status in ('eligible','ineligible')`), '1');

    run(`insert into auth.users(id,raw_user_meta_data) values ('${ids.signupAdult}',jsonb_build_object('date_of_birth','1990-01-01')),('${ids.signupUnknown}','{}');`);
    assert.equal(run(`select age_band from private.user_age_eligibility where user_id='${ids.signupAdult}'`), 'age_18_plus');
    assert.equal(run(`select status||'|'||age_band from private.user_age_eligibility where user_id='${ids.signupUnknown}'`), 'unknown_legacy|unknown_legacy');
    run(`update auth.users set raw_user_meta_data=jsonb_build_object('date_of_birth','1990-01-01') where id='${ids.signupUnknown}';`);
    assert.equal(run(`select status||'|'||age_band from private.user_age_eligibility where user_id='${ids.signupUnknown}'`), 'unknown_legacy|unknown_legacy');
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid(); drop database if exists ${database};`, 'postgres');
  }
});

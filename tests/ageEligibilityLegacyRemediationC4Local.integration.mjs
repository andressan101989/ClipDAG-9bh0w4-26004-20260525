// Real disposable PostgreSQL proof. Set NELYON_AGE_C4_LOCAL=1 to enable it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_AGE_C4_LOCAL === '1';
const container = process.env.NELYON_AGE_C4_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_AGE_C4_TEMPLATE ?? 'plr9_production_clone2';
const user = 'supabase_admin';
const migrations = new URL('../supabase/migrations/', import.meta.url);

function migration(suffix) {
  const matches = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(matches.length, 1, suffix);
  return readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8');
}

const plr10 = migration('_ads_v2_plr_10_multisurface_age_targeting.sql');
const c4Names = readdirSync(migrations)
  .filter((name) => name.endsWith('_age_eligibility_legacy_remediation_projection.sql'));
const c4 = c4Names.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${c4Names[0]}`, import.meta.url), 'utf8')
  : '';

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, options = {}) {
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db, '-At'], {
    input: sql,
    ...options,
  });
}

function asRole(db, role, actor, sql, { allowFailure = false } = {}) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return psql(db, `begin;${subject}set local role ${role};${sql};commit;`, { allowFailure });
}

function createDatabase() {
  const db = `age_c4_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', user, '-T', template, db]);
  psql(db, `
    insert into private.advertising_targeting_policy(singleton, policy_version)
    values(true, 'nelyon-ads-targeting-v2');
    insert into private.age_eligibility_policy(
      singleton, minimum_age, policy_version, creator_exclusive_minimum_age
    ) values(true, 13, 'nelyon-age-v2', 18);
  `);
  psql(db, plr10);
  // The production migrations are owned by postgres. The disposable clone is
  // patched by supabase_admin, so restore the production owner relationship
  // for the private parser invoked by the canonical SECURITY DEFINER RPC.
  psql(db, 'alter function private.age_parse_dob(text,date) owner to postgres;');
  psql(db, c4);
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', user, '--force', '--if-exists', db], { allowFailure: true });
}

test('C4 disposable harness targets exactly one corrective migration', { skip: !enabled }, () => {
  assert.equal(c4Names.length, 1);
  assert.ok(c4.length > 0);
});

test('the self-only projection returns truthful minimal states and authenticated-only ACL', { skip: !enabled }, () => {
  const db = createDatabase();
  const ids = {
    remediation: '10000000-0000-4000-8000-000000000101',
    complete: '10000000-0000-4000-8000-000000000102',
    unknown: '10000000-0000-4000-8000-000000000103',
    ineligible: '10000000-0000-4000-8000-000000000104',
    absent: '10000000-0000-4000-8000-000000000105',
  };
  try {
    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id) values
        ('${ids.remediation}'),('${ids.complete}'),('${ids.unknown}'),('${ids.ineligible}'),('${ids.absent}');
      insert into public.user_profiles(id) values
        ('${ids.remediation}'),('${ids.complete}'),('${ids.unknown}'),('${ids.ineligible}'),('${ids.absent}');
      insert into private.user_age_eligibility(
        user_id,status,age_band,minimum_age,policy_version,evaluated_at,source,birth_date
      ) values
        ('${ids.remediation}','eligible','age_18_plus',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata',null),
        ('${ids.complete}','eligible','age_18_plus',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata',(current_date-interval '25 years')::date),
        ('${ids.unknown}','unknown_legacy','unknown_legacy',13,'nelyon-age-v2',null,'legacy_unknown',null),
        ('${ids.ineligible}','ineligible','under_13',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata',(current_date-interval '10 years')::date);
      set session_replication_role=origin;
    `);

    const projection = (id) => JSON.parse(asRole(db, 'authenticated', id, 'select public.get_my_age_eligibility_status_v2()::text').stdout);
    assert.deepEqual(projection(ids.remediation), {
      authority: 'private.user_age_eligibility', state: 'remediation_required', evaluated: true,
      birth_date_present: false, remediation_required: true, policy_version: 'nelyon-age-v2', minimum_age: 13,
    });
    assert.equal(projection(ids.complete).state, 'complete');
    assert.equal(projection(ids.complete).birth_date_present, true);
    assert.equal(projection(ids.unknown).state, 'unavailable');
    assert.equal(projection(ids.unknown).evaluated, false);
    assert.equal(projection(ids.ineligible).state, 'ineligible');
    assert.equal(projection(ids.absent).state, 'unavailable');
    assert.equal(Object.hasOwn(projection(ids.complete), 'birth_date'), false);

    assert.equal(psql(db, `select concat_ws('|',
      has_function_privilege('anon','public.get_my_age_eligibility_status_v2()','execute'),
      has_function_privilege('authenticated','public.get_my_age_eligibility_status_v2()','execute'),
      has_function_privilege('service_role','public.get_my_age_eligibility_status_v2()','execute'));
    `).stdout, 'f|t|f');
    assert.notEqual(asRole(db, 'anon', null, 'select public.get_my_age_eligibility_status_v2()', { allowFailure: true }).status, 0);
  } finally {
    dropDatabase(db);
  }
});

test('the existing remediation authority fills only matching legacy evidence and stays idempotent', { skip: !enabled }, () => {
  const db = createDatabase();
  const matching = '10000000-0000-4000-8000-000000000111';
  const conflict = '10000000-0000-4000-8000-000000000112';
  try {
    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id) values ('${matching}'),('${conflict}');
      insert into public.user_profiles(id) values ('${matching}'),('${conflict}');
      insert into private.user_age_eligibility(
        user_id,status,age_band,minimum_age,policy_version,evaluated_at,source,birth_date
      ) values
        ('${matching}','eligible','age_18_plus',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata',null),
        ('${conflict}','eligible','age_18_plus',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata',null);
      set session_replication_role=origin;
    `);
    const adultDob = psql(db, "select ((current_date-interval '25 years')::date)::text").stdout;
    const teenDob = psql(db, "select ((current_date-interval '15 years')::date)::text").stdout;
    const under13Dob = psql(db, "select ((current_date-interval '10 years')::date)::text").stdout;

    assert.equal(asRole(db, 'authenticated', matching, `select public.remediate_my_age_eligibility('${adultDob}') is not null`).stdout, 't');
    assert.equal(asRole(db, 'authenticated', matching, `select public.remediate_my_age_eligibility('${adultDob}') is not null`).stdout, 't');
    assert.equal(psql(db, `select birth_date is not null from private.user_age_eligibility where user_id='${matching}'`).stdout, 't');
    assert.equal(JSON.parse(asRole(db, 'authenticated', matching, 'select public.get_my_age_eligibility_status_v2()::text').stdout).state, 'complete');

    for (const input of [teenDob, under13Dob, 'bad-date', '2999-01-01']) {
      assert.notEqual(asRole(db, 'authenticated', conflict, `select public.remediate_my_age_eligibility('${input}')`, { allowFailure: true }).status, 0);
    }
    assert.equal(psql(db, `select birth_date is null from private.user_age_eligibility where user_id='${conflict}'`).stdout, 't');
  } finally {
    dropDatabase(db);
  }
});

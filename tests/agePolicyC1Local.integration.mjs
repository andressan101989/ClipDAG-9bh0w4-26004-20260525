// Run only against an isolated Supabase local stack containing B1, B2 and C1.
// NELYON_C1_LOCAL=1 and local-only URL/keys are supplied by the test command.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

const enabled = process.env.NELYON_C1_LOCAL === '1';
const container = 'supabase_db_Nelyon-c1-local-harness';
const db = (query) => execFileSync('docker', [
  'exec', container, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-At', '-c', query,
], { encoding: 'utf8' }).trim();
const email = () => `c1-${randomUUID()}@example.test`;

test('local Auth honors 13+ signup, classifies 18+ separately and rolls back trigger failure', { skip: !enabled }, async () => {
  const url = process.env.NELYON_C1_LOCAL_URL;
  const anonKey = process.env.NELYON_C1_LOCAL_ANON_KEY;
  const serviceKey = process.env.NELYON_C1_LOCAL_SERVICE_KEY;
  assert.ok(url?.startsWith('http://127.0.0.1:'));
  assert.ok(anonKey && serviceKey);
  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = [];
  let failureTriggerInstalled = false;
  const row = (id) => db(`select status || '|' || age_band || '|' || policy_version from private.user_age_eligibility where user_id = '${id}'::uuid`);
  const helpers = (id) => db(`begin; set local request.jwt.claim.sub = '${id}'; select private.current_user_is_age_eligible()::text || '|' || private.current_user_is_creator_exclusive_age_eligible()::text; rollback;`).split('\n').find((line) => /^[a-z]+\|[a-z]+$/.test(line));
  const signup = async (dob) => {
    const address = email();
    const options = dob === undefined ? { data: {} } : { data: { date_of_birth: dob } };
    const result = await auth.auth.signUp({ email: address, password: 'Fictitious-C1-Password-2026!', options });
    if (result.data.user && !result.error) created.push(result.data.user.id);
    return { ...result, address };
  };

  try {
    assert.equal(db("select minimum_age || '|' || creator_exclusive_minimum_age || '|' || policy_version from private.age_eligibility_policy"), '13|18|nelyon-age-v2');
    assert.equal(db("select private.age_classify_dob('2013-09-21', '2026-09-20')"), 'under_13');
    assert.equal(db("select private.age_classify_dob('2013-09-20', '2026-09-20')"), 'age_13_17');
    assert.equal(db("select private.age_classify_dob('2008-09-21', '2026-09-20')"), 'age_13_17');
    assert.equal(db("select private.age_classify_dob('2008-09-20', '2026-09-20')"), 'age_18_plus');
    assert.equal(db("select private.age_classify_dob('2012-02-29', '2025-02-28')"), 'under_13');
    assert.equal(db("select private.age_classify_dob('2012-02-29', '2025-03-01')"), 'age_13_17');
    assert.equal(db("select private.age_classify_dob('2008-02-29', '2026-02-28')"), 'age_13_17');
    assert.equal(db("select private.age_classify_dob('2008-02-29', '2026-03-01')"), 'age_18_plus');
    assert.equal(db("select private.age_evaluate_dob('2013-09-20', '2026-09-20')"), 'eligible');
    assert.equal(db("select private.age_evaluate_dob('2013-09-21', '2026-09-20')"), 'ineligible');
    for (const dob of [undefined, 'bad-date', '2999-01-01', '2018-01-01']) {
      const result = await signup(dob);
      assert.ok(result.error, `rejected DOB ${dob ?? 'missing'}`);
      assert.equal(result.data.session, null);
      assert.equal(db(`select count(*) from auth.users where email = '${result.address}'`), '0');
    }

    const today = new Date().toISOString().slice(0, 10);
    const yearsAgo = (years, daysAfter = 0) => {
      const value = new Date(`${today}T12:00:00Z`);
      value.setUTCFullYear(value.getUTCFullYear() - years);
      value.setUTCDate(value.getUTCDate() + daysAfter);
      return value.toISOString().slice(0, 10);
    };
    let retryTarget;
    for (const [dob, band, creatorAge] of [
      [yearsAgo(13), 'age_13_17', 'false'],
      [yearsAgo(15), 'age_13_17', 'false'],
      [yearsAgo(17), 'age_13_17', 'false'],
      [yearsAgo(18), 'age_18_plus', 'true'],
      [yearsAgo(19), 'age_18_plus', 'true'],
    ]) {
      const result = await signup(dob);
      assert.equal(result.error, null);
      assert.ok(result.data.user?.id);
      assert.ok(result.data.session?.access_token);
      assert.equal(row(result.data.user.id), `eligible|${band}|nelyon-age-v2`);
      assert.equal(helpers(result.data.user.id), `true|${creatorAge}`);
      const tokenResult = await auth.auth.getUser(result.data.session.access_token);
      assert.equal(tokenResult.error, null);
      if (!retryTarget) retryTarget = { address: result.address, id: result.data.user.id, dob };
    }
    await auth.auth.signUp({ email: retryTarget.address, password: 'Fictitious-C1-Password-2026!', options: { data: { date_of_birth: retryTarget.dob } } });
    assert.equal(db(`select count(*) from auth.users where email = '${retryTarget.address}'`), '1');
    assert.equal(row(retryTarget.id), 'eligible|age_13_17|nelyon-age-v2');
    const dayBefore13 = await signup(yearsAgo(13, 1));
    assert.ok(dayBefore13.error);
    assert.equal(dayBefore13.data.session, null);

    for (const [dob, expected] of [
      [yearsAgo(12), 'ineligible|under_13|nelyon-age-v2'],
      [yearsAgo(16), 'eligible|age_13_17|nelyon-age-v2'],
      [yearsAgo(20), 'eligible|age_18_plus|nelyon-age-v2'],
      [undefined, 'unknown_legacy|unknown_legacy|nelyon-age-v2'],
      ['bad-date', 'unknown_legacy|unknown_legacy|nelyon-age-v2'],
    ]) {
      const result = await admin.auth.admin.createUser({
        email: email(), email_confirm: true,
        user_metadata: dob === undefined ? {} : { date_of_birth: dob },
      });
      assert.equal(result.error, null);
      const id = result.data.user.id;
      created.push(id);
      assert.equal(row(id), expected);
      assert.equal(helpers(id), expected.includes('age_18_plus') ? 'true|true' : expected.startsWith('eligible|') ? 'true|false' : 'false|false');
    }

    const legacy = created.at(-1);
    db(`delete from private.user_age_eligibility where user_id = '${legacy}'::uuid`);
    assert.equal(helpers(legacy), 'false|false');

    const otpAddress = email();
    const otp = await auth.auth.signInWithOtp({ email: otpAddress, options: { shouldCreateUser: false } });
    assert.ok(otp.error);
    assert.equal(db(`select count(*) from auth.users where email = '${otpAddress}'`), '0');

    db("create function private.c1_test_fail_materialization() returns trigger language plpgsql as $$ begin raise exception 'c1_test_failure'; end; $$; create trigger zzz_c1_test_fail after insert on auth.users for each row execute function private.c1_test_fail_materialization();");
    failureTriggerInstalled = true;
    const failed = await signup(yearsAgo(20));
    assert.ok(failed.error);
    assert.equal(failed.data.session, null);
    assert.equal(db(`select count(*) from auth.users where email = '${failed.address}'`), '0');
    assert.equal(db("select count(*) from private.user_age_eligibility e join auth.users u on u.id=e.user_id where u.email = '" + failed.address + "'"), '0');
  } finally {
    if (failureTriggerInstalled) db('drop trigger zzz_c1_test_fail on auth.users; drop function private.c1_test_fail_materialization();');
    for (const id of created) {
      const result = await admin.auth.admin.deleteUser(id);
      assert.equal(result.error, null);
    }
  }
});

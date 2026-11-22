import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repository = resolve(import.meta.dirname, '..');
const image = 'public.ecr.aws/supabase/postgres:17.6.1.143';
const container = `nelyon-b2-r5-c1-pgcron-${process.pid}-${randomUUID().slice(0, 8)}`;
const migration = readFileSync(resolve(repository, 'supabase/migrations/20261108061946_web_control_centers_b2_scheduled_publishing.sql'), 'utf8');
const activation = migration.match(/do \$activation\$[\s\S]*?\$activation\$;/i)?.[0];
assert.ok(activation, 'B2 cron activation block must remain extractable');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 45_000,
    input: options.input,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!options.allowFailure) {
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result;
};

const docker = (args, options) => run('docker', args, options);
const psql = (source, options = {}) => docker([
  'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
], { ...options, input: source });
const psqlAs = (role, source, options = {}) => docker([
  'exec', '-i', container, 'psql', '-X', '-qAt', '-U', role, '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
], { ...options, input: source });
const scalar = source => psql(source).stdout.trim().split(/\r?\n/).at(-1);
const asRole = (role, source, options = {}) => psql(`set role ${role};\n${source}\nreset role;`, options);
const canonicalShape = () => scalar("select count(*)||':'||min(schedule)||':'||min(command)||':'||min(database)||':'||min(username)||':'||bool_and(active) from cron.job where jobname='process-scheduled-publications-b2'");
const expectedCanonicalShape = '1:* * * * *:select public.wake_scheduled_publications_b2_v1():postgres:postgres:true';

let started = false;
let checks = 0;
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  checks += 1;
};

try {
  docker([
    'run', '--pull=never', '--network', 'none', '--name', container,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-d', image,
    '-c', 'shared_preload_libraries=pg_cron', '-c', 'cron.database_name=postgres',
    '-c', 'cron.launch_active_jobs=off',
  ]);
  started = true;

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const health = docker(['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', container], { allowFailure: true });
    if (health.status === 0 && health.stdout.trim() === 'healthy') break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  equal(docker(['inspect', '--format', '{{.State.Health.Status}}', container]).stdout.trim(), 'healthy', 'disposable Supabase Postgres must become healthy');

  psql(`
    create extension if not exists pg_cron;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='other_scheduler') then
        create role other_scheduler login;
      end if;
      if not exists(select 1 from pg_roles where rolname='cli_login_fixture') then
        create role cli_login_fixture login in role postgres;
      end if;
    end $$;
    alter role cli_login_fixture set role to postgres;
    grant usage on schema cron to postgres,other_scheduler;
    grant execute on all functions in schema cron to postgres,other_scheduler;
    grant select,update on cron.job to postgres;
  `);
  equal(scalar("select extversion from pg_extension where extname='pg_cron'"), '1.6.4', 'proof must use real pg_cron 1.6.4');
  equal(scalar("select rolsuper::text||':'||rolbypassrls::text from pg_roles where rolname='postgres'"), 'false:true', 'hosted-equivalent postgres must be NOSUPERUSER BYPASSRLS');
  equal(psqlAs('cli_login_fixture', "select session_user||':'||current_user||':'||pg_has_role(session_user,'postgres','MEMBER')").stdout.trim(),
    'cli_login_fixture:postgres:true', 'temporary CLI login must enter the hosted-equivalent postgres role without superuser');

  psqlAs('cli_login_fixture', activation);
  const firstId = scalar("select jobid from cron.job where jobname='process-scheduled-publications-b2'");
  equal(canonicalShape(), expectedCanonicalShape,
    'fresh activation must create the exact canonical job');

  asRole('postgres', `select cron.alter_job(${firstId},schedule:='0 0 * * *',command:='select false',database:='template1',active:=false);`);
  const unrelatedId = scalar("set role postgres; select cron.schedule('b2-r5-c1-unrelated','15 3 * * *','select 42'); reset role;");
  const unrelatedBefore = scalar(`select row_to_json(j)::text from cron.job j where jobid=${unrelatedId}`);
  psqlAs('cli_login_fixture', activation);
  equal(scalar("select jobid from cron.job where jobname='process-scheduled-publications-b2'"), firstId, 'reconciliation must preserve the canonical job id');
  equal(canonicalShape(), expectedCanonicalShape, 'reconciliation must restore the exact canonical row');
  equal(scalar(`select row_to_json(j)::text from cron.job j where jobid=${unrelatedId}`), unrelatedBefore, 'reconciliation must preserve unrelated jobs byte-for-byte');
  psqlAs('cli_login_fixture', activation);
  equal(scalar("select jobid from cron.job where jobname='process-scheduled-publications-b2'"), firstId, 'replay must remain idempotent');
  equal(canonicalShape(), expectedCanonicalShape, 'replay must preserve the exact canonical row');

  asRole('postgres', `select cron.unschedule(${firstId});`);
  const wrongExecutor = psqlAs('other_scheduler', activation, { allowFailure: true });
  assert.notEqual(wrongExecutor.status, 0, 'a non-postgres effective executor must be rejected');
  assert.match(wrongExecutor.stderr, /publication_scheduler_executor_invalid/);
  equal(scalar("select count(*) from cron.job where jobname='process-scheduled-publications-b2'"), '0', 'wrong executor rejection must not create a job');
  const foreignId = scalar("set role other_scheduler; select cron.schedule('process-scheduled-publications-b2','7 7 * * *','select 7'); reset role;");
  const foreignBefore = scalar(`select row_to_json(j)::text from cron.job j where jobid=${foreignId}`);
  const foreign = asRole('postgres', activation, { allowFailure: true });
  assert.notEqual(foreign.status, 0, 'foreign owner must be rejected');
  assert.match(foreign.stderr, /publication_scheduler_unexpected_owner/);
  equal(scalar(`select row_to_json(j)::text from cron.job j where jobid=${foreignId}`), foreignBefore, 'foreign-owned job must remain unchanged');

  const duplicateId = scalar("set role postgres; select cron.schedule('process-scheduled-publications-b2','8 8 * * *','select 8'); reset role;");
  const duplicateBefore = scalar("select json_agg(row_to_json(j) order by jobid)::text from cron.job j where jobname='process-scheduled-publications-b2'");
  const duplicate = asRole('postgres', activation, { allowFailure: true });
  assert.notEqual(duplicate.status, 0, 'duplicate canonical names must be rejected');
  assert.match(duplicate.stderr, /publication_scheduler_duplicate_job/);
  equal(scalar("select count(*) from cron.job where jobname='process-scheduled-publications-b2'"), '2', 'duplicate rejection must preserve both pre-existing jobs');
  equal(scalar("select json_agg(row_to_json(j) order by jobid)::text from cron.job j where jobname='process-scheduled-publications-b2'"), duplicateBefore,
    'duplicate rejection must preserve both pre-existing rows byte-for-byte');
  assert.ok(Number(duplicateId) > 0);
  checks += 5;

  console.log(`B2_REAL_PG_CRON_PASS ${JSON.stringify({ image, pgCron: '1.6.4', role: 'postgres:NOSUPERUSER:BYPASSRLS', checks })}`);
} finally {
  if (started) {
    const removed = docker(['rm', '-f', '-v', container], { allowFailure: true, timeout: 30_000 });
    assert.equal(removed.status, 0, `disposable cleanup failed\n${removed.stderr ?? ''}`);
  }
}

// Real disposable PostgreSQL proof. Set NELYON_PREMIUM_B1_LOCAL=1 to enable it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_PREMIUM_B1_LOCAL === '1';
const container = process.env.NELYON_PREMIUM_B1_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_PREMIUM_B1_TEMPLATE ?? 'algo6_final_compile_a2';
const wslNamespacePid = process.env.NELYON_PREMIUM_B1_WSL_PID ?? '';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b1_canonical_foundation.sql'));
const migration = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : '';

function runContainer(command, { input, allowFailure = false } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  const result = spawnSync(executable, args, {
    encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${executable} disposable command failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function psql(db, sql, options = {}) {
  assert.match(db, /^[a-z0-9_]+$/);
  return runContainer(
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`,
    { input: sql, ...options },
  );
}

function asRole(db, role, actor, sql, options = {}) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return psql(db, `begin;${subject}set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`, options);
}

function expectFailure(result, message) {
  assert.notEqual(result.status, 0, `expected failure: ${message}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message));
}

test('B1 disposable harness targets exactly one generated migration', () => {
  assert.equal(matches.length, 1);
  assert.match(matches[0], /^\d{14}_creator_premium_b1_canonical_foundation\.sql$/);
  assert.ok(migration.length > 10_000);
});

test('B1 compiles and proves security, lifecycle, entitlement, and safe catalog contracts', {
  skip: !enabled,
  timeout: 180_000,
}, () => {
  const db = `premium_b1_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ids = {
    creator: '91000000-0000-4000-8000-000000000001',
    buyer: '91000000-0000-4000-8000-000000000002',
    other: '91000000-0000-4000-8000-000000000003',
    minor: '91000000-0000-4000-8000-000000000004',
    purchaseContent: '92000000-0000-4000-8000-000000000001',
    subscriptionContent: '92000000-0000-4000-8000-000000000002',
    draftContent: '92000000-0000-4000-8000-000000000003',
    reviewContent: '92000000-0000-4000-8000-000000000004',
    quarantinedContent: '92000000-0000-4000-8000-000000000005',
    removedContent: '92000000-0000-4000-8000-000000000006',
    deletedContent: '92000000-0000-4000-8000-000000000007',
    offer: '93000000-0000-4000-8000-000000000001',
    purchaseTransaction: '94000000-0000-4000-8000-000000000001',
    subscriptionTransaction: '94000000-0000-4000-8000-000000000002',
    receipt: '95000000-0000-4000-8000-000000000001',
    plan: '96000000-0000-4000-8000-000000000001',
    subscription: '97000000-0000-4000-8000-000000000001',
    period: '98000000-0000-4000-8000-000000000001',
  };

  try {
    runContainer(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, migration);

    const tableNames = [
      'creator_premium_contents',
      'creator_premium_offer_versions',
      'creator_premium_plans',
      'creator_premium_plan_contents',
      'creator_premium_purchase_receipts',
      'creator_premium_subscriptions',
      'creator_premium_subscription_periods',
    ];
    const tableList = tableNames.map(name => `'${name}'`).join(',');
    assert.equal(psql(db, `
      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname in (${tableList})
        and c.relrowsecurity and c.relforcerowsecurity;
    `).stdout, '7');
    assert.equal(psql(db, `
      select count(*) from information_schema.role_table_grants
      where table_schema='private' and table_name in (${tableList})
        and grantee in ('PUBLIC','anon','authenticated','service_role');
    `).stdout, '0');
    assert.equal(psql(db, `
      select count(*) from information_schema.columns
      where table_schema='private' and table_name in (${tableList})
        and column_name in ('content_url','preview_url','object_key','bucket_name','hls_url','dash_url','cloudflare_uid');
    `).stdout, '0');
    assert.equal(psql(db, `
      select coalesce(string_agg(constraint_row.conname,',' order by constraint_row.conname),'')
      from (
        select constraint_def.conname
        from pg_constraint constraint_def
        join pg_class table_def on table_def.oid=constraint_def.conrelid
        join pg_namespace namespace_def on namespace_def.oid=table_def.relnamespace
        where constraint_def.contype='f'
          and namespace_def.nspname='private'
          and table_def.relname like 'creator_premium_%'
          and not exists (
            select 1
            from pg_index index_def
            where index_def.indrelid=constraint_def.conrelid
              and index_def.indisvalid and index_def.indisready
              and (
                select array_agg(index_column.attnum::smallint order by index_column.ordinality)
                from unnest(index_def.indkey) with ordinality index_column(attnum,ordinality)
                where index_column.ordinality <= cardinality(constraint_def.conkey)
              ) = constraint_def.conkey
          )
      ) constraint_row;
    `).stdout, '', 'every B1 foreign key must have a covering leading index');

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${ids.creator}',false),('${ids.buyer}',false),('${ids.other}',false),('${ids.minor}',false);
      insert into public.user_profiles(id,username) values
        ('${ids.creator}','premium_creator'),('${ids.buyer}','premium_buyer'),
        ('${ids.other}','premium_other'),('${ids.minor}','premium_minor');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      ) values
        ('${ids.creator}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'),
        ('${ids.buyer}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '25 years'),
        ('${ids.other}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '24 years'),
        ('${ids.minor}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_13_17',current_date-interval '16 years');
      set session_replication_role=origin;
    `);

    expectFailure(
      asRole(db, 'anon', null, `select * from public.get_creator_premium_catalog_v1('${ids.creator}',24,null,null)`, { allowFailure: true }),
      'permission denied|creator_premium_auth_required',
    );
    expectFailure(
      asRole(db, 'authenticated', ids.buyer, 'select * from private.creator_premium_contents', { allowFailure: true }),
      'permission denied',
    );
    expectFailure(
      asRole(db, 'authenticated', ids.buyer, `insert into private.creator_premium_contents(creator_id,title,content_kind,access_mode) values('${ids.buyer}','Forged','image','purchase')`, { allowFailure: true }),
      'permission denied',
    );
    expectFailure(
      asRole(db, 'authenticated', ids.buyer, `insert into private.creator_premium_purchase_receipts(id,buyer_id,creator_id,content_id,offer_version_id,financial_transaction_id,idempotency_key) values(gen_random_uuid(),'${ids.buyer}','${ids.creator}',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())`, { allowFailure: true }),
      'permission denied',
    );
    expectFailure(
      asRole(db, 'authenticated', ids.buyer, `insert into private.creator_premium_subscriptions(subscriber_id,creator_id,plan_id,idempotency_key) values('${ids.buyer}','${ids.creator}',gen_random_uuid(),gen_random_uuid())`, { allowFailure: true }),
      'permission denied',
    );
    expectFailure(
      asRole(db, 'authenticated', ids.minor, `select * from public.create_my_creator_premium_draft_v1('Minor draft','','image','purchase',gen_random_uuid())`, { allowFailure: true }),
      'creator_premium_age_eligibility_required',
    );

    const requestId = '99000000-0000-4000-8000-000000000001';
    const draft = asRole(db, 'authenticated', ids.creator, `
      select id,created,lifecycle_status from public.create_my_creator_premium_draft_v1(
        'Canonical draft','B1 metadata only','image','purchase','${requestId}'
      );
    `).stdout.split('|');
    assert.equal(draft[1], 't');
    assert.equal(draft[2], 'draft');
    assert.equal(psql(db, `select creator_id from private.creator_premium_contents where id='${draft[0]}'`).stdout, ids.creator);
    assert.equal(asRole(db, 'authenticated', ids.creator, `
      select created from public.create_my_creator_premium_draft_v1(
        'Canonical draft','B1 metadata only','image','purchase','${requestId}'
      );
    `).stdout, 'f');
    expectFailure(
      asRole(db, 'authenticated', ids.buyer, `select * from public.update_my_creator_premium_draft_v1('${draft[0]}','Forged','','image','purchase')`, { allowFailure: true }),
      'creator_premium_content_not_found',
    );
    assert.equal(asRole(db, 'authenticated', ids.creator, `select allowed,source from public.get_my_creator_premium_entitlement_v1('${draft[0]}')`).stdout, 't|owner');

    psql(db, `
      set session_replication_role=replica;
      insert into private.creator_premium_contents(
        id,creator_id,title,description,content_kind,access_mode,lifecycle_status,published_at,quarantined_at,removed_at,deleted_at
      ) values
        ('${ids.purchaseContent}','${ids.creator}','Purchase item','Safe metadata','image','purchase','published',clock_timestamp()-interval '1 hour',null,null,null),
        ('${ids.subscriptionContent}','${ids.creator}','Subscription item','Safe metadata','video','subscription','published',clock_timestamp()-interval '2 hours',null,null,null),
        ('${ids.draftContent}','${ids.creator}','Hidden draft','','image','purchase','draft',null,null,null,null),
        ('${ids.reviewContent}','${ids.creator}','Hidden review','','image','purchase','pending_review',null,null,null,null),
        ('${ids.quarantinedContent}','${ids.creator}','Hidden quarantine','','image','purchase','quarantined',null,clock_timestamp(),null,null),
        ('${ids.removedContent}','${ids.creator}','Hidden removed','','image','purchase','removed',null,null,clock_timestamp(),null),
        ('${ids.deletedContent}','${ids.creator}','Hidden deleted','','image','purchase','deleted',null,null,null,clock_timestamp());
      insert into private.creator_premium_offer_versions(
        id,content_id,creator_id,version,price_bdag,status,activated_at
      ) values ('${ids.offer}','${ids.purchaseContent}','${ids.creator}',1,10,'active',clock_timestamp()-interval '1 day');
      insert into private.creator_premium_plans(
        id,creator_id,plan_key,version,name,price_bdag,status,activated_at
      ) values ('${ids.plan}','${ids.creator}','founding',1,'Founding',5,'active',clock_timestamp()-interval '1 day');
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values ('${ids.plan}','${ids.subscriptionContent}','${ids.creator}');
      insert into public.financial_transactions(
        id,operation_type,amount,currency,status,idempotency_key,initiated_by
      ) values
        ('${ids.purchaseTransaction}','premium_fixture',10,'BDAG','completed','premium-b1-purchase','${ids.buyer}'),
        ('${ids.subscriptionTransaction}','premium_fixture',5,'BDAG','completed','premium-b1-subscription','${ids.buyer}');
      insert into private.creator_premium_purchase_receipts(
        id,buyer_id,creator_id,content_id,offer_version_id,financial_transaction_id,idempotency_key,
        access_state,activated_at
      ) values (
        '${ids.receipt}','${ids.buyer}','${ids.creator}','${ids.purchaseContent}','${ids.offer}',
        '${ids.purchaseTransaction}','99000000-0000-4000-8000-000000000011','active',clock_timestamp()-interval '1 hour'
      );
      insert into private.creator_premium_subscriptions(
        id,subscriber_id,creator_id,plan_id,idempotency_key,status,started_at
      ) values (
        '${ids.subscription}','${ids.buyer}','${ids.creator}','${ids.plan}',
        '99000000-0000-4000-8000-000000000012','active',clock_timestamp()-interval '2 days'
      );
      insert into private.creator_premium_subscription_periods(
        id,subscription_id,subscriber_id,creator_id,plan_id,starts_at,paid_through_at,
        financial_transaction_id,access_state
      ) values (
        '${ids.period}','${ids.subscription}','${ids.buyer}','${ids.creator}','${ids.plan}',
        clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 day',
        '${ids.subscriptionTransaction}','active'
      );
      set session_replication_role=origin;
    `);

    const financeCount = psql(db, "select count(*) from public.financial_transactions where operation_type='premium_fixture'").stdout;
    assert.equal(asRole(db, 'authenticated', ids.other, `select allowed,source,reason from public.get_my_creator_premium_entitlement_v1('${ids.purchaseContent}')`).stdout, 'f|none|not_entitled');
    assert.equal(asRole(db, 'authenticated', ids.buyer, `select allowed,source,reason from public.get_my_creator_premium_entitlement_v1('${ids.purchaseContent}')`).stdout, 't|purchase|active_purchase');
    assert.match(asRole(db, 'authenticated', ids.buyer, `select allowed,source,reason,expires_at is not null from public.get_my_creator_premium_entitlement_v1('${ids.subscriptionContent}')`).stdout, /^t\|subscription\|active_subscription_period\|t$/);

    psql(db, `update private.creator_premium_purchase_receipts set activated_at=clock_timestamp()-interval '2 days',access_expires_at=clock_timestamp()-interval '1 day' where id='${ids.receipt}'`);
    assert.equal(asRole(db, 'authenticated', ids.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${ids.purchaseContent}')`).stdout, 'f');
    psql(db, `update private.creator_premium_purchase_receipts set activated_at=clock_timestamp()-interval '1 hour',access_expires_at=null,access_state='revoked',revoked_at=clock_timestamp() where id='${ids.receipt}'`);
    assert.equal(asRole(db, 'authenticated', ids.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${ids.purchaseContent}')`).stdout, 'f');
    psql(db, `update private.creator_premium_purchase_receipts set access_state='active',revoked_at=null where id='${ids.receipt}'`);

    psql(db, `update private.creator_premium_subscription_periods set paid_through_at=clock_timestamp()-interval '1 day' where id='${ids.period}'`);
    assert.equal(asRole(db, 'authenticated', ids.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${ids.subscriptionContent}')`).stdout, 'f');
    psql(db, `update private.creator_premium_subscription_periods set paid_through_at=clock_timestamp()+interval '1 day',access_state='revoked',revoked_at=clock_timestamp() where id='${ids.period}'`);
    assert.equal(asRole(db, 'authenticated', ids.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${ids.subscriptionContent}')`).stdout, 'f');
    psql(db, `update private.creator_premium_subscription_periods set access_state='active',revoked_at=null where id='${ids.period}'`);

    psql(db, `insert into public.blocked_users(blocker_id,blocked_id) values('${ids.creator}','${ids.buyer}')`);
    assert.equal(asRole(db, 'authenticated', ids.buyer, `select reason from public.get_my_creator_premium_entitlement_v1('${ids.purchaseContent}')`).stdout, 'blocked_relationship');
    psql(db, `delete from public.blocked_users where blocker_id='${ids.creator}' and blocked_id='${ids.buyer}'`);

    for (const [state, timestamp] of [
      ['quarantined', 'quarantined_at'], ['removed', 'removed_at'], ['deleted', 'deleted_at'],
    ]) {
      psql(db, `update private.creator_premium_contents set lifecycle_status='${state}',${timestamp}=clock_timestamp() where id='${ids.purchaseContent}'`);
      assert.equal(asRole(db, 'authenticated', ids.buyer, `select reason from public.get_my_creator_premium_entitlement_v1('${ids.purchaseContent}')`).stdout, 'content_unavailable');
      psql(db, `update private.creator_premium_contents set lifecycle_status='published',quarantined_at=null,removed_at=null,deleted_at=null where id='${ids.purchaseContent}'`);
    }
    psql(db, `update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${ids.creator}'`);
    assert.equal(asRole(db, 'authenticated', ids.buyer, `select reason from public.get_my_creator_premium_entitlement_v1('${ids.purchaseContent}')`).stdout, 'creator_account_restricted');
    psql(db, `update auth.users set banned_until=null where id='${ids.creator}'`);

    const catalog = JSON.parse(asRole(db, 'authenticated', ids.buyer, `
      select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb)
      from public.get_creator_premium_catalog_v1('${ids.creator}',24,null,null) item;
    `).stdout);
    assert.equal(catalog.length, 2);
    for (const item of catalog) {
      for (const forbidden of [
        'object_key','bucket_name','content_url','preview_url','hls_url','dash_url',
        'cloudflare_uid','financial_transaction_id','offer_version_id',
      ]) assert.equal(Object.hasOwn(item, forbidden), false, forbidden);
    }
    const firstPage = JSON.parse(asRole(db, 'authenticated', ids.buyer, `
      select to_jsonb(item) from public.get_creator_premium_catalog_v1('${ids.creator}',1,null,null) item;
    `).stdout);
    const secondPage = JSON.parse(asRole(db, 'authenticated', ids.buyer, `
      select to_jsonb(item) from public.get_creator_premium_catalog_v1(
        '${ids.creator}',1,'${firstPage.published_at}','${firstPage.id}'
      ) item;
    `).stdout);
    assert.notEqual(firstPage.id, secondPage.id);
    expectFailure(
      asRole(db, 'authenticated', ids.buyer, `select * from public.get_creator_premium_catalog_v1('${ids.creator}',0,null,null)`, { allowFailure: true }),
      'creator_premium_invalid_limit',
    );
    expectFailure(
      asRole(db, 'authenticated', ids.minor, `select * from public.get_creator_premium_catalog_v1('${ids.creator}',24,null,null)`, { allowFailure: true }),
      'creator_premium_age_eligibility_required',
    );

    assert.equal(psql(db, `
      select concat_ws('|',
        has_function_privilege('public','public.cancel_unpublished_exclusive_content(uuid)','execute'),
        has_function_privilege('anon','public.cancel_unpublished_exclusive_content(uuid)','execute'),
        has_function_privilege('authenticated','public.cancel_unpublished_exclusive_content(uuid)','execute'),
        has_function_privilege('service_role','public.cancel_unpublished_exclusive_content(uuid)','execute'));
    `).stdout, 'f|f|f|t');
    assert.equal(psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%creator_premium%' and p.proname ~ '(publish|purchase|subscribe|refund|renew|payout)'`).stdout, '0');
    assert.equal(psql(db, "select count(*) from public.financial_transactions where operation_type='premium_fixture'").stdout, financeCount);
  } finally {
    runContainer(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});

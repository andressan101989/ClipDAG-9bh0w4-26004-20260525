// Real disposable PostgreSQL proof. Set RUN_ADMIN_CONTENT_SAFETY_P3_C1_LOCAL=1 to enable it.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_ADMIN_CONTENT_SAFETY_P3_C1_LOCAL === '1'
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile'
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'algo6_final_compile_a2'
const migrations = new URL('../supabase/migrations/', import.meta.url)
const prerequisiteSuffixes = [
  '_creator_premium_b1_canonical_foundation.sql',
  '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql',
  '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql',
  '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql',
  '_creator_premium_c1_submission_cancellation.sql',
  '_creator_premium_c3_visual_retry_producer.sql',
  '_creator_premium_content_safety_p1_policy_gate.sql',
  '_creator_premium_content_safety_p2_evidence_runtime.sql',
  '_creator_premium_content_safety_p2_activation.sql',
  '_creator_premium_qa_final_f1.sql',
  '_creator_premium_f1_c4_final_recovery.sql',
  '_creator_premium_f1_c6_submit_unavailable_mapping_recovery.sql',
  '_creator_premium_content_safety_p3_contextual_violence_policy_v2.sql',
]
const correctiveSuffix = '_content_safety_p3_c1_admin_alerts_sql_recovery.sql'

function migration(suffix) {
  const found = readdirSync(migrations).filter((name) => name.endsWith(suffix))
  assert.equal(found.length, 1, suffix)
  return readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8')
}

function docker(command, { input = '', allowFailure = false } = {}) {
  const result = spawnSync('docker', ['exec', '-i', container, '/bin/sh', '-c', command], {
    encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024,
  })
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker command failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

function psql(db, sql, { allowFailure = false } = {}) {
  assert.match(db, /^[a-z0-9_]+$/)
  return docker(
    `psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U supabase_admin -d ${db} -At -F '|'`,
    { input: sql, allowFailure },
  )
}

function asActor(db, actor, role, sql, { allowFailure = false } = {}) {
  return psql(db, `
    begin;
    set local request.jwt.claim.role='${role}';
    set local request.jwt.claim.sub='${actor ?? ''}';
    set local role ${role};
    ${sql}
    commit;
  `, { allowFailure })
}

function quote(value) {
  return String(value).replaceAll("'", "''")
}

function searchSql({
  severity = null, status = null, category = null, target = null, source = null,
  coverage = null, cursor = null, limit = 50,
} = {}) {
  const text = (value) => value === null ? 'null' : `'${quote(value)}'`
  const cursorPriority = cursor ? String(cursor.priority_score) : 'null'
  const cursorCreatedAt = cursor ? `'${quote(cursor.created_at)}'::timestamptz` : 'null'
  const cursorId = cursor ? `'${quote(cursor.id)}'::uuid` : 'null'
  return `select public.search_admin_content_safety_alerts(
    ${text(severity)},${text(status)},${text(category)},${text(target)},${text(source)},${text(coverage)},
    ${cursorPriority},${cursorCreatedAt},${cursorId},${limit}
  );`
}

test('P3-C1 disposable harness binds the current Premium chain and one corrective migration', () => {
  for (const suffix of prerequisiteSuffixes) migration(suffix)
  migration(correctiveSuffix)
})

test('P3-C1 reproduces 42883 then restores authorized alerts, cursors, detail, previews and ACLs without data mutation', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `p3c1_${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const admin = randomUUID()
  const readless = randomUUID()
  const owner = randomUUID()
  const content = randomUUID()
  const scan = randomUUID()
  const firstAlert = randomUUID()
  const secondAlert = randomUUID()
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`)
    psql(db, `
      insert into private.admin_roles(
        role_code,display_name,description,is_assignable,is_root,is_exclusive
      ) values(
        'MODERATOR','Moderator','Cross-domain safety and moderation authority.',
        true,false,false
      ) on conflict(role_code) do nothing;
      insert into private.admin_capabilities(
        capability_code,domain,effect,description,is_sensitive
      ) values
        ('content.items.read','content','read','Read content administration projections.',false),
        ('content.items.moderate','content','write','Moderate content.',true)
      on conflict(capability_code) do nothing;
      insert into private.admin_role_capabilities(role_code,capability_code)
      values
        ('SUPER_ADMIN','content.items.read'),
        ('SUPER_ADMIN','content.items.moderate'),
        ('MODERATOR','content.items.read'),
        ('MODERATOR','content.items.moderate')
      on conflict(role_code,capability_code) do nothing;
    `)
    for (const suffix of prerequisiteSuffixes) psql(db, migration(suffix))
    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${admin}',false),('${readless}',false),('${owner}',false);
      insert into public.user_profiles(id,username,display_name) values
        ('${admin}','p3c1_admin','P3-C1 Admin'),
        ('${readless}','p3c1_readless','P3-C1 Readless'),
        ('${owner}','p3c1_owner','P3-C1 Owner');
      insert into private.admin_user_roles(
        user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason
      ) values
        ('${admin}','SUPER_ADMIN','trusted_operator','p3-c1-disposable','P3-C1 authorized read proof'),
        ('${readless}','FINANCE_AUDITOR','trusted_operator','p3-c1-disposable','P3-C1 negative capability proof');
      insert into private.content_safety_scans(
        id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
        text_status,audio_status,visual_status,reports_status,completed_at,created_at,updated_at
      ) values(
        '${scan}','creator_premium','${content}','${owner}','${'a'.repeat(64)}',
        'completed','retry','analyzed','not_applicable','analyzed','analyzed',clock_timestamp(),
        timestamptz '2026-10-19 12:00:00+00',timestamptz '2026-10-19 12:00:00+00'
      );
      insert into private.creator_premium_contents(
        id,creator_id,title,description,content_kind,access_mode,lifecycle_status,
        verification_scan_id,verification_fingerprint,verification_status,verification_requested_at,
        verification_completed_at,
        submitted_at,quarantined_at,review_reason
      ) values(
        '${content}','${owner}','P3-C1 synthetic content','Non-sensitive disposable fixture',
        'image','purchase','quarantined','${scan}','${'a'.repeat(64)}','restricted',clock_timestamp(),
        clock_timestamp(),
        clock_timestamp(),clock_timestamp(),'Synthetic disposable review state'
      );
      insert into private.content_safety_alerts(
        id,scan_id,target_type,target_id,owner_user_id,source_type,category,severity,
        priority_score,status,alert_fingerprint,evidence,created_at,updated_at
      ) values
        ('${firstAlert}','${scan}','creator_premium','${content}','${owner}','visual_classifier',
         'weapons','high',70,'open','${'b'.repeat(64)}',
         '{"description":"Synthetic visual evidence"}'::jsonb,
         timestamptz '2026-10-19 12:00:00+00',timestamptz '2026-10-19 12:00:00+00'),
        ('${secondAlert}','${scan}','creator_premium','${content}','${owner}','user_reports',
         'other','medium',50,'open','${'c'.repeat(64)}',
         '{"matched_text_excerpt":"Synthetic report evidence"}'::jsonb,
         timestamptz '2026-10-19 12:01:00+00',timestamptz '2026-10-19 12:01:00+00');
      set session_replication_role=origin;
    `)

    const before = psql(db, `select concat_ws('|',
      (select count(*) from private.content_safety_alerts),
      (select count(*) from private.content_safety_scans),
      (select count(*) from private.admin_action_audit),
      (select lifecycle_status from private.creator_premium_contents where id='${content}'),
      (select verification_status from private.creator_premium_contents where id='${content}')
    );`).stdout

    const redSearch = asActor(db, admin, 'authenticated', searchSql(), { allowFailure: true })
    assert.notEqual(redSearch.status, 0)
    assert.match(redSearch.stderr, /42883/)
    assert.match(redSearch.stderr, /function pg_catalog\.coalesce\(text, text\) does not exist/)
    const redPreview = asActor(db, admin, 'authenticated', `
      select public.preview_admin_content_safety_rule_draft(
        'keyword','synthetic',array['creator_premium_text'],'und',20
      );
    `, { allowFailure: true })
    assert.notEqual(redPreview.status, 0)
    assert.match(redPreview.stderr, /42883/)

    psql(db, migration(correctiveSuffix))

    const firstPage = JSON.parse(asActor(
      db, admin, 'authenticated', searchSql({ limit: 1 }),
    ).stdout)
    assert.equal(firstPage.items.length, 1)
    assert.equal(firstPage.items[0].id, firstAlert)
    assert.equal(firstPage.items[0].evidence_excerpt, 'Synthetic visual evidence')
    assert.deepEqual(firstPage.next_cursor, {
      priority_score: 70,
      created_at: '2026-10-19T12:00:00+00:00',
      id: firstAlert,
    })
    const secondPage = JSON.parse(asActor(
      db, admin, 'authenticated', searchSql({ cursor: firstPage.next_cursor, limit: 1 }),
    ).stdout)
    assert.deepEqual(secondPage.items.map((item) => item.id), [secondAlert])
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size, 2)

    const filtered = JSON.parse(asActor(db, admin, 'authenticated', searchSql({
      severity: 'high', status: 'open', category: 'weapons', target: 'creator_premium',
      source: 'visual_classifier', coverage: 'complete', limit: 10,
    })).stdout)
    assert.deepEqual(filtered.items.map((item) => item.id), [firstAlert])
    const empty = JSON.parse(asActor(
      db, admin, 'authenticated', searchSql({ category: 'no_fixture_match' }),
    ).stdout)
    assert.deepEqual(empty.items, [])

    for (const sql of [searchSql({ severity: 'invalid' }), searchSql({ limit: 0 }), searchSql({ limit: 101 })]) {
      const invalid = asActor(db, admin, 'authenticated', sql, { allowFailure: true })
      assert.notEqual(invalid.status, 0)
      assert.match(invalid.stderr, /22023/)
      assert.match(invalid.stderr, /invalid_content_safety_filter/)
    }

    const detail = JSON.parse(asActor(
      db, admin, 'authenticated',
      `select public.get_admin_content_safety_alert('${firstAlert}');`,
    ).stdout)
    assert.equal(detail.id, firstAlert)
    assert.equal(detail.content.summary, 'P3-C1 synthetic content')
    assert.deepEqual(detail.related_reports, [])
    const missing = asActor(
      db, admin, 'authenticated',
      `select public.get_admin_content_safety_alert('${randomUUID()}');`,
      { allowFailure: true },
    )
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /P0002/)

    const preview = JSON.parse(asActor(db, admin, 'authenticated', `
      select public.preview_admin_content_safety_rule_draft(
        'keyword','synthetic',array['creator_premium_text'],'und',20
      );
    `).stdout)
    assert.equal(preview.modifies_content, false)
    assert.equal(preview.private_premium_originals_included, false)
    assert.equal(preview.total_matching_content, 1)

    for (const rpc of [
      'select public.search_admin_content_safety_rules();',
      'select public.search_admin_content_safety_audio();',
      'select public.search_admin_content_safety_visual();',
    ]) assert.doesNotThrow(() => JSON.parse(asActor(db, admin, 'authenticated', rpc).stdout))

    const readlessResult = asActor(db, readless, 'authenticated', searchSql(), { allowFailure: true })
    assert.notEqual(readlessResult.status, 0)
    assert.match(readlessResult.stderr, /42501/)
    assert.match(readlessResult.stderr, /admin_capability_forbidden/)
    const unauthenticated = asActor(db, null, 'authenticated', searchSql(), { allowFailure: true })
    assert.notEqual(unauthenticated.status, 0)
    assert.match(unauthenticated.stderr, /28000/)
    assert.match(unauthenticated.stderr, /admin_auth_required/)

    assert.equal(psql(db, `select concat_ws('|',
      has_function_privilege('public','public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)','execute'),
      has_function_privilege('anon','public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)','execute'),
      has_function_privilege('authenticated','public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)','execute'),
      has_function_privilege('service_role','public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)','execute')
    );`).stdout, 'f|f|t|f')
    const anonResult = asActor(db, null, 'anon', searchSql(), { allowFailure: true })
    assert.notEqual(anonResult.status, 0)
    assert.match(anonResult.stderr, /42501/)

    assert.equal(psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname,p.proname) in(
        ('public','search_admin_content_safety_alerts'),
        ('private','preview_content_safety_rule_definition')
      ) and position('pg_catalog.coalesce' in p.prosrc)>0;`).stdout, '0')
    assert.equal(psql(db, `select string_agg(concat_ws(':',n.nspname,p.proname,
      pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,p.proconfig::text),',' order by n.nspname,p.proname)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname,p.proname) in(
        ('public','search_admin_content_safety_alerts'),
        ('private','preview_content_safety_rule_definition')
      );`).stdout,
      'private:preview_content_safety_rule_definition:postgres:t:s:{"search_path=\\"\\""},public:search_admin_content_safety_alerts:postgres:t:s:{"search_path=\\"\\""}')

    assert.equal(psql(db, `select string_agg(relname||':'||relrowsecurity||':'||relforcerowsecurity,',' order by relname)
      from pg_class where oid in(
        'private.content_safety_alerts'::regclass,
        'private.content_safety_rules'::regclass,
        'private.content_safety_scans'::regclass
      );`).stdout,
      'content_safety_alerts:true:false,content_safety_rules:true:false,content_safety_scans:true:false')
    assert.equal(psql(db, `select purchase_enabled::text||'|'||subscription_enabled::text||'|'||
      refunds_enabled::text||'|'||platform_fee_bps::text
      from private.creator_premium_finance_policy where singleton;`).stdout, 'false|false|false|0')
    assert.equal(psql(db, `select
      (private.creator_premium_content_safety_policy_p1_v2()#>>'{policy_id}')||'|'||
      (private.creator_premium_content_safety_policy_p1_v2()#>>'{activation,enabled}')||'|'||
      (private.creator_premium_content_safety_policy_p1_v2()#>>'{activation,auto_publish_enabled}');`).stdout,
      'nelyon.creator_premium.general.p1.v2|true|true')

    const after = psql(db, `select concat_ws('|',
      (select count(*) from private.content_safety_alerts),
      (select count(*) from private.content_safety_scans),
      (select count(*) from private.admin_action_audit),
      (select lifecycle_status from private.creator_premium_contents where id='${content}'),
      (select verification_status from private.creator_premium_contents where id='${content}')
    );`).stdout
    assert.equal(after, before)
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true })
  }
})

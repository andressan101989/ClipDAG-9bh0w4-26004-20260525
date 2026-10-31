import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const files=readdirSync('supabase/migrations').sort();
const file=files.find(f=>f.endsWith('_superuser_control_center_overview.sql'));
test('bounded overview authority is independently capability-gated and aggregate-only',()=>{
 assert.ok(file,'new bounded projection absent');const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 assert.match(sql,/p_to\s*-\s*p_from\s*>\s*89/);assert.match(sql,/p_to\s*<\s*p_from/);assert.match(sql,/admin_require_capability\('admin.shell.access'\)/);
 for(const cap of ['users.accounts.read','content.items.read','stories.items.read','live.sessions.read','marketplace.overview.read','finance.ledger.read','advertising.ads.read','reports.cases.read','admin.audit.read'])assert.ok(sql.includes(cap));
 assert.match(sql,/set search_path\s*=\s*''/i);assert.match(sql,/owner to postgres/i);assert.match(sql,/from public,\s*anon,\s*authenticated,\s*service_role/i);
 assert.doesNotMatch(sql,/jsonb_build_object\(\s*'(?:email|username|display_name|actor|buyer|sender|wallet_address)'/i);
 assert.doesNotMatch(sql,/\b(?:insert into|update public|delete from)\b/i);assert.match(sql,/limit 8/i);assert.match(sql,/at time zone 'UTC'/i);
});
test('canonical review keyset keeps nullable ordering, payload fingerprint and exact target reconciliation',()=>{
 assert.ok(file);const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 assert.match(sql,/function public.search_admin_advertising_ads/);assert.match(sql,/p_cursor_submitted_at timestamptz/);assert.match(sql,/p_ad_id uuid/);assert.match(sql,/submitted_at asc nulls last/);assert.match(sql,/ad\.submitted_at is null/);assert.match(sql,/limit v_limit\s*\+\s*1/);assert.match(sql,/'next_cursor'/);assert.match(sql,/'submission_fingerprint', ad.submission_fingerprint/);
});
test('review lookahead declares every PL/pgSQL result variable with its actual type',()=>{
 assert.ok(file);const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 const review=sql.slice(sql.indexOf('create or replace function public.search_admin_advertising_ads('));
 const declaration=review.match(/\bdeclare\b([\s\S]*?)\bbegin\b/i)?.[1];
 assert.ok(declaration,'review declaration block absent');
 for(const [name,type] of [['v_limit','integer'],['v_rows','jsonb'],['v_count','integer'],['v_last','jsonb']])
  assert.match(declaration,new RegExp(`\\b${name}\\s+${type}\\b`),`${name} needs an explicit ${type} declaration`);
});
test('daily bucket aliases use explicit AS for PostgreSQL reserved DAY syntax',()=>{
 assert.ok(file);const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 assert.doesNotMatch(sql,/::date\s+day\s*,/i);
 assert.equal((sql.match(/::date\s+as\s+day\s*,/gi)??[]).length,7);
});
test('user trend and count use the same nondeleted cohort; priority alerts use canonical severity',()=>{
 assert.ok(file);const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 assert.match(sql,/from auth.users where created_at>=v_from and created_at<v_until and deleted_at is null group by 1/);
 assert.match(sql,/severity in \('high','critical'\)/);
 assert.match(sql,/creator_premium_purchase_binding_is_valid_v1/);assert.match(sql,/creator_premium_subscription_period_fact_is_valid_f2_v1/);
 assert.doesNotMatch(sql,/sum\((?:fee_amount|balance)\)/);
});
test('latest sign-in is explicitly distinguished from unavailable active-user analytics',()=>{
 assert.ok(file);const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 assert.match(sql,/'key','active','label','Usuarios activos en el periodo','value',null/);
 assert.match(sql,/Usuarios cuyo último inicio de sesión está en el periodo/);
});

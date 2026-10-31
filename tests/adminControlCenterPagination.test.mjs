import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
const functions=['search_admin_ledger_accounts','search_admin_financial_transactions','search_admin_global_audit','search_admin_finance_audit','search_admin_system_audit'];
const files=readdirSync('supabase/migrations').sort();
for(const name of functions)test(`${name} has bounded lookahead and a truthful terminal cursor`,()=>{
 const definitions=files.map(file=>readFileSync(`supabase/migrations/${file}`,'utf8').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'i'))?.[0]).filter(Boolean),sql=definitions.at(-1);
 assert.ok(sql);assert.match(sql,/least\(greatest\(coalesce\(p_limit,50\),1\),100\)/i);assert.match(sql,/with candidates as/i);assert.match(sql,/limit v_limit\s*\+\s*1/i);assert.match(sql,/select \* from candidates order by created_at desc,id desc limit v_limit/i);assert.match(sql,/'next_cursor',case when \(select count\(\*\) from candidates\)>v_limit then/i);assert.match(sql,/else null end/i);assert.match(sql,/\(.*created_at,.*id\)<\(p_cursor_created_at,p_cursor_id\)/i);assert.match(sql,/admin_require_capability\('/i);assert.match(sql,/stable\s+security definer\s+set search_path=''/i);assert.doesNotMatch(sql,/\b(update|insert into|delete from)\s+(public|private)\./i);
 if(name.includes('audit')){assert.match(sql,/admin_audit_safe_metadata/);if(name==='search_admin_finance_audit')assert.match(sql,/private\.admin_audit_row_visible/)}
});

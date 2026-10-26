import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const directory = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('_creator_premium_f5_autonomous_subscriptions.sql'));
test('F5 ships one forward-only migration with no retroactive enrollment or new charge composer', () => {
  assert.equal(files.length, 1, 'missing F5 mandate/worker migration');
  const sql = readFileSync(new URL(files[0], directory), 'utf8');
  assert.match(sql, /public\.subscribe_creator_premium_plan_v1\(/);
  assert.doesNotMatch(sql, /insert into (?:public\.)?(?:ledger_entries|financial_transactions)/i);
  assert.doesNotMatch(sql, /insert into private\.creator_premium_auto_renewal_mandates[^;]*select .*from private\.creator_premium_subscriptions/i);
});

test('F5 keeps charge/cancel/refund cores private and delegates without composing ledger entries', () => {
  assert.equal(files.length,1);
  const sql=readFileSync(new URL(files[0],directory),'utf8');
  for(const [name,signature] of [
    ['subscribe_creator_premium_plan','uuid,uuid,uuid,text'],
    ['cancel_creator_premium_subscription','uuid,uuid,uuid'],
    ['refund_creator_premium_subscription_period','uuid,uuid,text']]) {
    assert.ok(sql.includes(`revoke all on function private.${name}_f4_v1(${signature}) from public,anon,authenticated,service_role;`));
    const wrapper=sql.split(`create function public.${name}_v1(`)[1].split('$$;')[0];
    assert.ok(wrapper.indexOf('creator-premium-subscription-family|')<wrapper.indexOf(`private.${name}_f4_v1(`));
    assert.doesNotMatch(wrapper,/post_creator_premium_(?:charge|refund)_v1/);
  }
  const b7=readFileSync(new URL(files.length ? readdirSync(directory).find(name=>name.endsWith('_creator_premium_b7_full_functional_commercial_completion.sql')) : '',directory),'utf8');
  const admin=b7.split('create function public.admin_refund_creator_premium_subscription_period_v1(')[1].split('$$;')[0];
  assert.match(admin,/public\.refund_creator_premium_subscription_period_v1\(/);
  assert.doesNotMatch(admin,/for update|lock_creator_premium_finance|creator-premium-subscription-family/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8');

test('B1 client service uses only canonical metadata RPCs', () => {
  const body = read('services/creatorPremiumService.ts');
  for (const rpc of [
    'get_creator_premium_catalog_v1',
    'create_my_creator_premium_draft_v1',
    'update_my_creator_premium_draft_v1',
    'get_my_creator_premium_contents_v1',
    'get_my_creator_premium_entitlement_v1',
    'get_my_creator_premium_library_v1',
  ]) assert.match(body, new RegExp(`rpc\\(['\"]${rpc}['\"]`));
  assert.doesNotMatch(body, /\.from\(['\"](?:exclusive_content|content_purchases|subscription_plans|creator_subscriptions|premium_dm_config|premium_dm_payments)['\"]\)/);
  assert.doesNotMatch(body, /functions\.invoke\(['\"]bdag-economy['\"]\)/);
});

test('active creator Premium surfaces do not query absent legacy tables', () => {
  const activeFiles = [
    'app/creator/[id].tsx',
    'app/creator-monetization.tsx',
    'app/my-subscriptions.tsx',
    'app/chat/[userId].tsx',
    'app/(tabs)/messages.tsx',
    'services/creatorService.ts',
    'services/subscriptionService.ts',
    'services/premiumDmService.ts',
    'services/financial/premiumDmClient.ts',
  ];
  const legacyTable = /\.from\(['\"](?:exclusive_content|content_purchases|subscription_plans|creator_subscriptions|premium_dm_config|premium_dm_payments)['\"]\)/;
  for (const path of activeFiles) assert.doesNotMatch(read(path), legacyTable, path);
});

test('Premium purchase, subscription, and DM clients cannot invoke legacy finance', () => {
  const files = [
    'services/economyService.ts',
    'services/subscriptionService.ts',
    'services/premiumDmService.ts',
    'app/creator/[id].tsx',
    'app/creator-monetization.tsx',
    'app/my-subscriptions.tsx',
    'app/chat/[userId].tsx',
  ];
  const bodies = files.map(read).join('\n');
  assert.doesNotMatch(bodies, /action:\s*['\"](?:content_purchase|subscribe|premium_dm_(?:config|send|release))['\"]/);
  assert.doesNotMatch(bodies, /rpc\(['\"](?:send_premium_dm|release_premium_dm|cancel_creator_subscription|upsert_subscription_plan)['\"]/);
  assert.match(read('services/creatorPremiumService.ts'), /CREATOR_PREMIUM_FINANCE_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*false/);
});

test('creator profile keeps the Exclusive shell but states B1 limitations honestly', () => {
  const profile = read('app/creator/[id].tsx');
  assert.match(profile, /Exclusivo/);
  assert.match(profile, /creatorPremiumService/);
  assert.match(profile, /fundaci[oó]n|pr[oó]ximamente|todav[ií]a no est[aá] disponible/i);
  assert.doesNotMatch(profile, /preview_url|content_url/);
});

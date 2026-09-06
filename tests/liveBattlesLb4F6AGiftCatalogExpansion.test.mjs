import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sha256Lf = text => createHash('sha256')
  .update(text.replaceAll('\r\n', '\n'), 'utf8').digest('hex');

const migrationName =
  '20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql';
const migration = await read(`supabase/migrations/${migrationName}`);
const giftService = await read('services/liveGiftsService.ts');
const giftSheet = await read('components/live/gifts/LiveGiftSheet.tsx');
const watchScreen = await read('app/live/watch/[streamId].tsx');
const directedGiftAuthority = await read(
  'supabase/migrations/20260829225002_live_battles_lb4_f4a_directed_gifts.sql',
);
const powerAuthority = await read(
  'supabase/migrations/20260830053531_live_battles_lb4_f4d_a_power_engine.sql',
);
const protectedFiles = {
  replacement: await read('supabase/migrations/20260711193000_replace_sports_car_with_private_jet.sql'),
  f5a: await read('supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql'),
  c3: await read('supabase/migrations/20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql'),
  c3c1: await read('supabase/migrations/20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql'),
  c3c1c1: await read('supabase/migrations/20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql'),
  c3c1c1c1: await read('supabase/migrations/20260902025229_live_battles_lb4_f5_a_c3_c1_c1_c1_lock_mode_boundary.sql'),
  package: await read('package.json'),
  lock: await read('package-lock.json'),
};

const rowPattern = /^\s*\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*null,\s*(\d+),\s*(\d+),\s*true,\s*true\)[,;]?$/gm;
const gifts = [...migration.matchAll(rowPattern)].map(match => ({
  id: match[1],
  emoji: match[2],
  icon: match[3],
  label: match[4],
  cost: Number(match[5]),
  sortOrder: Number(match[6]),
  displayOrder: Number(match[7]),
  category: match[8],
  animationType: match[9],
  durationMs: Number(match[10]),
  priority: Number(match[11]),
}));

const historicalActive = [
  ['heart', 1, 'basic'], ['rose', 5, 'basic'], ['fire', 10, 'basic'],
  ['crown', 50, 'basic'], ['diamond', 100, 'basic'],
  ['lion', 250, 'premium'], ['rocket', 300, 'premium'],
  ['private_jet', 450, 'premium'], ['phoenix', 600, 'legendary'],
  ['dragon', 750, 'legendary'], ['castle', 900, 'legendary'],
  ['galaxy', 1200, 'legendary'],
].map(([id, cost, category]) => ({ id, cost, category }));

const rangeCounts = rows => [
  rows.filter(gift => gift.cost >= 1 && gift.cost <= 20).length,
  rows.filter(gift => gift.cost >= 21 && gift.cost <= 99).length,
  rows.filter(gift => gift.cost >= 100 && gift.cost <= 499).length,
  rows.filter(gift => gift.cost >= 500 && gift.cost <= 1999).length,
  rows.filter(gift => gift.cost >= 2000 && gift.cost <= 9999).length,
  rows.filter(gift => gift.cost >= 10000 && gift.cost <= 34999).length,
];

test('F6-A remains the append-only catalog predecessor to the F8-A commission migration', async () => {
  const names = (await readdir(new URL('../supabase/migrations', import.meta.url)))
    .filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(names.slice(-2), [
    migrationName,
    '20260905230823_live_gift_platform_commission_35.sql',
  ]);
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal((migration.match(/insert into public\.gift_catalog/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /\b(update|delete from|truncate|merge into)\s+public\.gift_catalog\b/i);
  assert.doesNotMatch(migration, /\b(create|alter|drop)\s+(table|function|policy|publication|type|schema)\b/i);
});

test('catalog adds exactly 88 active original gifts with stable ASCII identifiers', () => {
  assert.equal(gifts.length, 88);
  assert.equal(new Set(gifts.map(gift => gift.id)).size, 88);
  for (const gift of gifts) {
    assert.match(gift.id, /^[a-z][a-z0-9_]*$/);
    assert.ok(gift.label.trim().length > 0);
    assert.ok(gift.emoji.trim().length > 0);
    assert.equal(gift.icon, gift.emoji);
    assert.ok(gift.cost >= 1 && gift.cost <= 34999);
    assert.ok(gift.durationMs >= 500 && gift.durationMs <= 15000);
  }
  assert.ok(!gifts.some(gift => gift.id === 'sports_car'));
});

test('101 total, 100 active and sports_car as the only inactive row are explicit invariants', () => {
  assert.match(migration, /v_total <> 101 or v_active <> 100 or v_inactive <> 1 or v_new <> 88/i);
  assert.match(migration, /id = 'sports_car'[\s\S]*active = false[\s\S]*enabled = false/i);
  assert.match(migration, /id = 'private_jet'[\s\S]*active[\s\S]*enabled/i);
  assert.match(migration, /id = 'rose'[\s\S]*cost_coins = 5/i);
  assert.doesNotMatch(migration, /on conflict[\s\S]*do update/i);
  assert.match(migration, /on conflict \(id\) do nothing/i);
});

test('all active price ranges satisfy the required distribution', () => {
  const active = [...historicalActive, ...gifts];
  assert.equal(active.length, 100);
  assert.deepEqual(rangeCounts(active), [22, 22, 22, 17, 11, 6]);
  assert.deepEqual(rangeCounts(gifts), [19, 21, 18, 13, 11, 6]);
});

test('categories, animation families and deterministic order stay within the existing contract', () => {
  const categories = new Set(['basic', 'premium', 'legendary']);
  const animations = new Set(['floating', 'center', 'fullscreen', 'entrance', 'celebration']);
  const expectedOrder = Array.from({ length: 88 }, (_, index) => index + 101);
  assert.deepEqual(gifts.map(gift => gift.displayOrder), expectedOrder);
  assert.deepEqual(gifts.map(gift => gift.sortOrder), expectedOrder);
  assert.deepEqual(gifts.map(gift => gift.priority), expectedOrder);
  assert.ok(gifts.every(gift => categories.has(gift.category)));
  assert.ok(gifts.every(gift => animations.has(gift.animationType)));
  const active = [...historicalActive, ...gifts];
  assert.deepEqual(Object.fromEntries([...categories].map(category => [
    category, active.filter(gift => gift.category === category).length,
  ])), { basic: 39, premium: 32, legendary: 29 });
});

test('new identities contain no TikTok branding, remote assets or executable markup', () => {
  const text = gifts.map(gift => `${gift.id} ${gift.label}`).join('\n');
  assert.doesNotMatch(text, /tiktok|tik tok|douyin|byte ?dance/i);
  assert.doesNotMatch(migration, /https?:\/\/|<\/?[a-z][^>]*>/i);
  assert.ok(gifts.every(gift => gift.id !== 'lion' && gift.id !== 'galaxy'));
});

test('server remains the sole price authority and the client cannot supply a price', () => {
  assert.match(directedGiftAuthority,
    /from public\.gift_catalog as gc[\s\S]*where gc\.id = p_gift_id and gc\.active and gc\.enabled/i);
  assert.match(directedGiftAuthority,
    /v_fee := pg_catalog\.floor\(v_gift\.cost_coins::numeric \* 0\.10\)::integer/);
  assert.match(directedGiftAuthority,
    /v_creator_amount := v_gift\.cost_coins - v_fee/);
  assert.doesNotMatch(giftService, /p_(cost|price|amount)/i);
  assert.match(giftService,
    /rpc\('send_live_battle_gift', \{[\s\S]*p_gift_id: input\.giftId[\s\S]*p_idempotency_key: input\.idempotencyKey/i);
});

test('x2/x3 modify Battle points only and x3 wins without x6', () => {
  assert.match(powerAuthority,
    /v_awarded_points := v_gift\.amount_coins::bigint \* v_multiplier/i);
  assert.match(powerAuthority,
    /order by boost\.multiplier desc, boost\.starts_at, boost\.id/i);
  assert.match(directedGiftAuthority,
    /v_gift\.cost_coins, v_fee, v_creator_amount, p_idempotency_key/i);
  assert.doesNotMatch(powerAuthority, /creator_amount_coins\s*\*\s*(v_)?multiplier/i);
  assert.doesNotMatch(powerAuthority, /amount_coins\s*:=\s*[^;]*multiplier/i);
});

test('only the canonical rose gift advances rose progress', () => {
  assert.match(powerAuthority,
    /v_gift\.gift_id is distinct from v_rules\.rose_gift_id[\s\S]*return v_state/i);
  assert.match(powerAuthority, /gift\.gift_id = v_rules\.rose_gift_id/i);
  assert.match(powerAuthority, /rule_version = 2 and rose_gift_id = 'rose'/i);
  assert.match(powerAuthority, /rose_target_units = 10 and rose_multiplier = 2/i);
});

test('catalog UI stays dynamic, virtualized, stable and excludes inactive gifts', () => {
  assert.match(giftService, /from\('gift_catalog'\)[\s\S]*\.eq\('active', true\)/i);
  assert.match(giftService, /\.order\('display_order'/i);
  assert.match(giftSheet, /<FlatList/);
  assert.match(giftSheet, /keyExtractor=\{item => item\.id\}/);
  assert.match(giftSheet, /item\.icon[\s\S]*item\.name[\s\S]*item\.priceBdag/);
  assert.match(watchScreen, /sendingGiftRef\.current/);
  assert.doesNotMatch(giftSheet, /const\s+gifts\s*=\s*\[/i);
});

test('historical replacement, F5 chain and manifests remain LF-canonical', () => {
  const expected = {
    replacement: '3e66c4b10bfeb9260e33bbaffb06b113f639e7fb5a491a923019c3b79d92ec3e',
    f5a: '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45',
    c3: '64b94397de5a7f31449f6a025eb458a41b35f0e936b23eeb79ae379e0b7751bd',
    c3c1: '1da58dbf6ab85c5953c227d6cc2b2904bc4346a58ff5ca58054b010000bb5237',
    c3c1c1: 'dc1e075772ae152cd27cba7707efa263fe7ab3510e32a1bed2aa95278fae96f9',
    c3c1c1c1: '38e169c397438bedb9f80deb7fbd231aca30fe19c5a4d2af87e88a684d25f663',
    package: '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0',
    lock: '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4',
  };
  for (const [name, text] of Object.entries(protectedFiles)) {
    assert.equal(sha256Lf(text), expected[name], name);
  }
});

test('migration cannot touch economy, historical gifts, F5 or Realtime', () => {
  assert.doesNotMatch(migration,
    /financial_transactions|ledger_entries|ledger_accounts|live_gift_transactions|live_battle_score_events|live_battle_boost_events|atomic_ledger_transfer/i);
  assert.doesNotMatch(migration,
    /agora|media relay|creator recovery|edge function|marketplace|live_battle_series|rematch|alter publication|\brealtime\./i);
});

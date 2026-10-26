import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
function load(file, imports, globals = {}) {
  const compiled = ts.transpileModule(read(file), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', ...Object.keys(globals), compiled)(name => {
    assert.ok(name in imports, `Unexpected import ${name}`);
    return imports[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
const HOST = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const serverEpoch = Date.parse('2026-10-26T12:00:00.000Z');
const deadline = '2026-10-26T12:01:30.000Z';
const anchor = { serverEpochMsAtAnchor: serverEpoch, monotonicMsAtAnchor: 1000, roundTripMs: 0 };
const element = (type, props, ...children) => typeof type === 'function'
  ? type({ ...props, children }) : { type, props: props ?? {}, children: children.flat(Infinity) };
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : [];
const texts = tree => nodes(tree).filter(node => node.type === 'Text').map(node => node.children.join(''));

function controls({ monotonicNow = 11000, wallNow = serverEpoch, clockAnchor = anchor, status = 'active', error = null } = {}) {
  const performance = { now: () => monotonicNow };
  const spectator = load('services/liveBattleSpectatorService.ts', {
    '@/template': { getSupabaseClient: () => ({}) },
  }, { globalThis: { performance } });
  const react = {
    createElement: element, useCallback: fn => fn, useMemo: fn => fn(),
    useRef: value => ({ current: value }), useEffect() {},
    useState: value => [value, () => {}],
  };
  const rn = Object.fromEntries(['ActivityIndicator', 'FlatList', 'Modal', 'Pressable', 'Text', 'View'].map(name => [name, name]));
  rn.StyleSheet = { create: value => value };
  const { LiveBattleHostControls } = load('components/live/LiveBattleHostControls.tsx', {
    react, 'react-native': rn, '@expo/vector-icons': { MaterialIcons: 'Icon' },
    '@/components/ui/SafeImage': { Image: 'Image' }, '@/services/liveBattleService': {},
    '@/services/liveBattleSpectatorService': spectator,
    '@/constants/theme': Object.fromEntries(['Colors', 'FontSize', 'FontWeight', 'Radius', 'Spacing'].map(name => [name, {}])),
  }, { Date: { parse: Date.parse, now: () => wallNow } });
  return LiveBattleHostControls({
    enabled: true, hostUserId: HOST, liveSessionId: OTHER, presentationTick: 1,
    snapshot: { status: 'ready', errorCode: null, battle: {
      id: HOST, status, challengerUserId: HOST, opponentUserId: OTHER,
      inviteExpiresAt: deadline, scheduledStartAt: deadline, scheduledEndAt: deadline,
    } }, clockAnchor, actionPending: false, actionError: error,
  });
}

for (const status of ['pending', 'countdown', 'active']) {
  test(`C1 ${status} clock ignores wall-clock skew and advances only with monotonic time`, () => {
    const expected = status === 'countdown' ? '80' : '1:20';
    for (const skew of [-86400000, 86400000]) {
      assert.ok(texts(controls({ status, wallNow: serverEpoch + skew })).some(text => text.endsWith(expected)));
    }
    const next = status === 'countdown' ? '70' : '1:10';
    assert.ok(texts(controls({ status, monotonicNow: 21000 })).some(text => text.endsWith(next)));
  });
  test(`C1 ${status} clock is unknown without a usable server anchor`, () => {
    for (const options of [{ clockAnchor: null }, { monotonicNow: null }, { monotonicNow: 0 },
      { clockAnchor: { ...anchor, serverEpochMsAtAnchor: NaN } }]) {
      assert.ok(texts(controls({ status, ...options })).some(text => text.endsWith('--:--')));
    }
  });
}

for (const code of ['live_battle_pair_busy', 'live_battle_series_pair_busy', 'live_battle_participant_busy']) {
  test(`C1 ${code} survives RPC normalization and presents safe state-changed copy`, async () => {
    const service = load('services/liveBattleService.ts', {
      '@/template': { getSupabaseClient: () => ({ rpc: async () => ({ data: null, error: { message: code, code: 'PT409' } }) }) },
    });
    let normalized;
    await assert.rejects(service.createLiveBattleInvite({ opponentUserId: OTHER, challengerSessionId: HOST, opponentSessionId: OTHER }), error => {
      normalized = error.code;
      assert.equal(normalized, code);
      assert.equal(error.postgresCode, 'PT409');
      return true;
    });
    const output = texts(controls({ error: normalized })).join(' ');
    assert.ok(output.includes('La Battle cambió; estado actualizado.'));
    assert.ok(!output.includes(code));
  });
}

test('C1 host controls never consult the wall clock', () => {
  assert.doesNotMatch(read('components/live/LiveBattleHostControls.tsx'), /Date\.now\s*\(/);
});

test('C1 broadcast passes its existing server anchor to host controls', () => {
  const source = read('app/live/broadcast/[streamId].tsx');
  assert.match(source, /<LiveBattleHostControls\b[\s\S]*?clockAnchor=\{battleProjection\.clockAnchor\}/);
});

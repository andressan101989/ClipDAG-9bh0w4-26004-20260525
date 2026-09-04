import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = relative => readFile(new URL(relative, root), 'utf8');

const [
  watchSource,
  stageSource,
  viewerHudSource,
  viewerChromeSource,
  inviteCardSource,
  inviteContractSource,
  giftServiceSource,
  giftSheetSource,
] = await Promise.all([
  read('app/live/watch/[streamId].tsx'),
  read('components/live/LiveBattleStage.tsx'),
  read('components/live/LiveBattleViewerHUD.tsx'),
  read('components/live/LiveBattleViewerChrome.tsx'),
  read('components/live/LiveHostInvitationCard.tsx'),
  read('components/live/liveHostInvitationContract.ts'),
  read('services/liveGiftsService.ts'),
  read('components/live/gifts/LiveGiftSheet.tsx'),
]);

function parse(source, name, kind = ts.ScriptKind.TSX) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, kind);
  assert.deepEqual(file.parseDiagnostics, [], `${name} must parse`);
  return file;
}

for (const [source, name, kind] of [
  [watchSource, 'watch.tsx', ts.ScriptKind.TSX],
  [stageSource, 'LiveBattleStage.tsx', ts.ScriptKind.TSX],
  [viewerHudSource, 'LiveBattleViewerHUD.tsx', ts.ScriptKind.TSX],
  [viewerChromeSource, 'LiveBattleViewerChrome.tsx', ts.ScriptKind.TSX],
  [inviteCardSource, 'LiveHostInvitationCard.tsx', ts.ScriptKind.TSX],
  [inviteContractSource, 'liveHostInvitationContract.ts', ts.ScriptKind.TS],
]) parse(source, name, kind);

test('viewer Battle uses the dedicated Figma HUD over exactly two canonical surfaces', () => {
  assert.match(watchSource, /<LiveBattleStage[\s\S]*viewerMode/);
  assert.equal((stageSource.match(/<HostPanel/g) ?? []).length, 2);
  assert.match(stageSource, /viewerMode \? \([\s\S]*<LiveBattleViewerHUD/);
  assert.match(viewerHudSource, /Marcador .*localScore.*rivalScore/);
  assert.match(viewerHudSource, /Rosas .*localRoseProgress.*roseTarget/);
  assert.match(viewerHudSource, /roseDots/);
  assert.match(viewerHudSource, /advantage/);
  assert.match(viewerHudSource, /timer/);
});

test('Battle viewer chrome matches the required header, rail, chat and gift CTA contract', () => {
  for (const label of ['LIVE', 'Reaccionar', 'Compartir', 'Más opciones', 'Regalos', 'Escribe un comentario']) {
    assert.match(viewerChromeSource, new RegExp(label));
  }
  assert.match(viewerChromeSource, /minHeight: 48/);
  assert.match(viewerChromeSource, /width: 48, height: 48/);
  assert.match(watchSource, /battleState \? \([\s\S]*<BattleViewerHeader/);
  assert.match(watchSource, /battleState \? \([\s\S]*<ViewerActionRail/);
  assert.match(watchSource, /battleState \? \([\s\S]*<ViewerBottomBar/);
  assert.match(watchSource, /battleState && styles\.battleChatGradient/);
});

test('commerce remains structurally excluded from Battle', () => {
  for (const name of ['LiveCommerceButton', 'LiveProductRail', 'LiveViewerCommerce']) {
    assert.match(watchSource, new RegExp(`!battleState[\\s\\S]{0,800}<${name}`));
  }
});

test('F7-A gift authority, single flight and modal success/error behavior stay intact', () => {
  assert.match(giftServiceSource, /send_live_battle_gift/);
  assert.match(watchSource, /battleId: battleState\.battleId/);
  assert.match(watchSource, /targetUserId: battleState\.localHostUserId/);
  assert.match(watchSource, /if \(sendingGiftRef\.current\) return/);
  assert.match(watchSource, /pendingGiftAttemptRef\.current\?\.fingerprint/);
  assert.match(watchSource, /if \(!result\.success\)[\s\S]*return;[\s\S]*setGiftSheetVisible\(false\)/);
  assert.match(watchSource, /setWalletBalance\(result\.new_sender_balance\)/);
  assert.match(watchSource, /battleProjection\.reconcile\(\)/);
  assert.match(watchSource, /giftFeedback && !giftSheetVisible/);
  assert.match(giftSheetSource, /presentationStyle="overFullScreen"/);
  assert.doesNotMatch(watchSource, /set(?:Battle)?Score|setRoseProgress|score\s*[+]=|roseProgress\s*[+]=/);
});

test('large invitation is modal, accessible, blocks background and restores focus', () => {
  assert.match(inviteCardSource, /<Modal/);
  assert.match(inviteCardSource, /presentationStyle="overFullScreen"/);
  assert.match(inviteCardSource, /El anfitrión te invita[\s\S]*a unirte al LIVE/);
  assert.match(inviteCardSource, /Participarás con cámara y micrófono\. Puedes salir en cualquier momento\./);
  assert.match(inviteCardSource, />Rechazar</);
  assert.match(inviteCardSource, />Aceptar</);
  assert.match(inviteCardSource, /accessibilityViewIsModal/);
  assert.match(inviteCardSource, /accessibilityLiveRegion="assertive"/);
  assert.match(inviteCardSource, /setAccessibilityFocus/);
  assert.match(inviteCardSource, /announceForAccessibility/);
  assert.match(inviteCardSource, /minHeight: 52/);
  assert.match(inviteCardSource, /rgba\(3,3,5,0\.54\)/);
});

test('invitation expiry and action gate are deterministic and single-flight', async () => {
  const compiled = ts.transpileModule(inviteContractSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('module', 'exports', compiled)(module, module.exports);
  const { HOST_INVITE_WINDOW_MS, LiveHostInvitationActionGate, resolveHostInviteExpiresAt } = module.exports;
  assert.equal(HOST_INVITE_WINDOW_MS, 20_000);
  assert.equal(resolveHostInviteExpiresAt('2026-09-04T12:00:00.000Z'), Date.parse('2026-09-04T12:00:20.000Z'));
  const gate = new LiveHostInvitationActionGate();
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const first = gate.run('invite-1', 'accept', async () => { calls += 1; await pending; return 'ok'; });
  const duplicate = await gate.run('invite-1', 'accept', async () => { calls += 1; return 'duplicate'; });
  assert.deepEqual(duplicate, { status: 'ignored' });
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { status: 'succeeded', value: 'ok' });

  calls = 0;
  const rejected = await Promise.all([
    gate.run('invite-2', 'reject', async () => { calls += 1; return 'rejected'; }),
    gate.run('invite-2', 'reject', async () => { calls += 1; return 'duplicate'; }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(rejected.map(result => result.status).sort(), ['ignored', 'succeeded']);
});

test('watch consumes one invitation subscription and closes on success, terminal event or expiry', () => {
  assert.equal((watchSource.match(/live-control-invite:/g) ?? []).length, 1);
  assert.match(watchSource, /event_type !== 'host_invite'/);
  assert.match(watchSource, /HOST_INVITE_TERMINAL_EVENTS/);
  assert.match(watchSource, /hostInviteGateRef\.current\.run/);
  assert.match(watchSource, /setHostInviteAction\('accepting'\)/);
  assert.match(watchSource, /setHostInviteAction\('rejecting'\)/);
  assert.match(watchSource, /onExpire=\{expireHostInvite\}/);
});

test('reduced motion and bounded invitation countdown clean up without polling', () => {
  assert.match(inviteCardSource, /reducedMotion/);
  assert.match(inviteCardSource, /setTimeout/);
  assert.match(inviteCardSource, /clearTimeout/);
  assert.doesNotMatch(inviteCardSource, /setInterval|poll/i);
});

test('protected manifests and deployed migrations remain LF-identical', async () => {
  const expected = new Map([
    ['package.json', '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0'],
    ['package-lock.json', '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4'],
    ['supabase/migrations/20260830053531_live_battles_lb4_f4d_a_power_engine.sql', '3803e2fbcd23e7c63f5cff45e1ff5994b61011f3e3fdf89fa0166bd6efb3ab25'],
    ['supabase/migrations/20260830162244_live_battles_lb4_f4d_b_power_projection.sql', '60955601e14619f34e71c0ccc782a109530e76cbe63f14cacb1db6b34f660dd6'],
    ['supabase/migrations/20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql', 'f5cd23b73c943ce15c5dddbbf35ed9200e0ae8ef10af883d08ecd67c7a423d17'],
    ['supabase/migrations/20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql', '5ca7cb6a284a40fba7886ff8f31fbf64e888d1a20a8694f01177d00fe970de45'],
    ['supabase/migrations/20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql', '8adfe6b93e1164dd53242523a3e5b3096e71f5e1ab8869d49c7e2e628c629dbf'],
  ]);
  for (const [file, hash] of expected) {
    const normalized = (await read(file)).replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(normalized).digest('hex'), hash, file);
  }
});

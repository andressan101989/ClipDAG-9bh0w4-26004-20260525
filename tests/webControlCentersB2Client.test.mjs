import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { loadStoryQaModule } from './helpers/loadStoryQaModule.mjs';
import { loadStoryQaComponent } from './helpers/loadStoryQaComponent.mjs';
import { mount } from './helpers/storyQaHostRenderer.mjs';

const id = '21000000-0000-4000-8000-000000000001';
const command = '22000000-0000-4000-8000-000000000001';
const stamp = '2026-11-08T08:00:00.123456Z';
const row = Object.freeze({ id, draft_id: id, draft_revision: 2, state: 'scheduled', revision: 3,
  generation: 1, scheduled_for: stamp, timezone_name: 'America/New_York',
  local_scheduled_at: '2026-11-08T03:00:00.000000', utc_offset_minutes: -300,
  attempt_count: 0, max_attempts: 5, next_attempt_at: stamp, retryable: false,
  last_error_code: null, post_id: null, created_at: stamp, updated_at: stamp });
const time = { localScheduledAt: '2026-11-08T03:00', timezoneName: 'America/New_York', utcOffsetMinutes: -300 };
const mutation = { scheduleId: id, expectedRevision: 3, clientCommandId: command };
const draft = { id, kind: 'photo', state: 'draft', revision: 2, caption: 'Private photo', music: '',
  composition: {}, assetIds: [id], createdAt: stamp, updatedAt: stamp };
const item = { id, draftId: id, draftRevision: 2, state: 'scheduled', revision: 3, generation: 1,
  scheduledFor: stamp, timezoneName: time.timezoneName, localScheduledAt: time.localScheduledAt,
  utcOffsetMinutes: -300, attemptCount: 0, maxAttempts: 5, nextAttemptAt: stamp,
  retryable: false, lastErrorCode: null, postId: null, createdAt: stamp, updatedAt: stamp };
const dataModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
let fixtureId = 0;
async function service(respond = () => ({ data: row, error: null })) {
  const calls = [];
  const key = ++fixtureId;
  globalThis.__b2Fixtures ??= {};
  globalThis.__b2Fixtures[key] = { rpc(name, args) {
    const call = { name, args, signal: null }; calls.push(call);
    return { abortSignal(signal) { call.signal = signal; return this; },
      then(resolve, reject) { return Promise.resolve().then(() => respond(call)).then(resolve, reject); } };
  } };
  const api = await loadStoryQaModule('services/publicationScheduleService.ts', {
    '@/template': dataModule(`export const getSupabaseClient=()=>globalThis.__b2Fixtures[${key}];`),
  });
  return { api, calls };
}
const errorCode = code => error => error.code === code && !String(error.message).includes('SECRET');

test('owner mutations emit exact RPC arguments and replay caller commands unchanged', async () => {
  const { api, calls } = await service();
  assert.equal(typeof api.schedulePublicationDraft, 'function');
  const create = { draftId: id, expectedRevision: 2, clientCommandId: command, ...time };
  await api.schedulePublicationDraft(create); await api.schedulePublicationDraft(create);
  await api.reschedulePublication({ ...mutation, ...time });
  await api.cancelPublicationSchedule(mutation); await api.retryPublicationSchedule(mutation);
  assert.deepEqual(calls.map(c => c.name), ['schedule_my_publication_draft_v1','schedule_my_publication_draft_v1',
    'reschedule_my_publication_v1','cancel_my_publication_schedule_v1','retry_my_publication_schedule_v1']);
  assert.deepEqual(calls[0].args, { p_draft_id: id, p_expected_revision: 2, p_client_command_id: command,
    p_local_scheduled_at: time.localScheduledAt, p_timezone_name: time.timezoneName, p_utc_offset_minutes: -300 });
  assert.deepEqual(calls[1].args, calls[0].args);
  assert.deepEqual(calls[2].args, { p_schedule_id: id, p_expected_revision: 3, p_client_command_id: command,
    p_local_scheduled_at: time.localScheduledAt, p_timezone_name: time.timezoneName, p_utc_offset_minutes: -300 });
  assert.deepEqual(calls[3].args, { p_schedule_id: id, p_expected_revision: 3, p_client_command_id: command });
  assert.deepEqual(calls[4].args, calls[3].args);
});

test('client rejects invalid identities, CAS, wall time, zones and offsets without transport', async () => {
  const { api, calls } = await service();
  assert.equal(typeof api.schedulePublicationDraft, 'function');
  for (const patch of [{ draftId: 'bad' }, { clientCommandId: 'bad' }, { expectedRevision: 0 },
    { expectedRevision: 1.5 }, { localScheduledAt: '2026-11-08T03:00Z' },
    { localScheduledAt: '2026-02-30T03:00' }, { timezoneName: 'Fake/Zone' },
    { utcOffsetMinutes: 841 }, { utcOffsetMinutes: 2.5 }]) {
    await assert.rejects(api.schedulePublicationDraft({ draftId: id, expectedRevision: 2, clientCommandId: command, ...time, ...patch }), errorCode('invalid_input'));
  }
  assert.equal(calls.length, 0);
});

test('DST gaps, ambiguity and policy bounds are decided by the server and sanitized', async () => {
  for (const message of ['publication_schedule_time_invalid','publication_schedule_time_invalid_or_ambiguous','publication_schedule_time_bounds']) {
    const { api, calls } = await service(() => ({ error: { code: '22023', message, details: 'SECRET' } }));
    assert.equal(typeof api.schedulePublicationDraft, 'function');
    await assert.rejects(api.schedulePublicationDraft({ draftId: id, expectedRevision: 2, clientCommandId: command,
      localScheduledAt: '2027-03-14T02:30', timezoneName: 'America/New_York' }), errorCode('invalid_time'));
    assert.equal(calls[0].args.p_local_scheduled_at, '2027-03-14T02:30');
    assert.equal(calls[0].args.p_utc_offset_minutes, null);
  }
});

test('strict owner projection rejects private fields and malformed authority values', async () => {
  for (const patch of [{ claim_token: command }, { owner_id: id }, { revision: '3' }, { attempt_count: 6 },
    { scheduled_for: 'bad' }, { retryable: 'true' }, { state: 'invented' }, { last_error_code: 'https://SECRET' },
    { local_scheduled_at: '2026-11-08T03:00Z' }, { timezone_name: 'Fake/Zone' }, { max_attempts: 0 },
    { state: 'published', post_id: null }, { state: 'terminal_failed', retryable: true }]) {
    const { api } = await service(() => ({ data: { ...row, ...patch }, error: null }));
    assert.equal(typeof api.cancelPublicationSchedule, 'function');
    await assert.rejects(api.cancelPublicationSchedule(mutation), errorCode('invalid_response'));
  }
  const { api } = await service();
  assert.deepEqual(await api.cancelPublicationSchedule(mutation), { ...item, localScheduledAt: row.local_scheduled_at });
});

test('bounded keyset pagination preserves server precision and requires a complete cursor', async () => {
  const { api, calls } = await service(() => ({ data: [row], error: null }));
  assert.equal(typeof api.listPublicationSchedules, 'function');
  const page = await api.listPublicationSchedules({ limit: 1 });
  assert.deepEqual(page.nextCursor, { createdAt: stamp, id });
  await api.listPublicationSchedules({ limit: 1, cursor: page.nextCursor });
  assert.deepEqual(calls[1].args, { p_limit: 1, p_before_created_at: stamp, p_before_id: id });
  for (const input of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: { id } },
    { cursor: { createdAt: stamp } }, { cursor: { createdAt: 'bad', id } }]) {
    await assert.rejects(api.listPublicationSchedules(input), errorCode('invalid_input'));
  }
});

test('known rejections remain distinct and raw errors never cross the client boundary', async () => {
  for (const [message, code] of [['publication_auth_required','auth'], ['publication_schedule_conflict','stale_revision'],
    ['publication_draft_conflict','stale_revision'], ['publication_schedule_command_conflict','conflict'],
    ['publication_schedule_exists','conflict'], ['publication_schedule_retry_forbidden','retry_forbidden'],
    ['publication_schedule_not_found','forbidden'], ['SECRET provider URL','unknown'],
    ['toString','unknown'], ['constructor','unknown'], ['__proto__','unknown']]) {
    const { api } = await service(() => ({ error: { code: 'P0001', message, details: 'SECRET' } }));
    assert.equal(typeof api.cancelPublicationSchedule, 'function');
    await assert.rejects(api.cancelPublicationSchedule(mutation), errorCode(code));
  }
});

test('abort signals reach PostgREST and aborted late results cannot become success', async () => {
  const controller = new AbortController();
  const { api, calls } = await service(() => { controller.abort(); return { data: row, error: null }; });
  assert.equal(typeof api.cancelPublicationSchedule, 'function');
  await assert.rejects(api.cancelPublicationSchedule({ ...mutation, signal: controller.signal }), errorCode('aborted'));
  assert.equal(calls[0].signal, controller.signal);
  await assert.rejects(api.cancelPublicationSchedule({ ...mutation, signal: controller.signal }), errorCode('aborted'));
  assert.equal(calls.length, 1);
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function nodeText(node) { return node?.text ?? (node?.children ?? []).map(nodeText).join(''); }
const press = (app, label) => app.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label);
const textExists = (app, text) => app.nodes().some(n => n.text === text);
async function screen(overrides = {}) {
  const focus = {}; const account = { id: '23000000-0000-4000-8000-000000000001' };
  const flatList = ({ data = [], renderItem, ListHeaderComponent, ListFooterComponent, ...props }) =>
    React.createElement('FlatList', props, ListHeaderComponent, ...data.map((entry, index) =>
      React.createElement(React.Fragment, { key: entry.id }, renderItem({ item: entry, index }))), ListFooterComponent);
  let uuid = 0;
  const fixture = {
    StyleSheet: { create: v => v, absoluteFill: {}, hairlineWidth: 1 }, Dimensions: { get: () => ({ width: 390 }) },
    FlatList: flatList, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
    Colors: new Proxy({}, { get: () => '#111' }), FontSize: {}, FontWeight: {}, Radius: {}, Spacing: {},
    randomUUID: () => `22000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,
    formatNumber: String, useLocalSearchParams: () => ({ tab: overrides.tab ?? 'scheduled' }),
    useRouter: () => ({ push() {}, back() {} }), useFocusEffect: callback => { focus.callback = callback; React.useEffect(callback, [callback]); },
    useAuth: () => ({ user: account.id ? { id: account.id } : null }), useFeed: () => ({}), useAlert: () => ({ showAlert() {} }),
    fetchCreatorVideoFeed: async () => [], fetchSavedVideoFeed: async () => [], getMediaUrl: async () => 'https://example.test/photo',
    DraftManager: { listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }), restorePublicationDraft: async () => draft,
      listPublicationSchedules: async () => ({ items: [item], nextCursor: null }),
      schedulePublicationDraft: async () => item, reschedulePublication: async () => item,
      cancelPublicationSchedule: async () => ({ ...item, state: 'cancelled' }), retryPublicationSchedule: async () => item,
      ...overrides.manager },
  };
  const { default: Component } = await loadStoryQaComponent('app/my-content.tsx', fixture);
  return { app: await mount(Component), focus, account };
}

test('scheduled tab is visible and request failure is distinct from a true empty result', async () => {
  let fail = true;
  const { app } = await screen({ manager: { listPublicationSchedules: async () => {
    if (fail) throw new Error('SECRET'); return { items: [], nextCursor: null };
  } } });
  try {
    assert.ok(press(app, 'Programados'));
    assert.ok(press(app, 'Reintentar cargar programados'));
    assert.equal(textExists(app, 'Sin publicaciones programadas'), false);
    assert.equal(textExists(app, 'SECRET'), false);
    fail = false; await app.flush(() => press(app, 'Reintentar cargar programados').props.onPress());
    assert.ok(textExists(app, 'Sin publicaciones programadas'));
  } finally { await app.unmount(); }
});

test('schedule action is offered only on restorable photo/carousel cloud drafts and preserves local inputs', async () => {
  const calls = [];
  const { app } = await screen({ tab: 'drafts', manager: {
    listPublicationDrafts: async () => ({ items: [draft, { ...draft, id: command, kind: 'video' },
      { ...draft, id: '24000000-0000-4000-8000-000000000001', kind: 'carousel', state: 'deleted' }], nextCursor: null }),
    schedulePublicationDraft: async input => { calls.push(input); return item; },
  } });
  try {
    assert.equal(app.nodes().filter(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Programar borrador').length, 1);
    await app.flush(() => press(app, 'Programar borrador').props.onPress());
    for (const [label, value] of [['Fecha y hora local','2027-11-07T01:30'],['Zona horaria IANA','America/New_York'],['Desfase UTC en minutos','-240']]) {
      await app.flush(() => app.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label).props.onChangeText(value));
    }
    await app.flush(() => press(app, 'Confirmar programación').props.onPress());
    assert.equal(calls.length, 1);
    assert.deepEqual({ ...calls[0], signal: undefined, clientCommandId: undefined }, { draftId: id, expectedRevision: 2,
      localScheduledAt: '2027-11-07T01:30', timezoneName: 'America/New_York', utcOffsetMinutes: -240, signal: undefined, clientCommandId: undefined });
  } finally { await app.unmount(); }
});

test('uncertain schedule action freezes command and payload until replay succeeds, then new intent gets a new ID', async () => {
  const calls = [];
  const { app } = await screen({ tab: 'drafts', manager: { schedulePublicationDraft: async input => {
    calls.push(input); if (calls.length === 1) throw new Error('lost response'); return item;
  } } });
  try {
    await app.flush(() => press(app, 'Programar borrador').props.onPress());
    await app.flush(() => app.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Fecha y hora local').props.onChangeText('2027-01-01T12:00'));
    await app.flush(() => press(app, 'Confirmar programación').props.onPress());
    assert.ok(press(app, 'Reintentar acción de programación'));
    await app.flush(() => press(app, 'Reintentar acción de programación').props.onPress());
    assert.equal(calls[0].clientCommandId, calls[1].clientCommandId);
    assert.equal(calls[0].localScheduledAt, calls[1].localScheduledAt);
    await app.flush(() => press(app, 'Programar borrador').props.onPress());
    await app.flush(() => press(app, 'Confirmar programación').props.onPress());
    assert.notEqual(calls[2].clientCommandId, calls[0].clientCommandId);
  } finally { await app.unmount(); }
});

test('cancel and retry use exact server revision and only server-authorized retries are shown', async () => {
  const calls = [];
  const rows = [item, { ...item, id: command, state: 'retryable_failed', retryable: true, attemptCount: 2 },
    { ...item, id: '25000000-0000-4000-8000-000000000001', state: 'terminal_failed', attemptCount: 5 }];
  const { app } = await screen({ manager: { listPublicationSchedules: async () => ({ items: rows, nextCursor: null }),
    retryPublicationSchedule: async input => { calls.push(['retry',input]); return { ...item, id: command }; },
    cancelPublicationSchedule: async input => { calls.push(['cancel',input]); return { ...item, state: 'cancelled' }; },
  } });
  try {
    assert.equal(app.nodes().filter(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Reintentar publicación programada: Borrador 21000000…0001').length, 1);
    await app.flush(() => press(app, 'Reintentar publicación programada: Borrador 21000000…0001').props.onPress());
    await app.flush(() => press(app, 'Cancelar publicación programada: Borrador 21000000…0001').props.onPress());
    assert.deepEqual(calls.map(([op,input]) => [op,input.scheduleId,input.expectedRevision]), [['retry',command,3],['cancel',id,3]]);
  } finally { await app.unmount(); }
});

test('reschedule uses the selected schedule CAS and action failure preserves list and cursor', async () => {
  const calls = []; const cursor = { createdAt: stamp, id };
  const { app } = await screen({ manager: { listPublicationSchedules: async () => ({ items: [item], nextCursor: cursor }),
    reschedulePublication: async input => { calls.push(input); throw Object.assign(new Error('stale'), { code: 'stale_revision' }); },
  } });
  try {
    await app.flush(() => press(app, 'Cambiar programación: Borrador 21000000…0001').props.onPress());
    await app.flush(() => press(app, 'Confirmar programación').props.onPress());
    assert.equal(calls[0].scheduleId, id); assert.equal(calls[0].expectedRevision, 3);
    assert.ok(press(app, 'Cargar más programados'));
    assert.ok(textExists(app, 'Programada'));
  } finally { await app.unmount(); }
});

test('scheduled cards expose bounded draft headers and distinct accessible actions without hiding nested buttons', async () => {
  const calls = [];
  const rows = [
    { ...item, state: 'retryable_failed', retryable: true, attemptCount: 2 },
    { ...item, id: command, draftId: 'abcd1234-0000-4000-8000-00000000ef56', state: 'retryable_failed', retryable: true, attemptCount: 2 },
  ];
  const { app } = await screen({ manager: { listPublicationSchedules: async () => ({ items: rows, nextCursor: null }),
    cancelPublicationSchedule: async input => { calls.push(input); return { ...rows[1], state: 'cancelled' }; },
  } });
  try {
    for (const reference of ['Borrador 21000000…0001', 'Borrador ABCD1234…EF56']) {
      assert.ok(app.find(n => n.type === 'Text' && n.props.accessibilityRole === 'header' && nodeText(n) === reference), 'visible draft header');
      for (const action of ['Cambiar programación', 'Cancelar publicación programada', 'Reintentar publicación programada']) {
        assert.ok(press(app, `${action}: ${reference}`), 'card-specific action');
      }
    }
    const rendered = app.nodes().map(n => [n.text, n.props?.accessibilityLabel].filter(Boolean).join(' ')).join(' ');
    for (const row of rows) assert.ok(!rendered.includes(row.draftId), 'full UUID must not be rendered');
    const containsButton = n => n.children?.some(child => child.type === 'Pressable' || containsButton(child));
    assert.equal(app.nodes().some(n => n.props?.accessible === true && containsButton(n)), false, 'parent must not swallow nested actions');
    await app.flush(() => press(app, 'Cancelar publicación programada: Borrador ABCD1234…EF56').props.onPress());
    assert.equal(calls[0].scheduleId, command, 'the second card action targets its own schedule');
    assert.ok(app.find(n => n.type === 'Text' && n.props.accessibilityRole === 'header' && nodeText(n) === 'Borrador ABCD1234…EF56'));
  } finally { await app.unmount(); }
});

const failureMessages = [
  ['provider_timeout', 'El servicio de publicación tardó demasiado en responder.'],
  ['provider_unavailable', 'El servicio de publicación no está disponible temporalmente.'],
  ['network_error', 'No se pudo conectar con el servicio de publicación.'],
  ['lease_expired', 'Se agotó el tiempo disponible para este intento.'],
  ['media_not_ready', 'Los archivos multimedia aún no están listos.'],
  ['source_missing', 'No se encontró un archivo de origen.'],
  ['source_invalid', 'Un archivo de origen no es válido.'],
  ['draft_changed', 'El borrador cambió desde que se programó.'],
  ['ownership_invalid', 'No se pudo verificar la propiedad del contenido.'],
  ['identity_conflict', 'Un archivo no coincide con el contenido programado.'],
  ['fingerprint_mismatch', 'El contenido cambió desde que se programó.'],
  ['integrity_failed', 'No se pudo verificar la integridad de los archivos.'],
  ['content_blocked', 'El contenido no se puede publicar.'],
  ['configuration_missing', 'El servicio de publicación necesita configuración.'],
  ['future_failure', 'No se pudo completar la publicación.'],
  ['SECRET_provider_detail', 'No se pudo completar la publicación.'],
  ['constructor', 'No se pudo completar la publicación.'],
];
for (const state of ['retryable_failed', 'terminal_failed']) for (const [code, message] of failureMessages) {
  test(`${state} localizes ${code} without exposing raw codes or provider text`, async () => {
    const { app } = await screen({ manager: { listPublicationSchedules: async () => ({ items: [
      { ...item, state, lastErrorCode: code, message: 'SECRET internal provider text' },
    ], nextCursor: null }) } });
    try {
      const cause = `Causa: ${message}`;
      assert.ok(app.find(n => n.type === 'Text' && nodeText(n) === cause && n.props.accessibilityLabel === cause));
      const rendered = app.nodes().map(n => [n.text, n.props?.accessibilityLabel].filter(Boolean).join(' ')).join(' ');
      assert.ok(!rendered.includes(code)); assert.ok(!rendered.includes('SECRET'));
    } finally { await app.unmount(); }
  });
}
for (const state of ['scheduled', 'claimed', 'materializing', 'publishing', 'published', 'cancelled', 'retryable_failed', 'terminal_failed']) {
  test(`${state} hides failure cause when not failed or when no code exists`, async () => {
    const { app } = await screen({ manager: { listPublicationSchedules: async () => ({ items: [
      { ...item, state, lastErrorCode: state.endsWith('_failed') ? null : 'provider_timeout' },
    ], nextCursor: null }) } });
    try {
      assert.equal(app.nodes().some(n => String(n.text ?? n.props?.accessibilityLabel ?? '').startsWith('Causa:')), false);
      assert.ok(app.find(n => n.type === 'Text' && n.props.accessibilityRole === 'header' && nodeText(n) === 'Borrador 21000000…0001'));
    } finally { await app.unmount(); }
  });
}

test('refresh fences stale initial and continuation results, aborts old requests and preserves newer server truth', async () => {
  const old = deferred(); const continuation = deferred(); const signals = []; let count = 0;
  const { app } = await screen({ manager: { listPublicationSchedules: input => {
    signals.push(input.signal); count++;
    if (count === 1) return old.promise;
    if (input.cursor) return continuation.promise;
    return Promise.resolve({ items: [{ ...item, state: 'published', postId: command }], nextCursor: { createdAt: stamp, id } });
  } } });
  try {
    assert.ok(press(app, 'Actualizar programados'));
    await app.flush(() => press(app, 'Actualizar programados').props.onPress());
    assert.equal(signals[0].aborted, true);
    old.resolve({ items: [], nextCursor: null }); await app.flush();
    assert.ok(textExists(app, 'Publicada'));
    await app.flush(() => press(app, 'Cargar más programados').props.onPress());
    await app.flush(() => press(app, 'Actualizar programados').props.onPress());
    continuation.resolve({ items: [{ ...item, id: command, state: 'terminal_failed' }], nextCursor: null }); await app.flush();
    assert.equal(textExists(app, 'Fallo definitivo'), false);
    assert.ok(textExists(app, 'Publicada'));
  } finally { old.resolve({ items: [], nextCursor: null }); continuation.resolve({ items: [], nextCursor: null }); await app.unmount(); }
});

test('account switch fences old action/list responses and clears private schedule state', async () => {
  const action = deferred(); let calls = 0;
  const { app, account } = await screen({ manager: { listPublicationSchedules: async () => ({ items: ++calls === 1 ? [item] : [], nextCursor: null }),
    cancelPublicationSchedule: () => action.promise } });
  try {
    await app.flush(() => press(app, 'Cancelar publicación programada: Borrador 21000000…0001').props.onPress());
    account.id = '26000000-0000-4000-8000-000000000001'; await app.update({});
    action.resolve({ ...item, state: 'cancelled' }); await app.flush();
    assert.ok(textExists(app, 'Sin publicaciones programadas'));
    assert.equal(textExists(app, 'Cancelada'), false);
  } finally { action.resolve(item); await app.unmount(); }
});

test('successful action leaves bounded continuation usable without requiring a refresh', async () => {
  const calls = [];
  const { app } = await screen({ manager: { listPublicationSchedules: async input => {
    calls.push(input);
    return input.cursor ? { items: [{ ...item, id: command }], nextCursor: null }
      : { items: [item], nextCursor: { createdAt: stamp, id } };
  } } });
  try {
    await app.flush(() => press(app, 'Cancelar publicación programada: Borrador 21000000…0001').props.onPress());
    await app.flush(() => press(app, 'Cargar más programados').props.onPress());
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].cursor, { createdAt: stamp, id });
    assert.ok(textExists(app, 'Cancelada')); assert.ok(textExists(app, 'Programada'));
  } finally { await app.unmount(); }
});

test('continuation errors keep the page and retry exactly one cursor despite duplicate presses', async () => {
  const gate = deferred(); const calls = []; let retry = false;
  const { app } = await screen({ manager: { listPublicationSchedules: async input => {
    calls.push(input);
    if (!input.cursor) return { items: [item], nextCursor: { createdAt: stamp, id } };
    if (!retry) { await gate.promise; throw new Error('SECRET'); }
    return { items: [{ ...item, id: command }], nextCursor: null };
  } } });
  try {
    await app.flush(() => { const button = press(app, 'Cargar más programados'); button.props.onPress(); button.props.onPress(); });
    assert.equal(calls.length, 2);
    gate.resolve(); await app.flush();
    assert.ok(textExists(app, 'Programada')); assert.equal(textExists(app, 'Sin publicaciones programadas'), false);
    retry = true; await app.flush(() => press(app, 'Cargar más programados').props.onPress());
    assert.deepEqual(calls[1].cursor, calls[2].cursor);
    assert.equal(press(app, 'Cargar más programados'), undefined);
  } finally { gate.resolve(); await app.unmount(); }
});

test('an old account list response cannot replace the current account empty result', async () => {
  const old = deferred(); let calls = 0;
  const { app, account } = await screen({ manager: { listPublicationSchedules: async () => {
    return ++calls === 1 ? old.promise : { items: [], nextCursor: null };
  } } });
  try {
    account.id = command; await app.update({});
    old.resolve({ items: [item], nextCursor: null }); await app.flush();
    assert.ok(textExists(app, 'Sin publicaciones programadas'));
    assert.equal(textExists(app, 'Programada'), false);
  } finally { old.resolve({ items: [], nextCursor: null }); await app.unmount(); }
});

test('explicit null offset is required in returned projections instead of silently accepting undefined', async () => {
  const { api } = await service(() => ({ data: { ...row, utc_offset_minutes: undefined }, error: null }));
  await assert.rejects(api.cancelPublicationSchedule(mutation), errorCode('invalid_response'));
});

test('leaving a tab during an uncertain action exposes exact-command reconciliation on return', async () => {
  const gate = deferred(); const calls = [];
  const { app } = await screen({ tab: 'drafts', manager: { schedulePublicationDraft: input => {
    calls.push(input); return calls.length === 1 ? gate.promise : Promise.resolve(item);
  } } });
  try {
    await app.flush(() => press(app, 'Programar borrador').props.onPress());
    await app.flush(() => app.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Fecha y hora local').props.onChangeText('2027-01-01T12:00'));
    await app.flush(() => press(app, 'Confirmar programación').props.onPress());
    await app.flush(() => press(app, 'Programados').props.onPress());
    assert.equal(calls[0].signal.aborted, true);
    assert.ok(press(app, 'Reintentar acción de programación'));
    await app.flush(() => press(app, 'Reintentar acción de programación').props.onPress());
    assert.equal(calls[0].clientCommandId, calls[1].clientCommandId);
    gate.resolve(item); await app.flush();
  } finally { gate.resolve(item); await app.unmount(); }
});

test('an older command response never downgrades a fresher schedule revision from refresh', async () => {
  const gate = deferred(); let reads = 0;
  const { app } = await screen({ manager: { listPublicationSchedules: async () => ({ items: [++reads === 1 ? item
    : { ...item, revision: 5, state: 'published', postId: command }], nextCursor: null }),
    cancelPublicationSchedule: () => gate.promise,
  } });
  try {
    await app.flush(() => press(app, 'Cancelar publicación programada: Borrador 21000000…0001').props.onPress());
    await app.flush(() => press(app, 'Actualizar programados').props.onPress());
    gate.resolve({ ...item, revision: 4, state: 'cancelled' }); await app.flush();
    assert.ok(textExists(app, 'Publicada')); assert.equal(textExists(app, 'Cancelada'), false);
  } finally { gate.resolve(item); await app.unmount(); }
});

test('scheduled tab transitions preserve B1 draft loading behavior instead of starting unrelated reloads', async () => {
  let drafts = 0;
  const { app } = await screen({ tab: 'drafts', manager: {
    listPublicationDrafts: async () => { drafts++; return { items: [draft], nextCursor: null }; },
  } });
  try {
    assert.equal(drafts, 1);
    await app.flush(() => press(app, 'Programados').props.onPress());
    await app.flush(() => press(app, 'Borradores').props.onPress());
    assert.equal(drafts, 1);
  } finally { await app.unmount(); }
});

const assetRejections = [
  { serverMessage: 'publication_asset_set_invalid', sqlCode: '22023', code: 'invalid_input', message: 'Revisa los datos de programación.' },
  { serverMessage: 'publication_asset_not_ready_or_owned', sqlCode: '42501', code: 'forbidden', message: 'Esta publicación no está disponible en tu cuenta.' },
];
for (const rejection of assetRejections) {
  test(`${rejection.serverMessage} is a sanitized definitive service rejection`, async () => {
    const { api, calls } = await service(() => ({ error: {
      code: rejection.sqlCode, message: rejection.serverMessage,
      details: 'SECRET private asset locator', hint: 'SECRET provider data',
    } }));
    await assert.rejects(api.schedulePublicationDraft({ draftId: id, expectedRevision: 2, clientCommandId: command, ...time }), error => {
      assert.equal(error.code, rejection.code);
      assert.equal(error.message, rejection.message);
      assert.equal(error.outcomeKnown, true);
      assert.equal(error.details, undefined); assert.equal(error.hint, undefined); assert.equal(error.cause, undefined);
      assert.equal(JSON.stringify(error).includes('SECRET'), false);
      assert.equal(String(error).includes(rejection.serverMessage), false);
      return true;
    });
    assert.equal(calls.length, 1, 'definitive rejection must not trigger an automatic replay');
  });

  test(`${rejection.serverMessage} releases the UI command and permits a new intent without duplicate RPCs`, async () => {
    let responses = 0;
    const { api, calls } = await service(() => ++responses === 1
      ? { error: { code: rejection.sqlCode, message: rejection.serverMessage, details: 'SECRET', hint: 'SECRET' } }
      : { data: row, error: null });
    const { app } = await screen({ tab: 'drafts', manager: { schedulePublicationDraft: api.schedulePublicationDraft } });
    const localInput = () => app.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Fecha y hora local');
    try {
      await app.flush(() => press(app, 'Programar borrador').props.onPress());
      await app.flush(() => localInput().props.onChangeText('2027-01-01T12:00'));
      await app.flush(() => {
        const confirm = press(app, 'Confirmar programación'); confirm.props.onPress(); confirm.props.onPress();
      });
      assert.equal(calls.length, 1);
      assert.equal(Boolean(press(app, 'Reintentar acción de programación')), false, 'a rejected command must be released');
      assert.equal(localInput().props.editable, true);
      for (const label of ['Confirmar programación','Cerrar editor de programación','Programar borrador']) {
        assert.equal(press(app, label).props.disabled, false, `${label} must be usable after rejection`);
      }
      assert.equal(textExists(app, 'SECRET'), false);
      assert.equal(textExists(app, rejection.serverMessage), false);
      await app.flush(() => press(app, 'Cerrar editor de programación').props.onPress());
      assert.equal(Boolean(localInput()), false);
      assert.equal(calls.length, 1, 'closing the rejected editor must not replay the RPC');
      await app.flush(() => press(app, 'Programar borrador').props.onPress());
      await app.flush(() => localInput().props.onChangeText('2027-01-02T12:00'));
      await app.flush(() => {
        const confirm = press(app, 'Confirmar programación'); confirm.props.onPress(); confirm.props.onPress();
      });
      assert.equal(calls.length, 2, 'each explicit intent issues one RPC despite same-turn double presses');
      assert.notEqual(calls[1].args.p_client_command_id, calls[0].args.p_client_command_id);
      assert.equal(calls[0].args.p_local_scheduled_at, '2027-01-01T12:00');
      assert.equal(calls[1].args.p_local_scheduled_at, '2027-01-02T12:00');
      assert.equal(Boolean(localInput()), false, 'the new successful intent closes the editor');
    } finally { await app.unmount(); }
  });
}

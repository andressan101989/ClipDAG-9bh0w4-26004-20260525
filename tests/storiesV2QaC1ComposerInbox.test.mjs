import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { randomUUID } from 'node:crypto';
import { mount } from './helpers/storyQaHostRenderer.mjs';
import { loadStoryQaComponent } from './helpers/loadStoryQaComponent.mjs';
import { storyQaModuleUrl } from './helpers/loadStoryQaModule.mjs';

const actor = '20000000-0000-4000-8000-000000000001';
const respondent = '20000000-0000-4000-8000-000000000002';
const storyId = '30000000-0000-4000-8000-000000000001';
const elementId = '30000000-0000-4000-8000-000000000002';
const secondId = '30000000-0000-4000-8000-000000000003';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const geometry = storyQaModuleUrl('components/feature/storyStageGeometry.ts');
const runtime = storyQaModuleUrl('components/feature/storyViewerRuntime.ts');
const adapter = storyQaModuleUrl('services/storyQuestionHandoff.ts', { 'expo-crypto': data("export {randomUUID} from 'node:crypto';") });
const shared = (await import(adapter)).storyQuestionHandoffs;
const base = () => ({
  StyleSheet: { create: x => x, absoluteFill: {}, absoluteFillObject: {} },
  Platform: { OS: 'ios' }, Keyboard: { dismiss() {} },
  PanResponder: { create: handlers => ({ panHandlers: handlers }) },
  useSafeAreaInsets: () => ({ top: 21, bottom: 17, left: 3, right: 4 }),
  Colors: {}, FontSize: {}, FontWeight: {}, Radius: {}, Spacing: {}, randomUUID,
  FlatList: props => React.createElement('FlatList', props, props.data.length ? props.data.map((item, index) => React.createElement(React.Fragment, { key: item.respondentId }, props.renderItem({ item, index }))) : props.ListEmptyComponent, props.ListFooterComponent),
});
const element = (id = elementId) => ({ elementId: id, revision: 1, definition: { type: 'question', prompt: 'Pregunta' }, response: null, aggregate: null, correctOptionId: null });
const placement = id => ({ id: randomUUID(), type: 'interactive', element_id: id, x: .5, y: .5, scale: 1, rotation: 30 });
const row = (id = respondent, moderationState = 'pending') => ({ respondentId: id, moderationState, payload: { text: 'Texto privado cacheado' }, createdAt: '2026-10-29T00:00:00Z' });
const page = (responses = [row()], hasMore = false) => ({ responses, aggregate: { total: responses.length }, analytics: {}, hasMore, nextCursor: hasMore ? { createdAt: '2026-10-29T00:00:00Z', respondentId: respondent } : null });
const press = (app, label) => app.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === label)?.props.onPress();
const input = app => app.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Tu respuesta privada');
const text = app => app.nodes().map(n => n.text ?? '').join(' ');
async function layerFixture(overrides = {}, fixture = base()) {
  const { StoryInteractiveLayer } = await loadStoryQaComponent('components/feature/StoryInteractiveLayer.tsx', fixture, {
    './storyViewerRuntime': runtime, './storyStageGeometry': geometry,
    './StoryInteractiveResultsSheet': data("export const StoryInteractiveResultsSheet='Results';"),
  });
  const props = { storyId, actorId: respondent, visible: true, composition: { version: 2, elements: [placement(elementId), placement(secondId)] }, width: 390, height: 844,
    safeInsets: { top: 90, bottom: 140, left: 0, right: 0 }, isOwner: false, revision: 1,
    onInteractionFocus() {}, onQuestionComposerActiveChange() {}, onLoadState: async () => ({ storyId, elements: [element(), element(secondId)] }),
    onRespond: async () => {}, onLoadResults: async () => page(), onModerateQuestion: async () => 'hidden', ...overrides };
  return { Component: StoryInteractiveLayer, props, app: await mount(StoryInteractiveLayer, props) };
}

// Break caught: inline/transformed input or revision reset loses the sole modal draft and attempt.
test('Layer owns one keyboard-safe modal; rejection/revision/transient refresh preserve draft and exact attempt, double-send is fenced', async () => {
  const sends = [], ownership = []; let readsFail = false, dismisses = 0;
  const fixture = base(); fixture.Keyboard.dismiss = () => { dismisses++; };
  const { app, props } = await layerFixture({ onQuestionComposerActiveChange: v => ownership.push(v), onLoadState: async () => { if (readsFail) throw Error('offline'); return { storyId, elements: [element(), element(secondId)] }; }, onRespond: async (...args) => { sends.push(args); throw Error('uncertain'); } }, fixture);
  try {
    assert.equal(input(app), undefined, 'no question input inside transformed cards');
    const openers = app.nodes().filter(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Responder pregunta');
    assert.equal(openers.length, 2, 'each unanswered card opens the single composer');
    await app.flush(() => { openers[0].props.onPress(); openers[1].props.onPress(); });
    assert.ok(input(app));
    assert.equal(app.nodes().filter(n => n.type === 'Modal' && n.props.visible).length, 1);
    const modal = app.find(n => n.type === 'Modal');
    assert.equal(modal.props.presentationStyle, 'fullScreen');
    assert.equal(typeof modal.props.onShow, 'function');
    let focuses = 0; input(app).focus = () => { focuses++; };
    modal.props.onShow(); assert.equal(focuses, 1, 'onShow focuses the actual input ref');
    assert.equal(input(app).props.autoFocus, true);
    assert.equal(input(app).props.maxLength, 500);
    assert.equal(input(app).props.onBlur, undefined, 'keyboard blur never retires ownership');
    const kav = app.find(n => n.type === 'KeyboardAvoidingView');
    assert.equal(kav.props.behavior, 'padding');
    assert.equal(kav.props.keyboardVerticalOffset, undefined);
    assert.equal(app.find(n => n.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
    assert.deepEqual(app.find(n => n.type === 'ScrollView').props.contentContainerStyle[1], { paddingTop: 37, paddingBottom: 33, paddingLeft: 19, paddingRight: 20 });
    assert.equal(kav.props.style.flex, 1);
    assert.equal(app.find(n => n.type === 'ScrollView').props.contentContainerStyle[0].flexGrow, 1);
    const ancestors = (node, target, path = []) => node === target ? path : node.children?.map(child => ancestors(child, target, [...path, node])).find(Boolean);
    const inputAncestors = app.nodes().filter(n => n.type === 'View' && n.props.pointerEvents === 'box-none').map(root => ancestors(root, input(app))).find(Boolean);
    assert.ok(inputAncestors.some(n => n.type === 'Modal'));
    assert.equal(inputAncestors.some(n => n.props.style?.some?.(s => s?.transform)), false, 'question input is outside transformed placement ancestors');
    await app.flush(() => input(app).props.onChangeText(' Mi respuesta '));
    await app.flush(() => { press(app, 'Enviar respuesta privada'); press(app, 'Enviar respuesta privada'); });
    assert.equal(sends.length, 1);
    assert.equal(sends[0][1], elementId, 'second opener cannot replace the active question');
    assert.deepEqual(sends[0][3], { text: 'Mi respuesta' });
    assert.equal(input(app).props.value, ' Mi respuesta ');
    assert.match(text(app), /No se pudo/);
    await app.update({ ...props, revision: 2 });
    readsFail = true;
    await app.update({ ...props, revision: 3 });
    assert.equal(input(app).props.value, ' Mi respuesta ');
    await app.flush(() => press(app, 'Enviar respuesta privada'));
    assert.equal(sends[1][2], sends[0][2]);
    await app.flush(() => input(app).props.onChangeText('Otra respuesta'));
    await app.flush(() => press(app, 'Enviar respuesta privada'));
    assert.notEqual(sends[2][2], sends[0][2]);
    const beforeCancel = dismisses;
    await app.flush(() => modal.props.onRequestClose());
    assert.equal(input(app), undefined);
    assert.equal(dismisses, beforeCancel + 1, 'cancel itself dismisses the keyboard');
    assert.equal(ownership.at(-1), false);
  } finally { await app.unmount(); }
});

test('Layer authoritative invalidation and true lifecycle retire private modal; late success/finally cannot clear a replacement', async () => {
  const first = deferred(), second = deferred(); let count = 0, elements = [element(), element(secondId)];
  const { app, props } = await layerFixture({ onLoadState: async () => ({ storyId, elements }), onRespond: () => (++count === 1 ? first.promise : second.promise) });
  try {
    const open = index => app.nodes().filter(n => n.props?.accessibilityLabel === 'Responder pregunta')[index].props.onPress();
    await app.flush(() => open(0)); await app.flush(() => input(app).props.onChangeText('Viejo'));
    await app.flush(() => press(app, 'Enviar respuesta privada'));
    await app.flush(() => press(app, 'Cancelar respuesta privada'));
    await app.flush(() => open(1)); await app.flush(() => input(app).props.onChangeText('Nuevo'));
    await app.flush(() => press(app, 'Enviar respuesta privada'));
    await app.flush(() => first.resolve());
    assert.equal(input(app).props.value, 'Nuevo'); assert.equal(input(app).props.editable, false);
    await app.flush(() => second.reject(Error('offline')));
    elements = [element()]; await app.update({ ...props, revision: 2 });
    assert.equal(input(app), undefined, 'successful authority removal closes the composer');
    await app.flush(() => open(0)); await app.flush(() => input(app).props.onChangeText('Privado'));
    await app.update({ ...props, actorId: actor }); assert.equal(input(app), undefined);
    await app.flush(() => open(0)); await app.update({ ...props, visible: false }); assert.equal(input(app), undefined);
  } finally { await app.unmount(); }
});

test('actual StoryInteractions retains uncertain canonical reply identity and draft while no rail content is rendered', async () => {
  const calls = []; const fixture = base(); fixture.createChatClientMessageId = randomUUID;
  const { StoryInteractions } = await loadStoryQaComponent('components/feature/StoryInteractions.tsx', fixture, { './storyReactions': storyQaModuleUrl('components/feature/storyReactions.ts') });
  const props = { username: 'creator', selectedReaction: null, reactionPending: false, onReaction: async () => {}, onReactionEffect() {}, onFocusChange() {}, onReply: async (...args) => { calls.push(args); throw Error('uncertain'); } };
  const app = await mount(StoryInteractions, props);
  try {
    await app.flush(() => app.find(n => n.type === 'TextInput').props.onChangeText('Draft'));
    await app.flush(() => press(app, 'Enviar respuesta'));
    await app.update({ ...props, hidden: true });
    assert.equal(app.nodes().length, 0, 'hidden state owner renders no wrapper/input/reactions');
    await app.update(props);
    assert.equal(app.find(n => n.type === 'TextInput').props.value, 'Draft');
    await app.flush(() => press(app, 'Enviar respuesta'));
    assert.equal(calls.length, 2); assert.equal(calls[1][1], calls[0][1]);
  } finally { await app.unmount(); }
});

async function resultsFixture(overrides = {}, fixture = base()) {
  const { StoryInteractiveResultsSheet } = await loadStoryQaComponent('components/feature/StoryInteractiveResultsSheet.tsx', fixture);
  const props = { visible: true, storyId, element: element(), revision: 1, onClose() {}, onLoad: async () => page(), onModerate: async () => 'hidden', onReply: async () => {}, ...overrides };
  const app = await mount(StoryInteractiveResultsSheet, props);
  const renderRow = (id = respondent) => {
    const list = app.find(n => n.type === 'FlatList'); const item = list?.props.data.find(r => r.respondentId === id);
    return item ? list.props.renderItem({ item, index: 0 }) : null;
  };
  // Execute the actual row renderer in the same React tree, including its action closures.
  const action = (label, id) => {
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (node.props?.accessibilityLabel === label) return node.props;
      for (const child of React.Children.toArray(node.props?.children)) { const found = visit(child); if (found) return found; }
    };
    return visit(renderRow(id));
  };
  return { app, props, action };
}

test('Results retains rows/page/errors and same-row action fence across revisions; stale page cannot resurrect a hidden response', async () => {
  const hide = deferred(), refresh = deferred(), replies = []; let loads = 0, hides = 0;
  const { app, props, action } = await resultsFixture({ onLoad: () => ++loads === 1 ? Promise.resolve(page([row()], true)) : refresh.promise,
    onModerate: () => { hides++; return hide.promise; }, onReply: async (...args) => { replies.push(args); } });
  try {
    assert.ok(action('Responder en historia'));
    await app.flush(() => { action('Ocultar respuesta 1').onPress(); action('Responder por privado').onPress(); });
    assert.equal(hides, 1); assert.equal(replies.length, 0);
    await app.update({ ...props, element: { ...element(), revision: 2 }, revision: 2 });
    assert.equal(app.find(n => n.type === 'FlatList').props.data.length, 1);
    assert.equal(action('Responder en historia').disabled, true);
    await app.flush(() => hide.resolve('hidden'));
    await app.flush(() => refresh.resolve(page([row()], true)));
    assert.equal(app.find(n => n.type === 'FlatList').props.data[0].moderationState, 'hidden');
    assert.equal(action('Responder en historia'), undefined);
  } finally { await app.unmount(); }
});

test('Results passes current pending-row validator to reply, ignores stale actions and scopes safe retry error per row', async () => {
  const reply = deferred(), calls = []; let responses = [row(), row(actor, 'blocked')];
  const { app, props, action } = await resultsFixture({ onLoad: async () => page(responses), onReply: (...args) => { calls.push(args); return reply.promise; } });
  try {
    assert.equal(action('Responder por privado', actor), undefined);
    await app.flush(() => { action('Responder por privado').onPress(); action('Responder en historia').onPress(); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'chat');
    assert.deepEqual(calls[0][1], { storyId, elementId, respondentId: respondent });
    assert.equal(calls[0][2](), true);
    responses = [row(respondent, 'hidden')]; await app.update({ ...props, revision: 2 });
    assert.equal(calls[0][2](), false);
    await app.flush(() => reply.reject(Error('private backend text')));
    assert.doesNotMatch(text(app), /private backend text/);
    await app.update({ ...props, visible: false }); assert.equal(calls[0][2](), false);
  } finally { await app.unmount(); }
});

async function viewerFixture(native, overrides = {}, options = {}) {
  const animations = [], pans = [], values = [], routes = [], order = [], helperCalls = [];
  class Value {
    constructor(value) { this.value = value; values.push(this); }
    setValue(value) { this.value = value; }
    stopAnimation(callback) { callback?.(this.value); }
    interpolate() { return this.value; }
  }
  const fixture = { ...base(),
    Platform: { OS: options.android ? 'android' : options.web ? 'web' : 'ios' },
    Animated: { Value, View: 'AnimatedView', timing: (value, config) => ({ start: callback => animations.push({ value, config, callback }) }), spring: value => ({ start() { value.setValue(0); } }) },
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    PanResponder: { create: handlers => { pans.push(handlers); return { panHandlers: handlers }; } },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    useRouter: () => ({ push: route => { order.push('navigate'); routes.push(route); } }),
    useStoryMediaUrl: () => ({ url: 'fixture-photo', isLoading: false, hasError: false, retry() {}, fail() {} }),
    StoryCompositionOverlay: 'Overlay', StoryViewersSheet: 'Viewers', StoryReactionEffect: 'Effect',
  };
  if (options.animatedWeb) {
    const animation = await import(storyQaModuleUrl('node_modules/react-native-web/dist/exports/Modal/ModalAnimation.js', {
      react: new URL('../node_modules/react/index.js', import.meta.url).href,
      '../StyleSheet': data('export default {create: styles=>styles};'),
      '../createElement': data(`import React from '${new URL('../node_modules/react/index.js', import.meta.url).href}';export default React.createElement;`),
    }));
    fixture.Modal = animation.default;
  }
  globalThis.__qaComposerHelperCalls = helperCalls;
  const helper = data(`import {getStoryQuestionComposerState as real} from '${new URL('../components/feature/storyQuestionComposerRuntime.mjs', import.meta.url).href}';export function getStoryQuestionComposerState(active){globalThis.__qaComposerHelperCalls.push(active);return real(active);}`);
  let actual = { './storyViewerRuntime': runtime, './storyStageGeometry': geometry,
    './storyQuestionComposerRuntime.mjs': helper, '@/services/storyQuestionHandoff': adapter };
  const hook = storyQaModuleUrl('components/feature/useStoryQuestionInbox.ts', { react: new URL('../node_modules/react/index.js', import.meta.url).href, '@/services/storyQuestionHandoff': adapter });
  if (hook) actual['./useStoryQuestionInbox'] = hook;
  if (options.integrated) {
    const results = await loadStoryQaComponent('components/feature/StoryInteractiveResultsSheet.tsx', fixture);
    fixture.StoryInteractiveResultsSheet = results.StoryInteractiveResultsSheet;
    const layer = await loadStoryQaComponent('components/feature/StoryInteractiveLayer.tsx', fixture, { './storyViewerRuntime': runtime, './storyStageGeometry': geometry });
    fixture.StoryInteractiveLayer = layer.StoryInteractiveLayer;
  }
  const interaction = await loadStoryQaComponent('components/feature/StoryInteractions.tsx', { ...fixture, createChatClientMessageId: randomUUID }, { './storyReactions': storyQaModuleUrl('components/feature/storyReactions.ts') });
  fixture.StoryInteractions = interaction.StoryInteractions;
  const { StoryViewer } = await loadStoryQaComponent(`components/feature/StoryViewer${native ? '.native' : ''}.tsx`, fixture, actual);
  const props = { visible: true, currentUserId: actor,
    storyGroup: { username: 'owner', userId: respondent, stories: [{ id: storyId, userId: respondent, mediaType: 'photo', storyKind: 'media', createdAt: '2026-10-29T00:00:00Z', composition: { version: 2, elements: [placement(elementId)] } }] },
    onClose: () => order.push('close'), onSetReaction: async () => {}, onReplyToStory: async () => {},
    onGetInteractiveState: async () => ({ storyId, elements: [element()] }), onRespondToInteractiveElement: async () => {},
    onGetInteractiveResults: async () => page(), onModerateInteractiveQuestion: async () => 'hidden',
    onPrepareStoryQuestionAnswer: async source => ({ question: 'Texto canónico', respondentId: source.respondentId }), ...overrides };
  return { app: await mount(StoryViewer, props), props, animations, pans, values, routes, order, helperCalls };
}

for (const native of [false, true]) {
  const platform = native ? 'native' : 'web';
  test(`${platform} viewer keeps separate React identities for existing reply and interactive layer`, async () => {
    const errors = [], original = console.error; let v;
    console.error = (...args) => errors.push(args.join(' '));
    try { v = await viewerFixture(native); assert.doesNotMatch(errors.join(' '), /same key/); }
    finally { if (v) await v.app.unmount(); console.error = original; }
  });
  test(`${platform} actual viewer uses ownership helper, hides whole rail, blocks queued completion/tap/long-press/pan and restores existing pause`, async () => {
    const v = await viewerFixture(native); const { app } = v;
    try {
      await app.flush(() => app.find(n => n.type === 'Image').props.onLoad());
      const queuedCompletion = v.animations.find(a => a.config.toValue === 1).callback;
      v.values[0].value = .4;
      const pan = v.pans[0];
      await app.flush(() => pan.onPanResponderMove(null, { dy: 45, dx: 0 }));
      const layer = () => app.find(n => n.type === 'StoryInteractiveLayer');
      assert.equal(typeof layer().props.onQuestionComposerActiveChange, 'function');
      await app.flush(() => app.find(n => n.type === 'TextInput').props.onChangeText('Retained draft'));
      await app.flush(() => layer().props.onQuestionComposerActiveChange(true));
      await app.flush(() => layer().props.onInteractionFocus(false));
      assert.ok(v.helperCalls.includes(true), 'actual Task-1 helper runs from the viewer');
      assert.equal(app.find(n => n.type === 'TextInput'), undefined, 'whole existing rail renders no input');
      assert.equal(app.find(n => n.props?.style?.[0]?.position === 'absolute' && n.props?.style?.[0]?.zIndex === 20), undefined, 'rail wrapper is absent');
      const tap = app.nodes().find(n => n.type === 'Pressable' && n.props.delayLongPress);
      const before = v.animations.length;
      await app.flush(() => {
        queuedCompletion({ finished: true }); tap.props.onPress(); tap.props.onLongPress();
        assert.equal(pan.onMoveShouldSetPanResponder(null, { dy: 200, dx: 0 }), false);
        pan.onPanResponderMove(null, { dy: 200, dx: 0 }); pan.onPanResponderRelease(null, { dy: 200, dx: 0 });
      });
      assert.deepEqual(v.order, []); assert.equal(v.animations.length, before);
      assert.equal(v.values[1].value, 0, 'pre-open swipe is reset');
      await app.flush(() => layer().props.onQuestionComposerActiveChange(false));
      assert.ok(app.find(n => n.type === 'TextInput'));
      assert.equal(app.find(n => n.type === 'TextInput').props.value, 'Retained draft');
      assert.ok(v.animations.length > before, 'playback resumes from prior progress after ownership releases');
      assert.equal(v.animations.at(-1).config.duration, 9000, 'photo resumes the remaining progress instead of restarting');
      // A separate existing pause cause remains paused when the modal releases.
      await app.flush(() => tap.props.onLongPress());
      await app.flush(() => layer().props.onQuestionComposerActiveChange(true));
      const held = v.animations.length;
      await app.flush(() => layer().props.onQuestionComposerActiveChange(false));
      assert.equal(v.animations.length, held);
    } finally { await app.unmount(); }
  });

  test(`${platform} actual question opener exclusively hides a pending canonical reply, preserves its uncertain retry and tears down when invisible`, async () => {
    const pending = deferred(), calls = [];
    const v = await viewerFixture(native, { onReplyToStory: (...args) => { calls.push(args); return calls.length === 1 ? pending.promise : Promise.reject(Error('uncertain')); } }, { integrated: true, web: !native });
    const { app } = v;
    try {
      const general = () => app.find(n => n.type === 'TextInput' && n.props.accessibilityLabel === 'Responder a owner');
      await app.flush(() => { general().props.onFocus(); general().props.onChangeText('Mi borrador'); });
      assert.ok(general(), 'general reply focus does not hide its own rail');
      await app.flush(() => press(app, 'Enviar respuesta'));
      await app.flush(() => press(app, 'Responder pregunta'));
      assert.equal(general(), undefined); assert.ok(input(app));
      await app.flush(() => pending.reject(Error('uncertain')));
      assert.equal(general(), undefined); assert.ok(input(app));
      await app.flush(() => press(app, 'Cancelar respuesta privada'));
      assert.equal(general().props.value, 'Mi borrador');
      await app.flush(() => press(app, 'Enviar respuesta'));
      assert.equal(calls.length, 2); assert.equal(calls[1][2], calls[0][2]);
      await app.flush(() => press(app, 'Responder pregunta'));
      await app.update({ ...v.props, visible: false }); assert.equal(input(app), undefined);
    } finally { await app.unmount(); }
  });

  test(`${platform} actual inbox coordinator preflights, issues shared singleton once and waits for both deterministic dismissals before exact route`, async () => {
    const calls = [], first = deferred(), second = deferred(), dismissed = deferred(); let count = 0;
    const v = await viewerFixture(native, { currentUserId: respondent, onPrepareStoryQuestionAnswer: source => { calls.push(source); return ++count === 1 ? first.promise : second.promise; } });
    const { app } = v;
    try {
      const layer = app.find(n => n.type === 'StoryInteractiveLayer');
      assert.equal(typeof layer.props.onQuestionReply, 'function');
      const source = { storyId, elementId, respondentId: actor };
      let one, two;
      await app.flush(() => {
        one = layer.props.onQuestionReply('story', source, () => true, () => { v.order.push('results-dismiss'); return dismissed.promise; });
        two = layer.props.onQuestionReply('chat', { ...source, respondentId: secondId }, () => true, async () => true).catch(() => {});
      });
      assert.deepEqual(calls[0], source); assert.deepEqual(v.order, []);
      await app.flush(() => first.resolve({ question: 'Servidor autoritativo', respondentId: actor }));
      await app.flush(() => second.resolve({ question: 'Otro', respondentId: secondId })); await two;
      assert.deepEqual(v.order, ['results-dismiss']); assert.equal(v.routes.length, 0);
      await app.flush(() => app.find(n => n.type === 'Modal').props.onDismiss());
      assert.equal(v.routes.length, 0, 'an old dismissal event cannot navigate before results actually dismiss');
      await app.flush(() => dismissed.resolve(true)); await one;
      const modal = app.find(n => n.type === 'Modal');
      assert.equal(modal.props.visible, false); assert.equal(v.routes.length, 0);
      await app.flush(() => { modal.props.onDismiss(); modal.props.onDismiss(); });
      assert.deepEqual(v.order, ['results-dismiss', 'close', 'navigate']);
      assert.equal(v.routes.length, 1); assert.equal(v.routes[0].pathname, '/(tabs)');
      assert.deepEqual(Object.keys(v.routes[0].params), ['handoffToken']);
      const { StoryQuestionFeedSession } = await import(storyQaModuleUrl('services/storyQuestionIntegrationRuntime.ts'));
      const feed = new StoryQuestionFeedSession(shared, randomUUID); feed.setActor(respondent);
      assert.equal(feed.receive(v.routes[0].params.handoffToken, respondent, true, false).status, 'ready');
      assert.deepEqual(feed.reply.source, source); assert.equal(feed.reply.question, 'Servidor autoritativo');
      assert.equal(feed.receive(v.routes[0].params.handoffToken, respondent, true, false).status, 'duplicate');
    } finally { await app.unmount(); }
  });

  test(`${platform} actual Layer → pending Results → canonical preflight → shared Chat draft waits for modal dismissal and never sends`, async () => {
    const calls = []; let sends = 0;
    const v = await viewerFixture(native, { currentUserId: respondent,
      onGetInteractiveResults: async () => page([row(actor)]),
      onReplyToStory: async () => { sends++; }, onRespondToInteractiveElement: async () => { sends++; },
      onPrepareStoryQuestionAnswer: async source => { calls.push(source); return { question: 'Texto del servidor', respondentId: source.respondentId }; } }, { integrated: true, web: !native });
    const { app } = v;
    try {
      await app.flush(() => press(app, 'Ver respuestas privadas'));
      assert.ok(app.find(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Responder por privado'));
      await app.flush(() => press(app, 'Responder por privado'));
      assert.deepEqual(calls, [{ storyId, elementId, respondentId: actor }]);
      assert.equal(sends, 0);
      {
        assert.equal(v.routes.length, 0);
        const modals = app.nodes().filter(n => n.type === 'Modal');
        assert.equal(modals[0].props.visible, true, 'outer viewer stays presented while inner results dismiss');
        assert.equal(modals[1].props.visible, false);
        await app.flush(() => modals[1].props.onDismiss());
        assert.equal(v.routes.length, 0);
        assert.equal(app.find(n => n.type === 'Modal').props.visible, false);
        await app.flush(() => app.find(n => n.type === 'Modal').props.onDismiss());
      }
      assert.deepEqual(v.order, ['close', 'navigate']); assert.equal(v.routes.length, 1);
      assert.equal(v.routes[0].pathname, '/chat/[userId]');
      assert.deepEqual(Object.keys(v.routes[0].params).sort(), ['handoffToken', 'userId']);
      assert.equal(v.routes[0].params.userId, actor);
      assert.doesNotMatch(JSON.stringify(v.routes[0]), /Texto|storyId|elementId|respondentId/);
      const { StoryQuestionChatDraftSession } = await import(storyQaModuleUrl('services/storyQuestionIntegrationRuntime.ts'));
      const chat = new StoryQuestionChatDraftSession(shared); chat.setIdentity(respondent, actor);
      assert.deepEqual(chat.receive(v.routes[0].params.handoffToken, respondent, actor, '', false), { status: 'ready', text: 'Texto del servidor' });
      assert.deepEqual(chat.receive(v.routes[0].params.handoffToken, respondent, actor, '', false), { status: 'duplicate' });
      assert.equal(sends, 0);
    } finally { await app.unmount(); }
  });

  test(`${platform} inbox rejects stale actor/story/owner/visibility/row, malformed or mismatched preflight, token refusal and transition-lock refusal`, async () => {
    for (const scenario of ['actor', 'story', 'owner', 'hidden', 'row', 'mismatch', 'malformed', 'bad-text', 'preflight-failure', 'transition']) {
      const prepared = deferred(); let rowCurrent = true, dismissed = 0;
      const v = await viewerFixture(native, { currentUserId: respondent, onPrepareStoryQuestionAnswer: () => prepared.promise });
      const { app } = v;
      try {
        const handler = app.find(n => n.type === 'StoryInteractiveLayer').props.onQuestionReply;
        const source = { storyId, elementId, respondentId: actor };
        let action;
        await app.flush(() => { action = handler('story', source, () => rowCurrent, async () => { dismissed++; return true; }).then(() => false, () => true); });
        if (scenario === 'actor') await app.update({ ...v.props, currentUserId: actor });
        if (scenario === 'story') await app.update({ ...v.props, storyGroup: { ...v.props.storyGroup, stories: [{ ...v.props.storyGroup.stories[0], id: secondId }] } });
        if (scenario === 'owner') await app.update({ ...v.props, storyGroup: { ...v.props.storyGroup, stories: [{ ...v.props.storyGroup.stories[0], userId: actor }] } });
        if (scenario === 'hidden') await app.update({ ...v.props, visible: false });
        if (scenario === 'row') rowCurrent = false;
        if (scenario === 'transition') await app.flush(() => press(app, 'Cerrar historia'));
        await app.flush(() => {
          if (scenario === 'preflight-failure') prepared.reject(Error('private raw error'));
          else prepared.resolve({ question: scenario === 'bad-text' ? '<private>' : 'Canónica', respondentId: scenario === 'mismatch' ? secondId : actor, ...(scenario === 'malformed' ? { secret: 'no' } : {}) });
        });
        assert.equal(await action, true, scenario);
        assert.equal(dismissed, 0, scenario); assert.equal(v.routes.length, 0, scenario);
        assert.deepEqual(v.order, scenario === 'transition' ? ['close'] : [], scenario);
      } finally { await app.unmount(); }
    }
  });

  test(`${platform} absent optional preflight preserves ordinary B1 controls and exposes no private reply action`, async () => {
    const v = await viewerFixture(native, { currentUserId: respondent, onPrepareStoryQuestionAnswer: undefined }, { integrated: true });
    try {
      await v.app.flush(() => press(v.app, 'Ver respuestas privadas'));
      assert.ok(v.app.find(n => n.props?.accessibilityLabel === 'Ocultar respuesta 1'));
      assert.equal(v.app.find(n => n.props?.accessibilityLabel === 'Responder en historia'), undefined);
    } finally { await v.app.unmount(); }
  });
}

test('Results renders per-row safe error and retry, independently fences different rows, paginates/deduplicates and refreshes the loaded cursor chain', async () => {
  let fail = true, pageCalls = []; const pending = deferred(), failures = [];
  const { app, props, action } = await resultsFixture({ onLoad: async (_story, _element, cursor) => { pageCalls.push(cursor); return cursor ? page([row(respondent), row(actor)]) : page([row()], true); },
    onReply: async (_kind, source) => { failures.push(source.respondentId); if (source.respondentId === actor) return pending.promise; if (fail) throw Error('RAW_PRIVATE'); } });
  try {
    await app.flush(() => action('Responder en historia').onPress());
    assert.match(text(app), /Actualiza las respuestas/); assert.doesNotMatch(text(app), /RAW_PRIVATE/);
    await app.flush(() => press(app, 'Cargar más respuestas'));
    assert.equal(app.find(n => n.type === 'FlatList').props.data.length, 2);
    await app.flush(() => { action('Responder por privado', actor).onPress(); action('Responder en historia').onPress(); });
    assert.deepEqual(failures, [respondent, actor, respondent], 'different rows can operate independently');
    await app.update({ ...props, revision: 2, element: { ...element(), revision: 2 } });
    assert.equal(app.find(n => n.type === 'FlatList').props.data.length, 2);
    assert.equal(action('Responder por privado', actor).disabled, true);
    assert.equal(pageCalls.length, 4, 'refresh reloads first and second page with fresh cursors');
    fail = false;
    await app.flush(() => action('Responder en historia').onPress());
    assert.equal(app.nodes().filter(n => n.text?.includes('Actualiza las respuestas')).length, 0);
    await app.flush(() => pending.resolve());
  } finally { await app.unmount(); }
});

test('keyboard dismissal happens on confirmed success and active lifecycle teardown; response/placement/owner invalidation closes the modal', async () => {
  let dismisses = 0, elements = [element()]; const fixture = base(); fixture.Keyboard.dismiss = () => { dismisses++; };
  const { app, props } = await layerFixture({ onLoadState: async () => ({ storyId, elements }) }, fixture);
  try {
    const open = () => press(app, 'Responder pregunta');
    await app.flush(open); await app.flush(() => input(app).props.onChangeText('Respuesta'));
    const beforeSuccess = dismisses; await app.flush(() => press(app, 'Enviar respuesta privada'));
    assert.equal(input(app), undefined); assert.equal(dismisses, beforeSuccess + 1);
    await app.flush(open); const beforeHidden = dismisses;
    await app.update({ ...props, visible: false }); assert.equal(input(app), undefined); assert.equal(dismisses, beforeHidden + 1);
    await app.update(props); await app.flush(open);
    elements = [{ ...element(), response: { payload: { text: 'Confirmada' }, moderationState: 'pending' } }];
    await app.update({ ...props, revision: 2 }); assert.equal(input(app), undefined);
    elements = [element()]; await app.update({ ...props, revision: 3 }); await app.flush(open);
    await app.update({ ...props, composition: { version: 2, elements: [] } }); assert.equal(input(app), undefined);
  } finally { await app.unmount(); }
});

test('Android modal uses dynamic height avoidance and Back dismisses keyboard; unmount invalidates a pending response', async () => {
  const pending = deferred(); let dismisses = 0; const fixture = base(); fixture.Platform.OS = 'android'; fixture.Keyboard.dismiss = () => { dismisses++; };
  const { app } = await layerFixture({ onRespond: () => pending.promise }, fixture);
  await app.flush(() => press(app, 'Responder pregunta'));
  assert.equal(app.find(n => n.type === 'KeyboardAvoidingView').props.behavior, 'height');
  let before = dismisses; await app.flush(() => app.find(n => n.type === 'Modal').props.onRequestClose());
  assert.equal(input(app), undefined); assert.equal(dismisses, before + 1);
  await app.flush(() => press(app, 'Responder pregunta')); await app.flush(() => input(app).props.onChangeText('Pendiente'));
  await app.flush(() => press(app, 'Enviar respuesta privada')); before = dismisses;
  await app.unmount(); assert.equal(dismisses, before + 1);
  pending.reject(Error('late')); await app.flush(); assert.equal(app.nodes().length, 0);
});

test('Results ignores stale page and old hide completion after a different element/session becomes current', async () => {
  const oldLoad = deferred(), hide = deferred(); let loads = 0;
  const { app, props, action } = await resultsFixture({ onLoad: async () => ++loads === 1 ? page() : loads === 2 ? oldLoad.promise : page([row(actor)]), onModerate: () => hide.promise });
  try {
    await app.flush(() => action('Ocultar respuesta 1').onPress());
    await app.update({ ...props, revision: 2 });
    await app.update({ ...props, element: element(secondId), revision: 3 });
    await app.flush(() => { oldLoad.resolve(page([row()])); hide.resolve('hidden'); });
    assert.deepEqual(app.find(n => n.type === 'FlatList').props.data.map(r => [r.respondentId, r.moderationState]), [[actor, 'pending']]);
    assert.equal(action('Responder en historia', actor).disabled, false);
  } finally { await app.unmount(); }
});

test('saved row press from an old element cannot act on the same respondent in a replacement inbox', async () => {
  const calls = [];
  const { app, props, action } = await resultsFixture({ onReply: async (...args) => calls.push(args) });
  try {
    const old = action('Responder en historia').onPress;
    await app.update({ ...props, element: element(secondId) });
    await app.flush(old);
    assert.equal(calls.length, 0, 'full row identity includes the rendered story, element and sheet session');
    await app.flush(() => action('Responder en historia').onPress()); assert.equal(calls.length, 1);
    assert.equal(calls[0][1].elementId, secondId);
  } finally { await app.unmount(); }
});

test('old success cannot delete a replacement composer attempt for the same question and payload', async () => {
  const first = deferred(), replacement = deferred(), calls = [];
  const { app } = await layerFixture({ onRespond: (...args) => { calls.push(args); return calls.length === 1 ? first.promise : calls.length === 2 ? replacement.promise : Promise.reject(Error('retry')); } });
  try {
    const compose = async () => { await app.flush(() => press(app, 'Responder pregunta')); await app.flush(() => input(app).props.onChangeText('Igual')); await app.flush(() => press(app, 'Enviar respuesta privada')); };
    await compose(); await app.flush(() => press(app, 'Cancelar respuesta privada')); await compose();
    assert.equal(calls[1][2], calls[0][2]);
    await app.flush(() => first.resolve()); assert.ok(input(app));
    await app.flush(() => replacement.reject(Error('uncertain')));
    await app.flush(() => press(app, 'Enviar respuesta privada'));
    assert.equal(calls[2][2], calls[1][2], 'replacement keeps its exact uncertain idempotency identity after old success');
  } finally { await app.unmount(); }
});

test('web real ModalAnimation must finish both CSS exits before inbox navigation', async () => {
  const v = await viewerFixture(false, { currentUserId: respondent }, { integrated: true, web: true, animatedWeb: true });
  const { app } = v;
  const animations = () => app.nodes().filter(n => n.type === 'div' && n.props.onAnimationEnd);
  const finish = node => { const target = {}; node.props.onAnimationEnd({ target, currentTarget: target }); };
  try {
    await app.flush(() => press(app, 'Ver respuestas privadas'));
    assert.equal(animations().length, 2);
    await app.flush(() => press(app, 'Responder por privado'));
    assert.equal(v.routes.length, 0, 'React visible=false is not CSS animation completion');
    await app.flush(() => finish(animations()[1]));
    assert.equal(v.routes.length, 0, 'outer viewer still has an unfinished CSS exit');
    await app.flush(() => finish(animations()[0]));
    assert.equal(v.routes.length, 1); assert.deepEqual(v.order, ['close', 'navigate']);
  } finally { await app.unmount(); }
});

test('web results cannot reopen during handoff dismissal or strand the reserved viewer transition', async () => {
  const v = await viewerFixture(false, { currentUserId: respondent }, { integrated: true, web: true, animatedWeb: true });
  const { app } = v;
  const animations = () => app.nodes().filter(n => n.type === 'div' && n.props.onAnimationEnd);
  const finish = node => { const target = {}; node.props.onAnimationEnd({ target, currentTarget: target }); };
  try {
    await app.flush(() => press(app, 'Ver respuestas privadas'));
    await app.flush(() => press(app, 'Responder por privado'));
    await app.flush(() => press(app, 'Ver respuestas privadas'));
    await app.flush(() => finish(animations()[1]));
    await app.flush(() => finish(animations()[0]));
    assert.equal(v.routes.length, 1, 'reopen cannot replace the pending dismissal/session');
    assert.deepEqual(v.order, ['close', 'navigate']);
  } finally { await app.unmount(); }
});

const animatedNodes = app => app.nodes().filter(n => n.type === 'div' && n.props.onAnimationEnd);
const finishCss = node => { assert.ok(node, 'expected current modal animation'); const target = {}; node.props.onAnimationEnd({ target, currentTarget: target }); };
async function finishModal(app, native, index) {
  await app.flush(() => native ? app.nodes().filter(n => n.type === 'Modal')[index].props.onDismiss() : finishCss(animatedNodes(app)[index]));
}
async function ownerInboxFixture(native, overrides = {}, options = {}) {
  return viewerFixture(native, { currentUserId: respondent, onGetInteractiveResults: async () => page([row(actor)]), ...overrides }, { integrated: true, web: !native, animatedWeb: !native, ...options });
}
async function beginInboxReply(app) {
  await app.flush(() => { assert.ok(app.find(n => n.props?.accessibilityLabel === 'Ver respuestas privadas')); press(app, 'Ver respuestas privadas'); });
  await app.flush(() => { assert.ok(app.find(n => n.props?.accessibilityLabel === 'Responder por privado')); press(app, 'Responder por privado'); });
}

// Break caught: lifecycle cleanup drops the transaction before releasing its reserved lock.
for (const native of [false, true]) for (const axis of ['actor', 'owner']) for (const phase of ['inner', 'outer']) {
  test(`${native ? 'native' : 'animated web'} ${axis} retirement during ${phase} dismissal releases its reservation and permits a fresh reply`, async () => {
    const v = await ownerInboxFixture(native); const { app } = v;
    try {
      await beginInboxReply(app);
      if (phase === 'outer') await finishModal(app, native, 1);
      const staleDismiss = native ? app.find(n => n.type === 'Modal').props.onDismiss : null;
      const changed = axis === 'actor' ? { ...v.props, currentUserId: actor }
        : { ...v.props, storyGroup: { ...v.props.storyGroup, stories: [{ ...v.props.storyGroup.stories[0], userId: actor }] } };
      await app.update(changed);
      if (staleDismiss) await app.flush(staleDismiss);
      assert.deepEqual(v.order, []); assert.equal(v.routes.length, 0);
      await app.update(v.props);
      await beginInboxReply(app);
      await app.flush(() => press(app, 'Cerrar historia'));
      assert.deepEqual(v.order, [], 'replacement reservation must remain locked');
      await finishModal(app, native, 1);
      if (staleDismiss) { await app.flush(staleDismiss); assert.equal(v.routes.length, 0, 'old dismissal must not finish a replacement reservation'); }
      await finishModal(app, native, 0);
      assert.deepEqual(v.order, ['close', 'navigate']); assert.equal(v.routes.length, 1);
    } finally { await app.unmount(); }
  });
}

for (const native of [false, true]) {
  test(`${native ? 'native' : 'animated web'} cancellation after accepted preflight leaves current-session Close usable`, async () => {
    const v = await ownerInboxFixture(native); const { app } = v;
    try {
      await beginInboxReply(app);
      await app.update({ ...v.props, currentUserId: actor });
      await app.flush(() => press(app, 'Cerrar historia'));
      assert.deepEqual(v.order, ['close']); assert.equal(v.routes.length, 0);
    } finally { await app.unmount(); }
  });

  for (const removed of ['placement', 'layer', 'preflight', 'definition']) {
    test(`${native ? 'native' : 'animated web'} ${removed} removal during inner dismissal settles cancellation and permits retry`, async () => {
      let elements = [element()];
      const v = await ownerInboxFixture(native, { onGetInteractiveState: async () => ({ storyId, elements }) }); const { app } = v;
      try {
        await beginInboxReply(app);
        let changed;
        if (removed === 'placement') changed = { ...v.props, storyGroup: { ...v.props.storyGroup, stories: [{ ...v.props.storyGroup.stories[0], composition: { version: 2, elements: [] } }] } };
        if (removed === 'layer') changed = { ...v.props, onGetInteractiveResults: undefined };
        if (removed === 'preflight') changed = { ...v.props, onPrepareStoryQuestionAnswer: undefined };
        if (removed === 'definition') { elements = []; changed = { ...v.props, interactiveRevision: 2 }; }
        await app.update(changed);
        assert.equal(v.routes.length, 0);
        elements = [element()]; await app.update({ ...v.props, interactiveRevision: 3 });
        await beginInboxReply(app);
        await finishModal(app, native, 1);
        await finishModal(app, native, 0);
        assert.deepEqual(v.order, ['close', 'navigate']); assert.equal(v.routes.length, 1);
      } finally { await app.unmount(); }
    });
  }
}

test('animated web removing last placement settles the inner transaction even though its animation source is gone', async () => {
  const v = await ownerInboxFixture(false); const { app } = v;
  try {
    await beginInboxReply(app);
    await app.update({ ...v.props, storyGroup: { ...v.props.storyGroup, stories: [{ ...v.props.storyGroup.stories[0], composition: { version: 2, elements: [] } }] } });
    assert.equal(animatedNodes(app).length, 1);
    await app.flush(() => press(app, 'Cerrar historia'));
    assert.deepEqual(v.order, ['close']); assert.equal(v.routes.length, 0);
  } finally { await app.unmount(); }
});

test('retirement settles an unresolved dismissal and stale completion/dismiss cannot unlock or navigate a replacement lease', async () => {
  const module = await import(storyQaModuleUrl('components/feature/useStoryQuestionInbox.ts', { react: new URL('../node_modules/react/index.js', import.meta.url).href, '@/services/storyQuestionHandoff': adapter }));
  let current; const Component = props => { current = module.useStoryQuestionInbox(props); return null; };
  const lock = { current: false }, old = deferred(), replacement = deferred(), order = [];
  const props = { visible: true, actorId: respondent, storyId, isOwner: true, transitionLock: lock,
    prepare: async source => ({ question: 'Canónica', respondentId: source.respondentId }), onExit() {}, onClose: () => order.push('close'), navigate: () => order.push('navigate') };
  const app = await mount(Component, props);
  try {
    let settled = false;
    const staleDismiss = current.onDismiss;
    await app.flush(() => { void current.reply('story', { storyId, elementId, respondentId: actor }, () => true, () => old.promise).catch(() => { settled = true; }); });
    await app.update({ ...props, actorId: actor });
    assert.equal(settled, true, 'retirement must settle even if the removed modal can never report dismissal');
    assert.equal(lock.current, false);
    await app.flush(() => { void current.reply('story', { storyId, elementId, respondentId: respondent }, () => true, () => replacement.promise); });
    const reserved = lock.current;
    await app.flush(() => old.resolve(true));
    assert.equal(lock.current, reserved, 'old catch/finally cannot release the new reservation');
    await app.flush(() => replacement.resolve(true));
    await app.flush(staleDismiss); assert.deepEqual(order, []);
    assert.equal(lock.current, reserved);
    await app.flush(() => current.onDismiss()); assert.deepEqual(order, ['close', 'navigate']);
  } finally { await app.unmount(); }
});

test('retirement does not release a shared viewer transition already replaced by another owner', async () => {
  const module = await import(storyQaModuleUrl('components/feature/useStoryQuestionInbox.ts', { react: new URL('../node_modules/react/index.js', import.meta.url).href, '@/services/storyQuestionHandoff': adapter }));
  let current; const Component = props => { current = module.useStoryQuestionInbox(props); return null; };
  const lock = { current: false }, dismissal = deferred();
  const props = { visible: true, actorId: respondent, storyId, isOwner: true, transitionLock: lock,
    prepare: async source => ({ question: 'Canónica', respondentId: source.respondentId }), onExit() {}, onClose() {}, navigate() {} };
  const app = await mount(Component, props);
  try {
    await app.flush(() => { void current.reply('story', { storyId, elementId, respondentId: actor }, () => true, () => dismissal.promise).catch(() => {}); });
    lock.current = true; // Existing viewer transitions use their own boolean reservation.
    await app.update({ ...props, visible: false });
    await app.flush(() => dismissal.resolve(false));
    assert.equal(lock.current, true, 'cancellation owns only the exact token it acquired');
  } finally { await app.unmount(); }
});

test('Android nonanimated dismissal preserves cancellation before accepted preflight and a fresh successful lease', async () => {
  const prepared = deferred(); let requests = 0;
  const v = await ownerInboxFixture(true, { onPrepareStoryQuestionAnswer: source => ++requests === 1 ? prepared.promise : Promise.resolve({ question: 'Nueva', respondentId: source.respondentId }) }, { android: true });
  const { app } = v;
  try {
    await beginInboxReply(app);
    await app.update({ ...v.props, currentUserId: actor });
    await app.flush(() => prepared.resolve({ question: 'Anterior', respondentId: actor }));
    assert.deepEqual(v.order, []);
    await app.update(v.props); await beginInboxReply(app);
    assert.deepEqual(v.order, ['close', 'navigate']); assert.equal(v.routes.length, 1);
  } finally { await app.unmount(); }
});

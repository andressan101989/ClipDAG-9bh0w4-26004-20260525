import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { randomUUID } from 'node:crypto';
import { mount } from './helpers/storyQaHostRenderer.mjs';
import { loadStoryQaComponent } from './helpers/loadStoryQaComponent.mjs';
import { storyQaModuleUrl } from './helpers/loadStoryQaModule.mjs';
import { createStoryQuestionHandoffStore } from '../services/storyQuestionHandoffRuntime.mjs';

const actor = '20000000-0000-4000-8000-000000000001';
const recipient = '20000000-0000-4000-8000-000000000002';
const source = { storyId: '30000000-0000-4000-8000-000000000001', elementId: '30000000-0000-4000-8000-000000000002', respondentId: recipient };
const card = { id: '10000000-0000-4000-8000-000000000001', type: 'question_answer', x: .5, y: .5, scale: 1, rotation: 0, question: '¿Cómo?', answer: '' };
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const types = storyQaModuleUrl('components/feature/storyInteractiveTypes.ts');
const runtime = storyQaModuleUrl('services/storyQuestionIntegrationRuntime.ts');
const base = () => ({
  StyleSheet: { create: x => x, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
  Platform: { OS: 'ios' }, PanResponder: { create: () => ({ panHandlers: {} }) },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  Colors: new Proxy({}, { get: () => '#000' }), Radius: {}, Spacing: {}, FontSize: {}, FontWeight: {},
  randomUUID, namespaces: { 'expo-crypto': { randomUUID } },
});

test('canonical StoryEditor initializes one seed, edits answer, rejects blank and retains exact retry identity after failed onPublish', async () => {
  const fixture = base();
  const { StoryEditor } = await loadStoryQaComponent('components/feature/StoryEditor.tsx', fixture, {
    './storyInteractiveTypes': types, '@/services/storyQuestionIntegrationRuntime': runtime,
    './storyStageGeometry': storyQaModuleUrl('components/feature/storyStageGeometry.ts'),
    './storyComposition': data("export const EMPTY_STORY_COMPOSITION={version:1,elements:[]},STORY_STICKERS=['🔥'],STORY_TEXT_COLORS=['#FFFFFF'],StoryCompositionElementContent='Card';export const storyElementFrame=()=>({width:280,minHeight:140});"),
  });
  const calls = [];
  const props = { visible: true, source: { kind: 'media', uri: 'local', mediaType: 'photo', asset: {} },
    questionAnswerSeed: card, onCancel() {}, onPublish: async (...args) => { calls.push(args); throw new Error('uncertain'); } };
  const app = await mount(StoryEditor, props);
  try {
    assert.equal(calls.length, 0);
    const answerInput = () => app.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Tu respuesta');
    assert.ok(answerInput(), 'seed must open answer-only input in canonical editor');
    assert.equal(answerInput().props.maxLength, undefined,
      'the controlled editor must enforce the 500-code-point contract instead of a UTF-16 native limit');
    await app.flush(() => answerInput().props.onChangeText('😀'.repeat(501)));
    assert.equal([...answerInput().props.value].length, 500,
      'the visible draft must never exceed the canonical 500-code-point publication limit');
    await app.flush(() => answerInput().props.onChangeText(''));
    await app.flush(() => app.find(node => node.props?.accessibilityLabel === 'Eliminar elemento').props.onPress());
    assert.ok(answerInput(), 'the required card cannot be removed');
    const publish = () => app.find(node => node.props?.accessibilityLabel === 'Publicar historia').props.onPress();
    await app.flush(publish);
    assert.equal(calls.length, 0, 'blank card cannot reach publication');
    await app.flush(() => answerInput().props.onChangeText('Mi respuesta'));
    await app.flush(publish);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].composition.elements[0].question, '¿Cómo?');
    assert.equal(calls[0][1].composition.elements[0].answer, 'Mi respuesta');
    await app.update({ ...props, questionAnswerSeed: { ...card, answer: 'rerender must not reset' } });
    assert.equal(answerInput().props.value, 'Mi respuesta');
    await app.flush(() => { publish(); publish(); });
    assert.equal(calls.length, 2, 'one explicit retry cannot dispatch twice before React state commits');
    assert.equal(calls[1][2], calls[0][2]);
    assert.deepEqual(calls[1][1], calls[0][1]);
    await app.update({ ...props, visible: false });
    await app.update({ ...props, questionAnswerSeed: null });
    assert.equal(answerInput(), undefined, 'new ordinary media session cannot retain the previous card');
    await app.flush(publish);
    assert.deepEqual(calls[2][1].composition, { version: 1, elements: [] });
    assert.notEqual(calls[2][2], calls[0][2]);
  } finally { await app.unmount(); }
});

function sharedAdapter(store) {
  const key = `__storyQaSharedAdapter${randomUUID()}`;
  globalThis[key] = store;
  return data(`export const storyQuestionHandoffs=globalThis[${JSON.stringify(key)}];`);
}

async function feedHarness(options = {}) {
  const fixture = base();
  const store = createStoryQuestionHandoffStore({ randomUUID });
  const route = store.issueStoryReply({ actorId: actor, source, question: card.question, answer: '' });
  const state = { user: options.auth ? { id: actor } : null, focused: true, params: { handoffToken: route.handoffToken }, alerts: [], ordinary: [], qa: [], uploads: [], deletes: [],
    permission: true, picker: { canceled: false, assets: [{ uri: 'file://photo', type: 'image', mimeType: 'image/jpeg' }] } };
  state.preflights = [];
  const prepareStoryQuestionAnswer = async source => { state.preflights.push(source); return { question: card.question, respondentId: recipient }; };
  Object.assign(fixture, {
    useAuth: () => ({ user: state.user, isFollowing: () => false }),
    useFeed: () => ({ videos: [], isLoadingFeed: false, isLiked: () => false, isSaved: () => false, ensureVideoLoadedById: async () => ({ status: 'unavailable' }) }),
    useStories: () => ({ storyGroups: [], prepareStoryQuestionAnswer, addStory: async (...args) => { state.ordinary.push(args); return actor; },
      addSharedStory: async (...args) => { (state.shared ??= []).push(args); return actor; },
      addQuestionAnswerStory: async input => { state.qa.push(input); if (state.failQa) throw new Error('private database message'); return state.qaResult ?? actor; } }),
    useNotifications() {}, useScrollToTop() {}, useIsFocused: () => state.focused,
    useLocalSearchParams: () => state.params,
    useRouter: () => ({ setParams: params => { state.params = { ...state.params, ...params }; } }),
    useFocusEffect: callback => React.useEffect(() => state.focused ? callback() : undefined, [callback, state.focused]),
    useAlert: () => ({ showAlert: (...args) => state.alerts.push(args) }),
    fetchSponsoredProducts: async () => [], loadAdvertisingV2Opportunity: async () => null,
    mixSocialFeedSponsoredProducts: () => [], mixPlacementAdvertisingV2: () => [],
    fetchMarketplaceContentProductTagSummaries: async () => [],
    createAdvertisingV2ImpressionController: () => ({ dispose() {}, discard() {} }),
    createAdvertisingV2ClickController: () => ({ dispose() {}, discard() {} }),
    createAdvertisingV2DestinationOpenController: () => ({ dispose() {}, discard() {} }),
    createAdvertisingV2VideoViewController: () => ({ dispose() {}, discard() {} }),
    Audio: { setAudioModeAsync: async () => {} }, EMPTY_STORY_COMPOSITION: { version: 1, elements: [] },
    uploadMediaFromUri: async input => { state.uploads.push(input); return state.uploadResult ?? { assetId: recipient }; },
    deleteMediaAsset: async id => { state.deletes.push(id); },
    marketplaceContentTypeForMedia: () => 'feed',
    createStoryStreamUpload: async () => { state.streamCreates = (state.streamCreates ?? 0) + 1; return state.streamContractResult ?? { assetId: recipient, uploadUrl: 'private-grant', uploadSizeBytes: 123 }; },
    uploadStoryVideoWithTus: async () => { if (state.failStream) throw new Error('private provider metadata'); state.streamUploads = (state.streamUploads ?? 0) + 1; },
    waitForStoryStreamReady: async () => { state.streamReady = (state.streamReady ?? 0) + 1; return state.streamReadyResult; },
    deleteStreamVideo: async id => { state.deletes.push(id); },
  });
  fixture.namespaces['expo-image-picker'] = {
    MediaTypeOptions: { All: 'All' }, requestCameraPermissionsAsync: async () => ({ granted: state.permission }),
    requestMediaLibraryPermissionsAsync: async () => ({ granted: state.permission }),
    launchCameraAsync: async () => state.picker, launchImageLibraryAsync: async () => state.picker,
  };
  const { default: Feed } = await loadStoryQaComponent('app/(tabs)/index.tsx', fixture, {
    '@/services/storyQuestionHandoff': sharedAdapter(store), '@/services/storyQuestionIntegrationRuntime': runtime,
  });
  const Root = options.strict ? () => React.createElement(React.StrictMode, null, React.createElement(Feed)) : Feed;
  const app = await mount(Root, {}, { strict: options.strict });
  const findElement = (node, predicate) => !node ? undefined : predicate(node) ? node
    : React.Children.toArray(node.props?.children).map(child => findElement(child, predicate)).find(Boolean);
  return { app, state, store, prepareStoryQuestionAnswer, editor: () => app.find(node => node.type === 'StoryEditor'),
    choice: () => state.alerts.filter(args => args[0] === 'Agregar Historia').at(-1)?.[2],
    addOrdinary: () => findElement(app.find(node => node.type === 'FlatList').props.ListHeaderComponent, node => node.type === 'StoriesBar').props.onAddStory() };
}

test('actual Feed forwards the canonical preflight callback/current actor without invoking it on render', async () => {
  const { app, state, prepareStoryQuestionAnswer } = await feedHarness({ auth: true });
  try {
    const viewer = app.find(node => node.type === 'StoryViewer');
    assert.equal(viewer.props.onPrepareStoryQuestionAnswer, prepareStoryQuestionAnswer);
    assert.equal(viewer.props.currentUserId, actor);
    assert.deepEqual(state.preflights, []);
    assert.equal(state.qa.length, 0);
    assert.equal(state.ordinary.length, 0);
    assert.deepEqual(await viewer.props.onPrepareStoryQuestionAnswer(source), { question: card.question, respondentId: recipient });
    assert.deepEqual(state.preflights, [source]);
  } finally { await app.unmount(); }
});

test('actual Feed waits for auth/focus, opens media choice once, uses QA RPC on explicit publish and reuses upload on uncertainty', async () => {
  const { app, state, editor, choice } = await feedHarness();
  try {
    assert.equal(choice(), undefined);
    state.user = { id: actor }; state.focused = false;
    await app.update({});
    assert.equal(choice(), undefined);
    state.focused = true; await app.update({});
    assert.ok(choice(), 'authenticated focused Feed must consume handoff into its existing media choice');
    assert.equal(state.qa.length, 0);
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    assert.equal(editor().props.questionAnswerSeed.question, '¿Cómo?');
    assert.equal(state.params.handoffToken, undefined);
    const publication = { composition: { version: 2, elements: [{ ...editor().props.questionAnswerSeed, answer: 'Respuesta' }] }, interactiveDefinitions: [] };
    state.failQa = true;
    const warnings = [];
    const oldWarn = console.warn; console.warn = (...args) => warnings.push(args);
    try { await assert.rejects(editor().props.onPublish(editor().props.source, publication, actor)); }
    finally { console.warn = oldWarn; }
    assert.equal(JSON.stringify(warnings).includes('private database message'), false);
    assert.equal(state.uploads.length, 1);
    assert.equal(state.ordinary.length, 0);
    assert.deepEqual(state.qa[0].source, source);
    assert.equal(editor().props.questionAnswerSeed.question, '¿Cómo?');
    state.failQa = false;
    await editor().props.onPublish(editor().props.source, publication, actor); await app.flush();
    assert.equal(state.uploads.length, 1);
    assert.equal(state.qa[1].clientStoryId, state.qa[0].clientStoryId);
    assert.equal(editor().props.visible, false);
    assert.equal(state.deletes.length, 0);
  } finally { await app.unmount(); }
});

test('Feed StrictMode/focus replay preserves the one consumed private media session', async () => {
  const { app, state, editor, choice } = await feedHarness({ auth: true, strict: true });
  try {
    assert.equal(state.alerts.filter(args => args[0] === 'Agregar Historia').length, 1);
    state.focused = false; await app.update({});
    state.focused = true; await app.update({});
    await app.flush(() => choice().find(button => button.text === 'Cámara').onPress());
    assert.equal(editor().props.source?.kind, 'media', 'StrictMode cleanup must not invalidate the live picker');
    assert.equal(editor().props.questionAnswerSeed.question, '¿Cómo?');
  } finally { await app.unmount(); }
});

for (const ending of ['cancel choice', 'denied camera', 'denied gallery', 'cancel camera', 'cancel gallery', 'picker error']) {
  test(`actual Feed ${ending} abandons QA and the next ordinary Story uses only addStory`, async () => {
    const { app, state, editor, choice, addOrdinary } = await feedHarness({ auth: true });
    try {
      if (ending === 'cancel choice') await app.flush(() => choice().find(button => button.text === 'Cancelar').onPress());
      else {
        if (ending.startsWith('denied')) state.permission = false;
        if (ending.startsWith('cancel')) state.picker = { canceled: true, assets: null };
        if (ending === 'picker error') Object.defineProperty(state, 'picker', { configurable: true, get() { throw new Error('private error'); } });
        await app.flush(() => choice().find(button => button.text === (ending.includes('camera') ? 'Cámara' : 'Galería')).onPress());
      }
      assert.equal(editor().props.visible, false);
      state.permission = true;
      Object.defineProperty(state, 'picker', { configurable: true, writable: true, value: { canceled: false, assets: [{ uri: 'ordinary', type: 'image' }] } });
      await app.flush(addOrdinary);
      await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
      assert.equal(editor().props.questionAnswerSeed, null);
      await editor().props.onPublish(editor().props.source, { composition: { version: 1, elements: [] }, interactiveDefinitions: [] }, actor);
      assert.equal(state.ordinary.length, 1);
      assert.equal(state.qa.length, 0);
    } finally { await app.unmount(); }
  });
}

test('actual Feed fences a picker completing after logout and a new ordinary session', async () => {
  const { app, state, editor, choice, addOrdinary } = await feedHarness({ auth: true });
  try {
    let resolveOld;
    state.picker = new Promise(resolve => { resolveOld = resolve; });
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    state.user = null; await app.update({});
    state.user = { id: actor }; await app.update({});
    state.picker = { canceled: false, assets: [{ uri: 'ordinary', type: 'image' }] };
    await app.flush(addOrdinary);
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    resolveOld({ canceled: false, assets: [{ uri: 'old-private', type: 'image' }] });
    await app.flush();
    assert.equal(editor().props.source.uri, 'ordinary');
    assert.equal(editor().props.questionAnswerSeed, null);
    assert.equal(state.qa.length, 0);
  } finally { await app.unmount(); }
});

test('actual Feed retains a handoff while editor is occupied, then opens it after explicit cancellation', async () => {
  const { app, state, store, editor, choice } = await feedHarness({ auth: true });
  try {
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    const seed = editor().props.questionAnswerSeed;
    state.params = store.issueStoryReply({ actorId: actor, source, question: 'Otra pregunta', answer: '' });
    await app.update({});
    assert.equal(editor().props.questionAnswerSeed, seed);
    assert.equal(state.alerts.filter(args => args[0] === 'Agregar Historia').length, 1);
    await app.flush(() => editor().props.onCancel());
    assert.equal(state.alerts.filter(args => args[0] === 'Agregar Historia').length, 2);
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    assert.equal(editor().props.questionAnswerSeed.question, 'Otra pregunta');
  } finally { await app.unmount(); }
});

for (const provider of ['r2', 'stream']) {
  test(`actual Feed ${provider} uncertain attempt is cleaned once on editor cancellation`, async () => {
    const { app, state, editor, choice } = await feedHarness({ auth: true });
    try {
      state.failQa = true;
      if (provider === 'stream') state.picker = { canceled: false, assets: [{ uri: 'file://video', type: 'video', mimeType: 'video/mp4' }] };
      await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
      const publication = { composition: { version: 2, elements: [{ ...editor().props.questionAnswerSeed, answer: 'Respuesta' }] }, interactiveDefinitions: [] };
      const oldWarn = console.warn; console.warn = () => {};
      try { await assert.rejects(editor().props.onPublish(editor().props.source, publication, actor)); }
      finally { console.warn = oldWarn; }
      if (provider === 'stream') { assert.equal(state.streamUploads, 1); assert.equal(state.streamReady, 1); }
      const cancel = editor().props.onCancel;
      await app.flush(() => cancel(actor));
      await app.flush(() => cancel(actor));
      assert.deepEqual(state.deletes, [recipient]);
      assert.equal(editor().props.questionAnswerSeed, null);
      assert.equal(editor().props.visible, false);
    } finally { await app.unmount(); }
  });
}

test('actual Feed deletes a failed Stream attempt before retrying upload and never publishes shared QA media', async () => {
  const { app, state, editor, choice } = await feedHarness({ auth: true });
  try {
    state.picker = { canceled: false, assets: [{ uri: 'file://video', type: 'video' }] };
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    const publication = { composition: { version: 2, elements: [{ ...editor().props.questionAnswerSeed, answer: 'Respuesta' }] }, interactiveDefinitions: [] };
    await assert.rejects(editor().props.onPublish({ kind: 'shared', videoId: actor }, publication, actor), /STORY_QA_MEDIA_REQUIRED/);
    state.failStream = true;
    const oldWarn = console.warn; console.warn = () => {};
    try { await assert.rejects(editor().props.onPublish(editor().props.source, publication, actor)); }
    finally { console.warn = oldWarn; }
    assert.equal(state.qa.length, 0);
    assert.deepEqual(state.deletes, [recipient]);
    state.failStream = false;
    await editor().props.onPublish(editor().props.source, publication, actor);
    assert.equal(state.streamCreates, 2);
    assert.equal(state.qa.length, 1);
  } finally { await app.unmount(); }
});

test('actual Feed retains ordinary shared-content editor and addSharedStory authority', async () => {
  const { app, state, editor, choice } = await feedHarness({ auth: true });
  try {
    await app.flush(() => choice().find(button => button.text === 'Cancelar').onPress());
    const item = { kind: 'organic', video: { id: actor, videoUrl: 'https://public-preview', username: 'creator' } };
    const flatList = app.find(node => node.type === 'FlatList');
    // The real Feed renderItem closure owns the shared-content handoff.
    const videoCard = flatList.props.renderItem({ item, index: 0 });
    assert.equal(typeof videoCard.props.onAddToStory, 'function');
    await app.flush(videoCard.props.onAddToStory);
    assert.equal(editor().props.source.kind, 'shared');
    assert.equal(editor().props.questionAnswerSeed, null);
    await editor().props.onPublish(editor().props.source, { composition: { version: 1, elements: [] }, interactiveDefinitions: [] }, actor);
    assert.equal(state.shared.length, 1);
    assert.equal(state.shared[0][0], actor);
    assert.equal(state.qa.length, 0);
    assert.equal(state.uploads.length, 0);
  } finally { await app.unmount(); }
});

for (const provider of ['r2', 'stream']) {
  for (const teardown of ['logout', 'unmount']) {
    test(`actual Feed cleans a late ${provider} upload after ${teardown} without publishing or retaining retry`, async () => {
      const { app, state, editor, choice } = await feedHarness({ auth: true });
      let unmounted = false;
      const oldWarn = console.warn; console.warn = () => {};
      try {
        let finishUpload;
        if (provider === 'stream') {
          state.picker = { canceled: false, assets: [{ uri: 'video', type: 'video' }] };
          state.streamReadyResult = new Promise(resolve => { finishUpload = resolve; });
        } else state.uploadResult = new Promise(resolve => { finishUpload = resolve; });
        await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
        const publication = { composition: { version: 2, elements: [{ ...editor().props.questionAnswerSeed, answer: 'Respuesta' }] }, interactiveDefinitions: [] };
        const publish = editor().props.onPublish(editor().props.source, publication, actor);
        const rejected = assert.rejects(publish, /STORY_PUBLISH_SESSION_CHANGED/);
        await app.flush();
        if (teardown === 'logout') { state.user = null; await app.update({}); }
        else { await app.unmount(); unmounted = true; }
        finishUpload(provider === 'r2' ? { assetId: recipient } : undefined);
        await rejected; await app.flush();
        assert.equal(state.qa.length, 0);
        assert.deepEqual(state.deletes, [recipient]);
      } finally { console.warn = oldWarn; if (!unmounted) await app.unmount(); }
    });
  }
}

test('actual Feed retires an uncertain cached attempt on actor change and defers in-flight cleanup until publication settles', async () => {
  const { app, state, editor, choice } = await feedHarness({ auth: true });
  const oldWarn = console.warn; console.warn = () => {};
  try {
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    const publication = { composition: { version: 2, elements: [{ ...editor().props.questionAnswerSeed, answer: 'Respuesta' }] }, interactiveDefinitions: [] };
    state.failQa = true;
    await assert.rejects(editor().props.onPublish(editor().props.source, publication, actor));
    assert.deepEqual(state.deletes, []);
    state.user = { id: recipient }; await app.update({});
    assert.deepEqual(state.deletes, [recipient]);
  } finally { console.warn = oldWarn; await app.unmount(); }
});

test('actual Feed does not delete or close another session when an abandoned in-flight publication confirms success', async () => {
  const { app, state, editor, choice } = await feedHarness({ auth: true });
  try {
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    let finishRpc;
    state.qaResult = new Promise(resolve => { finishRpc = resolve; });
    const publication = { composition: { version: 2, elements: [{ ...editor().props.questionAnswerSeed, answer: 'Respuesta' }] }, interactiveDefinitions: [] };
    const publishing = editor().props.onPublish(editor().props.source, publication, actor);
    await app.flush();
    state.user = null; await app.update({});
    assert.deepEqual(state.deletes, [], 'cleanup waits for RPC outcome');
    finishRpc(actor); await publishing; await app.flush();
    assert.deepEqual(state.deletes, [], 'confirmed linked media is not an abandoned upload');
    assert.equal(state.alerts.filter(args => args[0] === 'Historia publicada!').length, 0);
  } finally { await app.unmount(); }
});

test('actual Feed cleans a late Stream reservation before uploading after logout', async () => {
  const { app, state, editor, choice } = await feedHarness({ auth: true });
  try {
    state.picker = { canceled: false, assets: [{ uri: 'video', type: 'video' }] };
    let finishReservation;
    state.streamContractResult = new Promise(resolve => { finishReservation = resolve; });
    await app.flush(() => choice().find(button => button.text === 'Galería').onPress());
    const publication = { composition: { version: 2, elements: [{ ...editor().props.questionAnswerSeed, answer: 'Respuesta' }] }, interactiveDefinitions: [] };
    const rejected = assert.rejects(editor().props.onPublish(editor().props.source, publication, actor), /STORY_PUBLISH_SESSION_CHANGED/);
    state.user = null; await app.update({});
    finishReservation({ assetId: recipient, uploadUrl: 'private-grant', uploadSizeBytes: 123 });
    await rejected; await app.flush();
    assert.equal(state.streamUploads ?? 0, 0);
    assert.equal(state.qa.length, 0);
    assert.deepEqual(state.deletes, [recipient]);
  } finally { await app.unmount(); }
});

async function chatHarness(options = {}) {
  const fixture = base();
  const store = createStoryQuestionHandoffStore({ randomUUID });
  const route = store.issueChatDraft({ actorId: actor, recipientId: recipient, text: 'Respuesta privada' });
  const state = { params: { userId: recipient, ...route }, user: options.lateAuth ? null : { id: actor }, sent: [], typing: [] };
  Object.assign(fixture, {
    useAuth: () => ({ user: state.user }),
    useLocalSearchParams: () => state.params,
    useRouter: () => ({ setParams: params => { state.params = { ...state.params, ...params }; } }),
    useAlert: () => ({ showAlert() {} }), useFonts: () => [true], useFocusEffect: callback => React.useEffect(callback, [callback]),
    useMessages: () => ({ messages: {}, conversations: [], presenceByUser: {}, typingByUser: {}, isLoadingOlder: {}, hasOlderMessages: {},
      activateConversation: async () => {}, deactivateConversation() {}, loadConversation: async () => {},
      setConversationTyping: (...args) => state.typing.push(args), sendMessage: async (...args) => { state.sent.push(args); return { id: actor }; } }),
    Keyboard: { addListener: () => ({ remove() {} }) },
    ChatVoiceDraftSender: class { clear() {} },
    AdvertisingMessageStartRetryController: class { reset() {} },
    configureAppSwitcherProtectionModule() {}, setActiveMessageConversation() {}, clearActiveMessageConversation() {},
  });
  const { default: Chat } = await loadStoryQaComponent('app/chat/[userId].tsx', fixture, {
    '@/services/storyQuestionHandoff': sharedAdapter(store), '@/services/storyQuestionIntegrationRuntime': runtime,
  });
  const app = await mount(Chat, {}, { strict: options.strict });
  return { app, state, store, input: () => app.find(node => node.type === 'TextInput' && node.props.maxLength === 1000) };
}

test('actual Chat consumes draft without send/typing side effects and explicit Send still calls canonical send', async () => {
  const { app, state, input } = await chatHarness();
  try {
    assert.equal(input().props.value, 'Respuesta privada');
    assert.equal(state.sent.length, 0);
    assert.equal(state.typing.filter(([, typing]) => typing).length, 0);
    await app.flush(() => input().props.onChangeText('Respuesta editada'));
    await input().props.onSubmitEditing(); await app.flush();
    assert.deepEqual(state.sent, [[recipient, 'Respuesta editada']]);
    assert.equal(input().props.value, '');
  } finally { await app.unmount(); }
});

test('actual Chat StrictMode consumes once and retains the seeded editable draft', async () => {
  const { app, state, input } = await chatHarness({ strict: true });
  try {
    assert.equal(input().props.value, 'Respuesta privada');
    assert.equal(state.sent.length, 0);
    assert.equal(state.params.handoffToken, undefined);
  } finally { await app.unmount(); }
});

test('actual Chat late auth and an occupied emoji draft retain private text until explicit insertion', async () => {
  const { app, state, input } = await chatHarness({ lateAuth: true });
  try {
    assert.equal(input().props.value, '');
    await app.flush(() => app.find(node => node.props?.accessibilityLabel === 'Agregar emoji').props.onPress());
    state.user = { id: actor }; await app.update({});
    assert.equal(input().props.value, '😊');
    const insert = app.find(node => node.props?.accessibilityLabel === 'Insertar respuesta de historia');
    assert.ok(insert);
    assert.equal(state.sent.length, 0);
    assert.equal(state.typing.filter(([, typing]) => typing).length, 0);
    await app.flush(insert.props.onPress);
    assert.equal(input().props.value, '😊\nRespuesta privada');
    state.params = { userId: actor }; await app.update({});
    assert.equal(input().props.value, '');
  } finally { await app.unmount(); }
});

test('actual Chat retains an active voice draft and offers explicit insertion after voice completion', async () => {
  const { app, state, store, input } = await chatHarness({ lateAuth: true });
  try {
    const voice = () => app.find(node => node.type === 'VoiceRecorderBar');
    await app.flush(() => voice().props.onRecordingChange(true));
    state.user = { id: actor }; await app.update({});
    assert.equal(input(), undefined);
    assert.ok(app.find(node => node.props?.accessibilityLabel === 'Insertar respuesta de historia'));
    assert.equal(state.sent.length, 0);
    await app.flush(() => voice().props.onRecordingChange(false));
    assert.equal(input().props.value, '');
    await app.flush(() => app.find(node => node.props?.accessibilityLabel === 'Insertar respuesta de historia').props.onPress());
    assert.equal(input().props.value, 'Respuesta privada');
    const token = store.issueChatDraft({ actorId: recipient, recipientId: actor, text: 'Wrong binding' });
    state.params = { userId: recipient, ...token }; await app.update({});
    assert.equal(input().props.value, 'Respuesta privada');
    assert.equal(state.sent.length, 0);
  } finally { await app.unmount(); }
});

test('actual StoriesProvider authenticates strict QA methods and refreshes only after atomic publication', async () => {
  const fixture = base();
  const AuthContext = React.createContext(null);
  const state = { user: null, calls: [], reads: 0, invalid: false };
  const db = {
    from() {
      state.reads += 1;
      const chain = { select: () => chain, gt: () => chain, order: () => chain,
        then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) };
      return chain;
    },
    rpc: async (name, args) => {
      state.calls.push([name, args]);
      if (state.rpcResult) return state.rpcResult;
      return { data: state.invalid ? { question: 'private invalid envelope' }
        : name === 'prepare_story_question_answer' ? { question: '¿Cómo?', respondent_id: recipient } : actor, error: null };
    },
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; }, removeChannel() {},
  };
  Object.assign(fixture, { AuthContext, getSupabaseClient: () => db,
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } });
  const { StoriesProvider, StoriesContext } = await loadStoryQaComponent('contexts/StoriesContext.tsx', fixture, {
    '@/services/storyQuestionAnswerClient': storyQaModuleUrl('services/storyQuestionAnswerClient.ts'),
  });
  let context;
  function Capture() { context = React.useContext(StoriesContext); return null; }
  function Root() { return React.createElement(AuthContext.Provider, { value: { user: state.user } },
    React.createElement(StoriesProvider, null, React.createElement(Capture))); }
  const app = await mount(Root);
  try {
    await assert.rejects(context.prepareStoryQuestionAnswer(source), /STORY_QA_NOT_AUTHENTICATED/);
    assert.equal(state.calls.length, 0);
    state.user = { id: actor }; await app.update({});
    const before = state.reads;
    assert.deepEqual(await context.prepareStoryQuestionAnswer(source), { question: '¿Cómo?', respondentId: recipient });
    assert.equal(state.reads, before, 'preflight performs no provider refresh/write');
    assert.equal(await context.addQuestionAnswerStory({ source, mediaAssetId: recipient, composition: { version: 2, elements: [{ ...card, answer: 'Respuesta' }] }, clientStoryId: actor }), actor);
    assert.ok(state.reads > before);
    assert.deepEqual(state.calls.map(([name]) => name), ['prepare_story_question_answer', 'create_story_question_answer_with_media']);
    assert.deepEqual(context.storyGroups, []);
    let finishRpc;
    state.rpcResult = new Promise(resolve => { finishRpc = resolve; });
    const publishing = context.addQuestionAnswerStory({ source, mediaAssetId: recipient,
      composition: { version: 2, elements: [{ ...card, answer: 'Respuesta' }] }, clientStoryId: actor });
    state.user = null; await app.update({});
    const readsAfterLogout = state.reads;
    finishRpc({ data: actor, error: null });
    assert.equal(await publishing, actor, 'confirmed commit must stay confirmed so Feed never cleans linked media');
    assert.equal(state.reads, readsAfterLogout, 'old publication cannot refresh a replacement session');
    state.rpcResult = null;
    state.user = { id: actor }; await app.update({});
    state.invalid = true;
    await assert.rejects(context.prepareStoryQuestionAnswer(source), /^Error: STORY_QA_INVALID_RESPONSE$/);
  } finally { await app.unmount(); }
});

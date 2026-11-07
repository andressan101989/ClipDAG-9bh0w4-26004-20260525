import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import { loadStoryQaComponent } from './helpers/loadStoryQaComponent.mjs';
import { mount } from './helpers/storyQaHostRenderer.mjs';

const actorId = '20000000-0000-4000-8000-000000000001';
const draftId = '21000000-0000-4000-8000-000000000001';
const assetId = '22000000-0000-4000-8000-000000000001';
const metricProxy = new Proxy({}, { get: () => 8 });
const colorProxy = new Proxy({}, { get: () => '#111111' });

const draft = Object.freeze({
  id: draftId,
  clientRequestId: '23000000-0000-4000-8000-000000000001',
  kind: 'photo',
  caption: 'Fotografía privada preservada',
  music: 'Sin musica',
  composition: { layout: 'center' },
  state: 'draft',
  revision: 1,
  publishedPostId: null,
  assetIds: [assetId],
  createdAt: '2026-11-03T04:45:13.426803Z',
  updatedAt: '2026-11-03T04:45:13.426803Z',
  publishedAt: null,
  deletedAt: null,
});
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function nodeText(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.children ?? []).map(nodeText).join('');
}

function findPressableByText(app, text) {
  return app.find(node => node.type === 'Pressable' && nodeText(node).includes(text));
}

function draftFixture(overrides = {}) {
  const scrollCalls = [];
  const focus = { callback: null };
  const ScrollView = React.forwardRef(function QaScrollView({ children, ...props }, ref) {
    React.useImperativeHandle(ref, () => ({
      scrollToEnd: options => scrollCalls.push(options),
    }), []);
    return React.createElement('ScrollView', props, children);
  });
  const FlatList = ({ data = [], renderItem, ListHeaderComponent, ...props }) => {
    const header = React.isValidElement(ListHeaderComponent)
      ? ListHeaderComponent
      : typeof ListHeaderComponent === 'function'
        ? React.createElement(ListHeaderComponent)
        : null;
    return React.createElement(
      'FlatList',
      props,
      header,
      ...data.map((item, index) => React.createElement(
        React.Fragment,
        { key: item.id ?? index },
        renderItem({ item, index }),
      )),
    );
  };
  const manager = {
    listPublicationDrafts: async () => [],
    restorePublicationDraft: async () => draft,
    updatePublicationDraft: async input => ({ ...draft, caption: input.caption, revision: 2 }),
    deletePublicationDraft: async () => null,
    publishPublicationDraft: async () => '24000000-0000-4000-8000-000000000001',
    ...overrides.DraftManager,
  };
  return {
    fixture: {
      StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      ScrollView,
      FlatList,
      useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
      Colors: colorProxy,
      FontSize: metricProxy,
      FontWeight: metricProxy,
      Radius: metricProxy,
      Spacing: metricProxy,
      randomUUID,
      formatNumber: value => String(value ?? 0),
      useLocalSearchParams: () => ({ tab: 'drafts' }),
      useRouter: () => ({ push() {}, back() {} }),
      useFocusEffect: callback => {
        focus.callback = callback;
        React.useEffect(callback, [callback]);
      },
      useAuth: () => ({ user: { id: actorId } }),
      useFeed: () => ({ deleteVideo: async () => ({ success: true }) }),
      useAlert: () => ({ showAlert() {} }),
      fetchCreatorVideoFeed: async () => [],
      fetchSavedVideoFeed: async () => [],
      DraftManager: manager,
      getMediaUrl: async id => `https://media.example.test/private/${id}`,
      namespaces: { 'expo-crypto': { randomUUID } },
      ...overrides.fixture,
    },
    manager,
    focus,
    scrollCalls,
  };
}

test('draft deep link exposes a selected, visible Borradores tab and a true empty state', async () => {
  const harness = draftFixture();
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    assert.ok(app.nodes().some(node => node.text === 'Borradores privados'));
    assert.ok(app.nodes().some(node => node.text === 'Sin borradores'));
    const tab = findPressableByText(app, 'Borradores');
    assert.ok(tab);
    assert.equal(tab.props.accessibilityRole, 'tab');
    assert.deepEqual(tab.props.accessibilityState, { selected: true });
    assert.ok(harness.scrollCalls.length > 0, 'the off-screen fifth tab must be scrolled into view');
  } finally {
    await app.unmount();
  }
});

test('RPC failure is not rendered as an empty inbox and retry can recover the cloud draft', async () => {
  let calls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('function pg_catalog.least does not exist'), { code: '42883' });
        return [draft];
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    assert.ok(app.nodes().some(node => node.text === 'No se pudieron cargar tus borradores'));
    assert.equal(app.nodes().some(node => node.text === 'Sin borradores'), false);
    assert.equal(app.nodes().some(node => nodeText(node).includes('pg_catalog.least')), false,
      'raw database details must not be rendered');
    const retry = findPressableByText(app, 'Reintentar');
    assert.ok(retry);
    await app.flush(() => retry.props.onPress());
    assert.equal(calls, 2);
    assert.ok(app.nodes().some(node => node.text === draft.caption));
    assert.equal(app.nodes().some(node => node.text === 'Sin borradores'), false);
  } finally {
    await app.unmount();
  }
});

test('a populated inbox renders the private draft and restore preserves its canonical asset IDs', async () => {
  const state = { restores: [], media: [], updates: [], publishes: 0 };
  const never = deferred();
  const harness = draftFixture({
    fixture: {
      fetchCreatorVideoFeed: () => never.promise,
      fetchSavedVideoFeed: () => never.promise,
      getMediaUrl: async id => {
        state.media.push(id);
        return `https://media.example.test/private/${id}`;
      },
    },
    DraftManager: {
      listPublicationDrafts: async () => [draft],
      restorePublicationDraft: async id => { state.restores.push(id); return draft; },
      updatePublicationDraft: async input => {
        state.updates.push(input);
        return { ...draft, caption: input.caption, revision: 2 };
      },
      publishPublicationDraft: async () => { state.publishes += 1; return 'post'; },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    assert.ok(app.nodes().some(node => node.text === draft.caption),
      'draft rendering must not wait for unrelated Feed requests');
    assert.ok(app.nodes().some(node => nodeText(node) === 'Foto · revisión 1'));
    const restore = findPressableByText(app, 'Restaurar');
    assert.ok(restore);
    await app.flush(() => restore.props.onPress());
    assert.deepEqual(state.restores, [draftId]);
    assert.deepEqual(state.media, [assetId]);
    assert.ok(app.nodes().some(node => node.text === 'Reanudar borrador privado'));
    const preview = app.find(node => node.type === 'Image'
      && node.props.source?.uri === `https://media.example.test/private/${assetId}`);
    assert.ok(preview, 'restore must render the authorized private photograph');
    const caption = app.find(node => node.type === 'TextInput' && node.props.value === draft.caption);
    assert.ok(caption);
    await app.flush(() => caption.props.onChangeText('Descripción recuperada'));
    const save = findPressableByText(app, 'Guardar cambios');
    assert.ok(save);
    await app.flush(() => save.props.onPress());
    assert.equal(state.updates.length, 1);
    assert.deepEqual(state.updates[0].assetIds, [assetId]);
    assert.deepEqual(state.updates[0].composition, draft.composition);
    assert.equal(JSON.stringify(state.updates[0]).includes('media.example.test'), false,
      'signed delivery URLs must remain transient and never enter the draft mutation');
    assert.equal(state.publishes, 0, 'restore and save must never publish automatically');
  } finally {
    never.resolve([]);
    await app.unmount();
  }
});

test('late restore and media responses cannot cross selection or account boundaries', async () => {
  const firstRestore = deferred();
  const firstMedia = deferred();
  const auth = { user: { id: actorId } };
  const draftB = {
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    caption: 'Segundo borrador privado',
    assetIds: ['22000000-0000-4000-8000-000000000002'],
  };
  const harness = draftFixture({
    fixture: {
      useAuth: () => ({ user: auth.user }),
      getMediaUrl: id => id === assetId
        ? firstMedia.promise
        : Promise.resolve(`https://media.example.test/private/${id}`),
    },
    DraftManager: {
      listPublicationDrafts: async () => [draft, draftB],
      restorePublicationDraft: id => id === draftId ? firstRestore.promise : Promise.resolve(draftB),
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    let restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    assert.equal(restoreButtons.length, 2);
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => restoreButtons[1].props.onPress());
    assert.ok(app.nodes().some(node => node.type === 'TextInput' && node.props.value === draftB.caption));

    firstRestore.resolve(draft);
    await app.flush();
    assert.ok(app.nodes().some(node => node.type === 'TextInput' && node.props.value === draftB.caption),
      'a slower prior restore must not replace the selected draft');

    auth.user = { id: '20000000-0000-4000-8000-000000000099' };
    await app.update({});
    firstMedia.resolve(`https://media.example.test/private/${assetId}`);
    await app.flush();
    assert.equal(app.nodes().some(node => node.type === 'Image'
      && node.props.source?.uri?.includes(assetId)), false,
    'a prior owner media response must not appear after the authenticated user changes');
  } finally {
    await app.unmount();
  }
});

test('private preview failure is explicit and user retry can recover without changing the draft', async () => {
  let mediaCalls = 0;
  const harness = draftFixture({
    fixture: {
      getMediaUrl: async id => {
        mediaCalls += 1;
        if (mediaCalls === 1) throw new Error('media_url_failed');
        return `https://media.example.test/private/${id}`;
      },
    },
    DraftManager: {
      listPublicationDrafts: async () => [draft],
      restorePublicationDraft: async () => draft,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    assert.ok(app.nodes().some(node => node.text === 'No se pudo cargar la vista previa privada'));
    const retry = findPressableByText(app, 'Reintentar vista previa');
    assert.ok(retry);
    await app.flush(() => retry.props.onPress());
    assert.equal(mediaCalls, 2);
    assert.ok(app.nodes().some(node => node.type === 'Image'
      && node.props.source?.uri === `https://media.example.test/private/${assetId}`));
  } finally {
    await app.unmount();
  }
});

test('an older draft-list response cannot overwrite a newer focus reload', async () => {
  const first = deferred();
  let calls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => {
        calls += 1;
        return calls === 1 ? first.promise : [draft];
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    assert.equal(calls, 1);
    await app.flush(() => harness.focus.callback());
    assert.equal(calls, 2);
    assert.ok(app.nodes().some(node => node.text === draft.caption));
    first.resolve([]);
    await app.flush();
    assert.ok(app.nodes().some(node => node.text === draft.caption));
    assert.equal(app.nodes().some(node => node.text === 'Sin borradores'), false);
  } finally {
    await app.unmount();
  }
});

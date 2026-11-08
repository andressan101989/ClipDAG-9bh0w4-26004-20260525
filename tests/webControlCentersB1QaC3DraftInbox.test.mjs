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

function findDraftDeletePressable(app) {
  return app.find(node => node.type === 'Pressable'
    && node.children?.some(child => child.type === 'MaterialIcons'
      && child.props?.name === 'delete-outline'));
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
  const FlatList = ({ data = [], renderItem, ListHeaderComponent, ListFooterComponent, ...props }) => {
    const header = React.isValidElement(ListHeaderComponent)
      ? ListHeaderComponent
      : typeof ListHeaderComponent === 'function'
        ? React.createElement(ListHeaderComponent)
        : null;
    const footer = React.isValidElement(ListFooterComponent)
      ? ListFooterComponent
      : typeof ListFooterComponent === 'function'
        ? React.createElement(ListFooterComponent)
        : null;
    return React.createElement(
      'FlatList',
      { ...props, data },
      header,
      ...data.map((item, index) => React.createElement(
        React.Fragment,
        { key: item.id ?? index },
        renderItem({ item, index }),
      )),
      footer,
    );
  };
  const manager = {
    listPublicationDrafts: async () => ({ items: [], nextCursor: null }),
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
        return { items: [draft], nextCursor: null };
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
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
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
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
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
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
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
        return calls === 1 ? first.promise : { items: [draft], nextCursor: null };
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
    first.resolve({ items: [], nextCursor: null });
    await app.flush();
    assert.ok(app.nodes().some(node => node.text === draft.caption));
    assert.equal(app.nodes().some(node => node.text === 'Sin borradores'), false);
  } finally {
    await app.unmount();
  }
});

test('a late draft-list response is fenced to the authenticated owner', async () => {
  const first = deferred();
  let calls = 0;
  let setAuthenticatedUser;
  const nextActorId = '20000000-0000-4000-8000-000000000099';
  const harness = draftFixture({
    fixture: {
      useAuth: () => {
        const [user, setUser] = React.useState({ id: actorId });
        setAuthenticatedUser = setUser;
        return { user };
      },
    },
    DraftManager: {
      listPublicationDrafts: async () => {
        calls += 1;
        return calls === 1 ? first.promise : { items: [], nextCursor: null };
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    assert.equal(calls, 1);
    await app.flush(() => {
      setAuthenticatedUser({ id: nextActorId });
      first.resolve({ items: [draft], nextCursor: null });
    });
    assert.ok(calls >= 2, 'the new authenticated owner must receive a fresh list request');
    assert.equal(app.nodes().some(node => node.text === draft.caption), false,
      'a previous owner draft must never render after the account changes');
  } finally {
    await app.unmount();
  }
});

function numberedDraft(number, overrides = {}) {
  return {
    ...draft,
    id: `draft-${number}`,
    clientRequestId: `request-${number}`,
    caption: `Borrador ${number}`,
    assetIds: [`asset-${number}`],
    ...overrides,
  };
}

const cursorOne = Object.freeze({ updatedAt: '2026-11-02T00:00:00.000Z', id: 'cursor-1' });

test('continuation appends drafts once and deduplicates by id without changing first-seen order', async () => {
  const pageOne = Array.from({ length: 50 }, (_, index) => numberedDraft(index + 1));
  const row51 = numberedDraft(51);
  const calls = [];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => {
        const cursor = input?.cursor ?? null;
        calls.push(input);
        return cursor
          ? { items: [{ ...pageOne[49], caption: 'Borrador 50 actualizado' }, row51], nextCursor: null }
          : { items: pageOne, nextCursor: cursorOne };
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    let list = app.find(node => node.type === 'FlatList');
    assert.ok(list, 'page items must render through the canonical page contract');
    assert.deepEqual(list.props.data.map(item => item.id), pageOne.map(item => item.id));
    await app.flush(() => list.props.onEndReached());
    list = app.find(node => node.type === 'FlatList');
    assert.deepEqual(calls, [
      { limit: 50, cursor: null },
      { limit: 50, cursor: cursorOne },
    ]);
    assert.deepEqual(list.props.data.map(item => item.id), [...pageOne.map(item => item.id), row51.id]);
  } finally {
    await app.unmount();
  }
});

test('a failed continuation preserves page one and retries only the failed cursor', async () => {
  const first = numberedDraft(1);
  const second = numberedDraft(2);
  const calls = [];
  let continuationAttempts = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => {
        const cursor = input?.cursor ?? null;
        calls.push(input);
        if (!cursor) return { items: [first], nextCursor: cursorOne };
        continuationAttempts += 1;
        if (continuationAttempts === 1) throw new Error('private rpc detail');
        return { items: [second], nextCursor: null };
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    let list = app.find(node => node.type === 'FlatList');
    assert.ok(list, 'page one must remain renderable while continuation state changes');
    await app.flush(() => list.props.onEndReached());
    list = app.find(node => node.type === 'FlatList');
    assert.deepEqual(list.props.data.map(item => item.id), [first.id]);
    assert.ok(app.nodes().some(node => node.text === 'No se pudieron cargar más borradores'));
    assert.equal(app.nodes().some(node => nodeText(node).includes('private rpc detail')), false);

    await app.flush(() => list.props.onEndReached());
    assert.equal(calls.length, 2, 'end-reached must not retry a failed cursor automatically');

    const retry = findPressableByText(app, 'Reintentar');
    assert.ok(retry);
    await app.flush(() => retry.props.onPress());
    list = app.find(node => node.type === 'FlatList');
    assert.deepEqual(calls, [
      { limit: 50, cursor: null },
      { limit: 50, cursor: cursorOne },
      { limit: 50, cursor: cursorOne },
    ]);
    assert.deepEqual(list.props.data.map(item => item.id), [first.id, second.id]);
  } finally {
    await app.unmount();
  }
});

test('duplicate end-reached events issue only one in-flight request for the same cursor', async () => {
  const first = numberedDraft(1);
  const second = numberedDraft(2);
  const continuation = deferred();
  const calls = [];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => {
        const cursor = input?.cursor ?? null;
        calls.push(input);
        return cursor ? continuation.promise : { items: [first], nextCursor: cursorOne };
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const list = app.find(node => node.type === 'FlatList');
    assert.ok(list, 'page items must render before end-reached can request a continuation');
    await app.flush(() => {
      void list.props.onEndReached();
      void list.props.onEndReached();
    });
    assert.deepEqual(calls, [
      { limit: 50, cursor: null },
      { limit: 50, cursor: cursorOne },
    ]);
    continuation.resolve({ items: [second], nextCursor: null });
    await app.flush();
    assert.deepEqual(app.find(node => node.type === 'FlatList').props.data.map(item => item.id), [first.id, second.id]);
  } finally {
    await app.unmount();
  }
});

test('an exact 50-row page performs one empty continuation fetch and then stops', async () => {
  const page = Array.from({ length: 50 }, (_, index) => numberedDraft(index + 1));
  const calls = [];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => {
        const cursor = input?.cursor ?? null;
        calls.push(input);
        return cursor ? { items: [], nextCursor: null } : { items: page, nextCursor: cursorOne };
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    let list = app.find(node => node.type === 'FlatList');
    assert.ok(list, 'an exact full page must render before probing for a continuation');
    assert.equal(list.props.data.length, 50);
    await app.flush(() => list.props.onEndReached());
    list = app.find(node => node.type === 'FlatList');
    assert.equal(list.props.data.length, 50);
    await app.flush(() => list.props.onEndReached());
    assert.deepEqual(calls, [
      { limit: 50, cursor: null },
      { limit: 50, cursor: cursorOne },
    ]);
  } finally {
    await app.unmount();
  }
});

test('a refocus replaces accumulated rows and fences an older continuation response', async () => {
  const first = numberedDraft(1);
  const stale = numberedDraft(2);
  const fresh = numberedDraft(99);
  const continuation = deferred();
  let calls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => {
        const cursor = input?.cursor ?? null;
        calls += 1;
        if (cursor) return continuation.promise;
        return calls === 1
          ? { items: [first], nextCursor: cursorOne }
          : { items: [fresh], nextCursor: null };
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const firstList = app.find(node => node.type === 'FlatList');
    assert.ok(firstList, 'page one must render before the stale continuation race is exercised');
    await app.flush(() => firstList.props.onEndReached());
    assert.equal(calls, 2);
    await app.flush(() => harness.focus.callback());
    assert.equal(calls, 3);
    assert.deepEqual(app.find(node => node.type === 'FlatList').props.data.map(item => item.id), [fresh.id]);

    continuation.resolve({ items: [stale], nextCursor: null });
    await app.flush();
    assert.deepEqual(app.find(node => node.type === 'FlatList').props.data.map(item => item.id), [fresh.id]);
  } finally {
    await app.unmount();
  }
});

test('publishing a dirty restored caption CAS-saves first and publishes the exact confirmed revision', async () => {
  const updated = Object.freeze({ ...draft, caption: 'Descripción visible confirmada', revision: 2 });
  const events = [];
  const updates = [];
  const publishes = [];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async input => {
        events.push('update');
        updates.push(input);
        return updated;
      },
      publishPublicationDraft: async input => {
        events.push('publish');
        publishes.push(input);
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    const caption = app.find(node => node.type === 'TextInput');
    await app.flush(() => caption.props.onChangeText(`  ${updated.caption}  `));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    assert.deepEqual(events, ['update', 'publish']);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].expectedRevision, draft.revision);
    assert.equal(updates[0].caption, updated.caption);
    assert.equal(publishes.length, 1);
    assert.equal(publishes[0].draft, updated,
      'publish must receive the exact object returned by the confirmed CAS update');
    assert.equal(publishes[0].draft.revision, 2);
  } finally {
    await app.unmount();
  }
});

test('a dirty-caption CAS failure issues zero publishes and preserves the visible editor state', async () => {
  const updates = [];
  const publishes = [];
  const visibleCaption = 'Cambio que todavía no fue confirmado';
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async input => {
        updates.push(input);
        throw Object.assign(new Error('draft_revision_conflict'), { code: 'P0001' });
      },
      publishPublicationDraft: async input => {
        publishes.push(input);
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(visibleCaption));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    assert.equal(updates.length, 1);
    assert.equal(publishes.length, 0);
    assert.ok(app.nodes().some(node => node.type === 'TextInput' && node.props.value === visibleCaption),
      'the unsaved visible caption must remain editable after the CAS rejection');
    assert.ok(app.nodes().some(node => node.text === 'Reanudar borrador privado'));
  } finally {
    await app.unmount();
  }
});

test('one synchronous draft lock excludes save and delete throughout dirty save then publish', async () => {
  const updateGate = deferred();
  const publishGate = deferred();
  const updated = Object.freeze({ ...draft, caption: 'Revisión bajo bloqueo', revision: 2 });
  const alerts = [];
  const calls = { updates: 0, publishes: 0, deletes: 0 };
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async () => {
        calls.updates += 1;
        return updateGate.promise;
      },
      publishPublicationDraft: async () => {
        calls.publishes += 1;
        return publishGate.promise;
      },
      deletePublicationDraft: async () => {
        calls.deletes += 1;
        return draft;
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(updated.caption));
    await app.flush(() => {
      findPressableByText(app, 'Publicar').props.onPress();
      findPressableByText(app, 'Guardar cambios').props.onPress();
    });
    assert.deepEqual(calls, { updates: 1, publishes: 0, deletes: 0 });

    await app.flush(() => findDraftDeletePressable(app).props.onPress());
    const firstDelete = alerts.find(entry => entry.title === 'Eliminar borrador');
    await app.flush(() => firstDelete.actions.find(action => action.text === 'Eliminar').onPress());
    assert.equal(calls.deletes, 0, 'delete must do nothing while the CAS update owns the draft lock');

    updateGate.resolve(updated);
    await app.flush();
    assert.deepEqual(calls, { updates: 1, publishes: 1, deletes: 0 });

    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText('Otro cambio competidor'));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());
    await app.flush(() => findDraftDeletePressable(app).props.onPress());
    const secondDelete = alerts.filter(entry => entry.title === 'Eliminar borrador').at(-1);
    await app.flush(() => secondDelete.actions.find(action => action.text === 'Eliminar').onPress());
    assert.deepEqual(calls, { updates: 1, publishes: 1, deletes: 0 },
      'save and delete must do nothing while publish still owns the same draft lock');

    publishGate.resolve('24000000-0000-4000-8000-000000000001');
    await app.flush();
  } finally {
    updateGate.resolve(updated);
    publishGate.resolve('24000000-0000-4000-8000-000000000001');
    await app.flush();
    await app.unmount();
  }
});

test('ambiguous retry reuses command A and a local deterministic conflict rotates the next attempt to B', async () => {
  const commandA = '25000000-0000-4000-8000-000000000001';
  const commandB = '25000000-0000-4000-8000-000000000002';
  const generated = [commandA, commandB];
  const publishes = [];
  const harness = draftFixture({
    fixture: { randomUUID: () => generated.shift() },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      publishPublicationDraft: async input => {
        publishes.push(input);
        if (publishes.length === 1) throw new Error('network response lost');
        if (publishes.length === 2) throw new Error('draft_publish_command_conflict');
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    assert.deepEqual(publishes.map(input => input.clientCommandId), [commandA, commandA, commandB]);
    assert.deepEqual(publishes.map(input => input.draft.revision), [1, 1, 1]);
    assert.ok(publishes.every(input => input.draft === draft));
  } finally {
    await app.unmount();
  }
});

test('an ambiguous caption A mutation is reconciled before caption B is CAS-saved and published', async () => {
  const captionA = 'Primera descripción con respuesta perdida';
  const captionB = 'Segunda descripción visible';
  const confirmedA = Object.freeze({ ...draft, caption: captionA, revision: 2 });
  const confirmedB = Object.freeze({ ...draft, caption: captionB, revision: 3 });
  const updates = [];
  const publishes = [];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async input => {
        updates.push(input);
        if (updates.length === 1) throw new Error('network response lost');
        return updates.length === 2 ? confirmedA : confirmedB;
      },
      publishPublicationDraft: async input => {
        publishes.push(input);
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(captionA));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    assert.equal(publishes.length, 0);

    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(captionB));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    assert.deepEqual(updates.map(input => input.caption), [captionA, captionA, captionB]);
    assert.equal(updates[1].clientMutationId, updates[0].clientMutationId,
      'the ambiguous caption A command must be reconciled with its stable identity');
    assert.notEqual(updates[2].clientMutationId, updates[0].clientMutationId,
      'caption B must use a new command after caption A is confirmed');
    assert.deepEqual(updates.map(input => input.expectedRevision), [1, 1, 2]);
    assert.equal(publishes.length, 1);
    assert.equal(publishes[0].draft, confirmedB);
    assert.equal(publishes[0].draft.caption, captionB);
  } finally {
    await app.unmount();
  }
});

test('switching owner during dirty CAS suppresses stale UI and prevents publication', async () => {
  const updateGate = deferred();
  const alerts = [];
  const publishes = [];
  let setAuthenticatedUser;
  let listCalls = 0;
  const updated = Object.freeze({ ...draft, caption: 'Cambio del propietario anterior', revision: 2 });
  const harness = draftFixture({
    fixture: {
      useAuth: () => {
        const [user, setUser] = React.useState({ id: actorId });
        setAuthenticatedUser = setUser;
        return { user };
      },
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => {
        listCalls += 1;
        return { items: listCalls === 1 ? [draft] : [], nextCursor: null };
      },
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async () => updateGate.promise,
      publishPublicationDraft: async input => {
        publishes.push(input);
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(updated.caption));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    await app.flush(() => setAuthenticatedUser({ id: '20000000-0000-4000-8000-000000000099' }));
    assert.equal(app.nodes().some(node => node.text === 'Reanudar borrador privado'), false);

    updateGate.resolve(updated);
    await app.flush();
    assert.equal(publishes.length, 0, 'an old-owner CAS completion must not continue into publish');
    assert.equal(app.nodes().some(node => node.text === 'Reanudar borrador privado'), false);
    assert.equal(app.nodes().some(node => node.type === 'TextInput'), false);
    assert.deepEqual(alerts, [], 'old-owner completion must not alert in the new owner session');
  } finally {
    updateGate.resolve(updated);
    await app.flush();
    await app.unmount();
  }
});

test('a late standalone save completion cannot repopulate or alert the new owner', async () => {
  const updateGate = deferred();
  const alerts = [];
  let setAuthenticatedUser;
  let listCalls = 0;
  const updated = Object.freeze({ ...draft, caption: 'Guardado del propietario anterior', revision: 2 });
  const harness = draftFixture({
    fixture: {
      useAuth: () => {
        const [user, setUser] = React.useState({ id: actorId });
        setAuthenticatedUser = setUser;
        return { user };
      },
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => {
        listCalls += 1;
        return { items: listCalls === 1 ? [draft] : [], nextCursor: null };
      },
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async () => updateGate.promise,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(updated.caption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());
    await app.flush(() => setAuthenticatedUser({ id: '20000000-0000-4000-8000-000000000099' }));

    updateGate.resolve(updated);
    await app.flush();
    assert.equal(app.nodes().some(node => node.text === 'Reanudar borrador privado'), false);
    assert.equal(app.nodes().some(node => node.type === 'TextInput'), false);
    assert.deepEqual(alerts, []);
  } finally {
    updateGate.resolve(updated);
    await app.flush();
    await app.unmount();
  }
});

test('a late delete completion cannot remove the new owner draft projection', async () => {
  const deleteGate = deferred();
  const alerts = [];
  let setAuthenticatedUser;
  let listCalls = 0;
  const nextOwnerDraft = Object.freeze({
    ...draft,
    caption: 'Borrador de la sesión nueva',
    clientRequestId: '23000000-0000-4000-8000-000000000099',
  });
  const harness = draftFixture({
    fixture: {
      useAuth: () => {
        const [user, setUser] = React.useState({ id: actorId });
        setAuthenticatedUser = setUser;
        return { user };
      },
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => {
        listCalls += 1;
        return { items: [listCalls === 1 ? draft : nextOwnerDraft], nextCursor: null };
      },
      deletePublicationDraft: async () => deleteGate.promise,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findDraftDeletePressable(app).props.onPress());
    const confirmation = alerts.find(entry => entry.title === 'Eliminar borrador');
    await app.flush(() => confirmation.actions.find(action => action.text === 'Eliminar').onPress());
    await app.flush(() => setAuthenticatedUser({ id: '20000000-0000-4000-8000-000000000099' }));
    assert.ok(app.nodes().some(node => node.text === nextOwnerDraft.caption));

    deleteGate.resolve(draft);
    await app.flush();
    assert.ok(app.nodes().some(node => node.text === nextOwnerDraft.caption),
      'the prior owner delete completion must not filter the new owner projection');
  } finally {
    deleteGate.resolve(draft);
    await app.flush();
    await app.unmount();
  }
});

test('an ambiguous caption mutation is reconciled before publishing a reverted caption', async () => {
  const captionA = 'Descripción con respuesta perdida';
  const confirmedA = Object.freeze({ ...draft, caption: captionA, revision: 2 });
  const reverted = Object.freeze({ ...draft, revision: 3 });
  const updates = [];
  const publishes = [];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async input => {
        updates.push(input);
        if (updates.length === 1) throw new Error('network response lost');
        return updates.length === 2 ? confirmedA : reverted;
      },
      publishPublicationDraft: async input => {
        publishes.push(input);
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(captionA));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    assert.equal(publishes.length, 0);

    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(draft.caption));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    assert.deepEqual(updates.map(input => input.caption), [captionA, captionA, draft.caption]);
    assert.equal(updates[1].clientMutationId, updates[0].clientMutationId);
    assert.notEqual(updates[2].clientMutationId, updates[0].clientMutationId);
    assert.deepEqual(updates.map(input => input.expectedRevision), [1, 1, 2]);
    assert.equal(publishes.length, 1);
    assert.equal(publishes[0].draft, reverted);
  } finally {
    await app.unmount();
  }
});

test('a same-owner save carries the confirmed revision into the next save without overwriting newer text', async () => {
  const updateGate = deferred();
  const submittedCaption = 'Descripción enviada';
  const newerCaption = 'Texto local más reciente';
  const updated = Object.freeze({ ...draft, caption: submittedCaption, revision: 2 });
  const updatedAgain = Object.freeze({ ...draft, caption: newerCaption, revision: 3 });
  const updates = [];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async input => {
        updates.push(input);
        return updates.length === 1 ? updateGate.promise : updatedAgain;
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(submittedCaption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(newerCaption));

    updateGate.resolve(updated);
    await app.flush();

    assert.equal(app.find(node => node.type === 'TextInput').props.value, newerCaption,
      'a completed save must not overwrite newer local text');

    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());
    assert.deepEqual(updates.map(input => input.expectedRevision), [1, 2],
      'the next save must use the canonical revision confirmed by the pending save');
    assert.deepEqual(updates.map(input => input.caption), [submittedCaption, newerCaption]);
    assert.equal(app.find(node => node.type === 'TextInput').props.value, newerCaption);
  } finally {
    updateGate.resolve(updated);
    await app.flush();
    await app.unmount();
  }
});

test('a delayed save response cannot downgrade a newer canonical revision restored for the same draft', async () => {
  const updateGate = deferred();
  const submittedCaption = 'Descripción enviada antes de rev3';
  const restoredRevision3 = Object.freeze({ ...draft, caption: 'Revisión externa más reciente', revision: 3 });
  const nextCaption = 'Edición basada en revisión 3';
  const confirmedRevision2 = Object.freeze({ ...draft, caption: submittedCaption, revision: 2 });
  const confirmedRevision4 = Object.freeze({ ...draft, caption: nextCaption, revision: 4 });
  const updates = [];
  let restoreCalls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => {
        restoreCalls += 1;
        return restoreCalls === 1 ? draft : restoredRevision3;
      },
      updatePublicationDraft: async input => {
        updates.push(input);
        return updates.length === 1 ? updateGate.promise : confirmedRevision4;
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(submittedCaption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    assert.equal(app.find(node => node.type === 'TextInput').props.value, restoredRevision3.caption);

    updateGate.resolve(confirmedRevision2);
    await app.flush();
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(nextCaption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    assert.deepEqual(updates.map(input => input.expectedRevision), [1, 3],
      'a delayed rev2 response must not replace the already restored rev3 base');
  } finally {
    updateGate.resolve(confirmedRevision2);
    await app.flush();
    await app.unmount();
  }
});

test('a same-owner publish completion allows a newer pending restore to replace the published editor', async () => {
  const publishGate = deferred();
  const restoreBGate = deferred();
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'Segundo borrador restaurado',
  });
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: async id => id === draft.id ? draft : restoreBGate.promise,
      publishPublicationDraft: async () => publishGate.promise,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    const restoreSecondDraft = restoreButtons[1];
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    await app.flush(() => restoreSecondDraft.props.onPress());

    publishGate.resolve('24000000-0000-4000-8000-000000000001');
    await app.flush();
    restoreBGate.resolve(draftB);
    await app.flush();
    const editorAfterPublish = app.find(node => node.type === 'TextInput');
    assert.ok(editorAfterPublish, 'the newer restore must survive publication of the first draft');
    assert.equal(editorAfterPublish.props.value, draftB.caption);
  } finally {
    publishGate.resolve('24000000-0000-4000-8000-000000000001');
    restoreBGate.resolve(draftB);
    await app.flush();
    await app.unmount();
  }
});

test('a same-owner delete completion allows a newer pending restore to replace the deleted editor', async () => {
  const deleteGate = deferred();
  const restoreBGate = deferred();
  const alerts = [];
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'Segundo borrador restaurado',
  });
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: async id => id === draft.id ? draft : restoreBGate.promise,
      deletePublicationDraft: async () => deleteGate.promise,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    const restoreSecondDraft = restoreButtons[1];
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => findDraftDeletePressable(app).props.onPress());
    const confirmation = alerts.find(entry => entry.title === 'Eliminar borrador');
    await app.flush(() => confirmation.actions.find(action => action.text === 'Eliminar').onPress());

    await app.flush(() => restoreSecondDraft.props.onPress());

    deleteGate.resolve(draft);
    await app.flush();
    restoreBGate.resolve(draftB);
    await app.flush();
    const editorAfterDelete = app.find(node => node.type === 'TextInput');
    assert.ok(editorAfterDelete, 'the newer restore must survive deletion of the first draft');
    assert.equal(editorAfterDelete.props.value, draftB.caption);
  } finally {
    deleteGate.resolve(draft);
    restoreBGate.resolve(draftB);
    await app.flush();
    await app.unmount();
  }
});

test('delete completion closes the same draft restored after deletion started', async () => {
  const deleteGate = deferred();
  const alerts = [];
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'Borrador que mantiene visible la bandeja',
  });
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      deletePublicationDraft: async () => deleteGate.promise,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findDraftDeletePressable(app).props.onPress());
    const confirmation = alerts.find(entry => entry.title === 'Eliminar borrador');
    await app.flush(() => confirmation.actions.find(action => action.text === 'Eliminar').onPress());
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    assert.equal(app.find(node => node.type === 'TextInput').props.value, draft.caption);

    deleteGate.resolve(draft);
    await app.flush();
    assert.equal(app.nodes().some(node => node.type === 'TextInput'), false,
      'a confirmed deletion must close its draft even when restore completed after delete started');
  } finally {
    deleteGate.resolve(draft);
    await app.flush();
    await app.unmount();
  }
});

test('a refocus response started before save cannot replace the confirmed revision', async () => {
  const staleReload = deferred();
  const updated = Object.freeze({ ...draft, caption: 'Revisión confirmada', revision: 2 });
  let listCalls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => {
        listCalls += 1;
        return listCalls === 1 ? { items: [draft], nextCursor: null } : staleReload.promise;
      },
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async () => updated,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => harness.focus.callback());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(updated.caption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    assert.ok(app.nodes().some(node => node.text === updated.caption));
    assert.equal(app.nodes().some(node => node.text === draft.caption), false,
      'a stale refocus response must not replace the saved list revision');
  } finally {
    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    await app.unmount();
  }
});

test('a save during refocus preserves a usable continuation cursor after the stale reload is discarded', async () => {
  const staleReload = deferred();
  const updated = Object.freeze({ ...draft, caption: 'Revisión confirmada', revision: 2 });
  const pageOne = [draft, ...Array.from({ length: 49 }, (_, index) => numberedDraft(index + 2))];
  const row51 = numberedDraft(51);
  const continuationCalls = [];
  let initialCalls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => {
        if (input.cursor) {
          continuationCalls.push(input);
          return { items: [row51], nextCursor: null };
        }
        initialCalls += 1;
        return initialCalls === 1
          ? { items: pageOne, nextCursor: cursorOne }
          : staleReload.promise;
      },
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async () => updated,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => harness.focus.callback());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(updated.caption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    const list = app.find(node => node.type === 'FlatList' && typeof node.props.onEndReached === 'function');
    await app.flush(() => list.props.onEndReached());

    assert.deepEqual(continuationCalls, [{ limit: 50, cursor: cursorOne }],
      'discarding the stale refocus must not silently terminate pagination');
    assert.ok(app.nodes().some(node => node.text === row51.caption));
  } finally {
    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    await app.unmount();
  }
});

test('continuation waits for refocus and then uses only the refreshed cursor chain', async () => {
  const refocusGate = deferred();
  const oldPage = Array.from({ length: 50 }, (_, index) => numberedDraft(index + 1));
  const refreshedPage = Array.from({ length: 40 }, (_, index) => numberedDraft(index + 101));
  const refreshedRow41 = numberedDraft(141);
  const refreshedCursor = Object.freeze({
    updatedAt: '2026-11-03T00:00:00.000Z',
    id: 'cursor-refreshed-40',
  });
  const continuationCalls = [];
  let initialCalls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => {
        if (input.cursor) {
          continuationCalls.push(input);
          return { items: [refreshedRow41], nextCursor: null };
        }
        initialCalls += 1;
        return initialCalls === 1
          ? { items: oldPage, nextCursor: cursorOne }
          : refocusGate.promise;
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => harness.focus.callback());
    let list = app.find(node => node.type === 'FlatList' && typeof node.props.onEndReached === 'function');
    await app.flush(() => list.props.onEndReached());
    assert.deepEqual(continuationCalls, [],
      'the old cursor chain must remain unavailable while a refocus page is pending');

    refocusGate.resolve({ items: refreshedPage, nextCursor: refreshedCursor });
    await app.flush();
    list = app.find(node => node.type === 'FlatList' && typeof node.props.onEndReached === 'function');
    await app.flush(() => list.props.onEndReached());

    assert.deepEqual(continuationCalls, [{ limit: 50, cursor: refreshedCursor }]);
    assert.ok(app.nodes().some(node => node.text === refreshedRow41.caption));
    assert.equal(app.nodes().some(node => node.text === oldPage[0].caption), false);
  } finally {
    refocusGate.resolve({ items: refreshedPage, nextCursor: refreshedCursor });
    await app.flush();
    await app.unmount();
  }
});

test('a continuation response started before save cannot downgrade the confirmed revision', async () => {
  const staleContinuation = deferred();
  const updated = Object.freeze({ ...draft, caption: 'Revisión confirmada', revision: 2 });
  const pageOne = [draft, ...Array.from({ length: 49 }, (_, index) => numberedDraft(index + 1))];
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async input => input.cursor
        ? staleContinuation.promise
        : { items: pageOne, nextCursor: cursorOne },
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async () => updated,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    const list = app.find(node => node.type === 'FlatList' && typeof node.props.onEndReached === 'function');
    await app.flush(() => list.props.onEndReached());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(updated.caption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    staleContinuation.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    assert.ok(app.nodes().some(node => node.text === updated.caption));
    assert.equal(app.nodes().some(node => node.text === draft.caption), false,
      'a stale continuation must not overwrite the saved list revision');
  } finally {
    staleContinuation.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    await app.unmount();
  }
});

test('a refocus response started before publish cannot re-add the published draft', async () => {
  const staleReload = deferred();
  let listCalls = 0;
  const harness = draftFixture({
    DraftManager: {
      listPublicationDrafts: async () => {
        listCalls += 1;
        return listCalls === 1 ? { items: [draft], nextCursor: null } : staleReload.promise;
      },
      restorePublicationDraft: async () => draft,
      publishPublicationDraft: async () => '24000000-0000-4000-8000-000000000001',
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => harness.focus.callback());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    assert.equal(app.nodes().some(node => node.text === draft.caption), false,
      'a stale refocus response must not re-add a published draft');
  } finally {
    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    await app.unmount();
  }
});

test('a refocus response started before delete cannot re-add the deleted draft', async () => {
  const staleReload = deferred();
  const alerts = [];
  let listCalls = 0;
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => {
        listCalls += 1;
        return listCalls === 1 ? { items: [draft], nextCursor: null } : staleReload.promise;
      },
      deletePublicationDraft: async () => draft,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => harness.focus.callback());
    await app.flush(() => findDraftDeletePressable(app).props.onPress());
    const confirmation = alerts.find(entry => entry.title === 'Eliminar borrador');
    await app.flush(() => confirmation.actions.find(action => action.text === 'Eliminar').onPress());

    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    assert.equal(app.nodes().some(node => node.text === draft.caption), false,
      'a stale refocus response must not re-add a deleted draft');
  } finally {
    staleReload.resolve({ items: [draft], nextCursor: null });
    await app.flush();
    await app.unmount();
  }
});

test('save A completing after pending restore B never mutates B or carries A caption into its next save', async () => {
  const restoreBGate = deferred();
  const updateAGate = deferred();
  const alerts = [];
  const captionA = 'A NEW CAPTION';
  const captionB = 'B NEW CAPTION';
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'B ORIGINAL',
    assetIds: ['22000000-0000-4000-8000-000000000002'],
  });
  const confirmedA = Object.freeze({ ...draft, caption: captionA, revision: 2 });
  const confirmedB = Object.freeze({ ...draftB, caption: captionB, revision: 2 });
  const updates = [];
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: id => id === draft.id ? Promise.resolve(draft) : restoreBGate.promise,
      updatePublicationDraft: input => {
        updates.push(input);
        return updates.length === 1 ? updateAGate.promise : Promise.resolve(confirmedB);
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    let restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(captionA));
    await app.flush(() => restoreButtons[1].props.onPress());
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    await app.flush(() => {
      restoreBGate.resolve(draftB);
      updateAGate.resolve(confirmedA);
    });

    assert.equal(app.find(node => node.type === 'TextInput').props.value, draftB.caption,
      'the completed save for A must not write A caption into the newer B editor');
    assert.equal(alerts.some(entry => entry.title === 'Borrador sincronizado'), false,
      'a stale A completion must not show a success alert over B');

    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(captionB));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    assert.deepEqual(updates.map(input => ({ id: input.id, caption: input.caption, expectedRevision: input.expectedRevision })), [
      { id: draft.id, caption: captionA, expectedRevision: 1 },
      { id: draftB.id, caption: captionB, expectedRevision: 1 },
    ]);
  } finally {
    restoreBGate.resolve(draftB);
    updateAGate.resolve(confirmedA);
    await app.flush();
    await app.unmount();
  }
});

test('dirty publish A completing after pending restore B preserves B and publishes only the confirmed A snapshot', async () => {
  const restoreBGate = deferred();
  const updateAGate = deferred();
  const alerts = [];
  const captionA = 'A DIRTY PUBLISH';
  const captionB = 'B AFTER A PUBLISH';
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'B ORIGINAL',
    assetIds: ['22000000-0000-4000-8000-000000000002'],
  });
  const confirmedA = Object.freeze({ ...draft, caption: captionA, revision: 2 });
  const confirmedB = Object.freeze({ ...draftB, caption: captionB, revision: 2 });
  const updates = [];
  const publishes = [];
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: id => id === draft.id ? Promise.resolve(draft) : restoreBGate.promise,
      updatePublicationDraft: input => {
        updates.push(input);
        return updates.length === 1 ? updateAGate.promise : Promise.resolve(confirmedB);
      },
      publishPublicationDraft: async input => {
        publishes.push(input);
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(captionA));
    await app.flush(() => restoreButtons[1].props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    await app.flush(() => {
      restoreBGate.resolve(draftB);
      updateAGate.resolve(confirmedA);
    });

    assert.equal(publishes.length, 1);
    assert.equal(publishes[0].draft, confirmedA);
    assert.equal(app.find(node => node.type === 'TextInput').props.value, draftB.caption,
      'A autosave/publish completion must not write A caption into B');
    assert.equal(alerts.some(entry => entry.title === 'Publicado'), false,
      'a stale A publication must not show a completion alert over B');

    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(captionB));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());
    assert.deepEqual(updates.map(input => ({ id: input.id, caption: input.caption, expectedRevision: input.expectedRevision })), [
      { id: draft.id, caption: captionA, expectedRevision: 1 },
      { id: draftB.id, caption: captionB, expectedRevision: 1 },
    ]);
  } finally {
    restoreBGate.resolve(draftB);
    updateAGate.resolve(confirmedA);
    await app.flush();
    await app.unmount();
  }
});

test('ambiguous publish remains accessible after an empty refocus and replays the exact command snapshot', async () => {
  const commandA = '25000000-0000-4000-8000-000000000001';
  const publishes = [];
  let listCalls = 0;
  const harness = draftFixture({
    fixture: { randomUUID: () => commandA },
    DraftManager: {
      listPublicationDrafts: async () => {
        listCalls += 1;
        return { items: listCalls === 1 ? [draft] : [], nextCursor: null };
      },
      restorePublicationDraft: async () => draft,
      publishPublicationDraft: async input => {
        publishes.push(input);
        if (publishes.length === 1) throw new Error('network response lost after commit');
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    await app.flush(() => harness.focus.callback());

    assert.ok(app.nodes().some(node => node.type === 'TextInput'),
      'the pending editor must stay reachable even when the refreshed cloud list is empty');
    assert.ok(findPressableByText(app, 'Publicar'));
    assert.equal(app.nodes().some(node => node.text === 'Sin borradores'), false);

    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    assert.equal(publishes.length, 2);
    assert.deepEqual(publishes.map(input => input.clientCommandId), [commandA, commandA]);
    assert.ok(publishes.every(input => input.draft === draft),
      'the replay must use the exact canonical draft snapshot from the first attempt');
  } finally {
    await app.unmount();
  }
});

test('editing after an ambiguous publish reconciles the prior command before any caption update', async () => {
  const commandA = '25000000-0000-4000-8000-000000000001';
  const newCaption = 'Caption editada después de respuesta incierta';
  const updates = [];
  const publishes = [];
  const harness = draftFixture({
    fixture: { randomUUID: () => commandA },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async input => {
        updates.push(input);
        return { ...draft, caption: input.caption, revision: 2 };
      },
      publishPublicationDraft: async input => {
        publishes.push(input);
        if (publishes.length === 1) throw new Error('network response lost after commit');
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(newCaption));
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());

    assert.deepEqual(updates, [], 'the uncertain prior publish must be replayed before creating a new revision');
    assert.equal(publishes.length, 2);
    assert.deepEqual(publishes.map(input => input.clientCommandId), [commandA, commandA]);
    assert.ok(publishes.every(input => input.draft === draft));
    assert.deepEqual(publishes.map(input => input.draft.caption), [draft.caption, draft.caption]);
  } finally {
    await app.unmount();
  }
});

test('save is blocked while an ambiguous publish command still requires exact replay', async () => {
  const newCaption = 'No debe crear una revisión antes del replay';
  const updates = [];
  const publishes = [];
  const alerts = [];
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft], nextCursor: null }),
      restorePublicationDraft: async () => draft,
      updatePublicationDraft: async input => {
        updates.push(input);
        return { ...draft, caption: input.caption, revision: 2 };
      },
      publishPublicationDraft: async input => {
        publishes.push(input);
        throw new Error('network response lost after commit');
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    await app.flush(() => findPressableByText(app, 'Restaurar').props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(newCaption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    assert.equal(publishes.length, 1);
    assert.deepEqual(updates, [], 'Guardar must not mutate a draft with an unresolved publish command');
    assert.ok(alerts.some(entry => entry.title === 'Publicación pendiente'),
      'the user must be directed to reconcile the pending publication');
  } finally {
    await app.unmount();
  }
});

test('pending-publish alert from A is suppressed while restore B is the active target', async () => {
  const restoreBGate = deferred();
  const alerts = [];
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'B PENDING',
  });
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: id => id === draft.id ? Promise.resolve(draft) : restoreBGate.promise,
      publishPublicationDraft: async () => {
        throw new Error('network response lost after commit');
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    alerts.length = 0;

    await app.flush(() => restoreButtons[1].props.onPress());
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    assert.deepEqual(alerts, [], 'A must not surface its pending-publish alert after B becomes the active target');
  } finally {
    restoreBGate.resolve(draftB);
    await app.flush();
    await app.unmount();
  }
});

test('no-change alert from A is suppressed while restore B is the active target', async () => {
  const restoreBGate = deferred();
  const alerts = [];
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'B PENDING',
  });
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: id => id === draft.id ? Promise.resolve(draft) : restoreBGate.promise,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    await app.flush(() => restoreButtons[0].props.onPress());
    alerts.length = 0;

    await app.flush(() => restoreButtons[1].props.onPress());
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    assert.deepEqual(alerts, [], 'A must not surface its no-change alert after B becomes the active target');
  } finally {
    restoreBGate.resolve(draftB);
    await app.flush();
    await app.unmount();
  }
});

test('failed superseding restore rolls selection back to the resolved editor instead of an invalidated pending target', async () => {
  const restoreBGate = deferred();
  const alerts = [];
  const savedCaption = 'A guardado después del fallo de C';
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'B PENDING',
  });
  const draftC = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000003',
    clientRequestId: '23000000-0000-4000-8000-000000000003',
    caption: 'C FAILS',
  });
  const confirmedA = Object.freeze({ ...draft, caption: savedCaption, revision: 2 });
  const updates = [];
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB, draftC], nextCursor: null }),
      restorePublicationDraft: id => {
        if (id === draft.id) return Promise.resolve(draft);
        if (id === draftB.id) return restoreBGate.promise;
        return Promise.reject(new Error('C restore failed'));
      },
      updatePublicationDraft: async input => {
        updates.push(input);
        return confirmedA;
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => restoreButtons[1].props.onPress());
    await app.flush(() => restoreButtons[2].props.onPress());
    assert.equal(app.find(node => node.type === 'TextInput').props.value, draft.caption);

    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText(savedCaption));
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());

    assert.deepEqual(updates.map(input => ({ id: input.id, expectedRevision: input.expectedRevision })), [
      { id: draft.id, expectedRevision: 1 },
    ]);
    assert.ok(alerts.some(entry => entry.title === 'Borrador sincronizado'),
      'after C fails, A must again be the authoritative editor target');

    restoreBGate.resolve(draftB);
    await app.flush();
    assert.equal(app.find(node => node.type === 'TextInput').props.value, savedCaption,
      'the invalidated B restore must not replace resolved A');
  } finally {
    restoreBGate.resolve(draftB);
    await app.flush();
    await app.unmount();
  }
});

test('late save A rejection after restore B does not surface A conflict on B', async () => {
  const restoreBGate = deferred();
  const updateAGate = deferred();
  const alerts = [];
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'B ORIGINAL',
  });
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: id => id === draft.id ? Promise.resolve(draft) : restoreBGate.promise,
      updatePublicationDraft: () => updateAGate.promise,
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText('A WILL FAIL'));
    await app.flush(() => restoreButtons[1].props.onPress());
    await app.flush(() => findPressableByText(app, 'Guardar cambios').props.onPress());
    await app.flush(() => {
      restoreBGate.resolve(draftB);
      updateAGate.reject(Object.assign(new Error('draft_revision_conflict'), { code: 'P0001' }));
    });

    assert.equal(app.find(node => node.type === 'TextInput').props.value, draftB.caption);
    assert.equal(alerts.some(entry => entry.title === 'Conflicto de borrador'), false);
  } finally {
    restoreBGate.resolve(draftB);
    updateAGate.reject(Object.assign(new Error('draft_revision_conflict'), { code: 'P0001' }));
    await app.flush();
    await app.unmount();
  }
});

test('late publish autosave A rejection after restore B does not surface A publication error on B', async () => {
  const restoreBGate = deferred();
  const updateAGate = deferred();
  const alerts = [];
  const publishes = [];
  const draftB = Object.freeze({
    ...draft,
    id: '21000000-0000-4000-8000-000000000002',
    clientRequestId: '23000000-0000-4000-8000-000000000002',
    caption: 'B ORIGINAL',
  });
  const harness = draftFixture({
    fixture: {
      useAlert: () => ({
        showAlert: (title, message, actions = []) => alerts.push({ title, message, actions }),
      }),
    },
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [draft, draftB], nextCursor: null }),
      restorePublicationDraft: id => id === draft.id ? Promise.resolve(draft) : restoreBGate.promise,
      updatePublicationDraft: () => updateAGate.promise,
      publishPublicationDraft: async input => {
        publishes.push(input);
        return '24000000-0000-4000-8000-000000000001';
      },
    },
  });
  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', harness.fixture);
  const app = await mount(MyContentScreen);
  try {
    const restoreButtons = app.nodes().filter(node => node.type === 'Pressable' && nodeText(node) === 'Restaurar');
    await app.flush(() => restoreButtons[0].props.onPress());
    await app.flush(() => app.find(node => node.type === 'TextInput').props.onChangeText('A PUBLISH WILL FAIL'));
    await app.flush(() => restoreButtons[1].props.onPress());
    await app.flush(() => findPressableByText(app, 'Publicar').props.onPress());
    await app.flush(() => {
      restoreBGate.resolve(draftB);
      updateAGate.reject(Object.assign(new Error('draft_revision_conflict'), { code: 'P0001' }));
    });

    assert.equal(publishes.length, 0);
    assert.equal(app.find(node => node.type === 'TextInput').props.value, draftB.caption);
    assert.equal(alerts.some(entry => entry.title === 'Publicación pendiente'), false);
  } finally {
    restoreBGate.resolve(draftB);
    updateAGate.reject(Object.assign(new Error('draft_revision_conflict'), { code: 'P0001' }));
    await app.flush();
    await app.unmount();
  }
});

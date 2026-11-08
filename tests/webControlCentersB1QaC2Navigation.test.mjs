import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import React from 'react';
import { loadStoryQaComponent } from './helpers/loadStoryQaComponent.mjs';
import { mount } from './helpers/storyQaHostRenderer.mjs';

const actorId = '20000000-0000-4000-8000-000000000001';

const metricProxy = new Proxy({}, { get: () => 8 });
const colorProxy = new Proxy({}, { get: () => '#111111' });

function baseFixture() {
  return {
    StyleSheet: {
      create: value => value,
      absoluteFill: {},
      absoluteFillObject: {},
      hairlineWidth: 1,
    },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    Platform: { OS: 'ios' },
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    Colors: colorProxy,
    FontSize: metricProxy,
    FontWeight: metricProxy,
    Radius: metricProxy,
    Spacing: metricProxy,
    randomUUID,
    formatNumber: value => String(value ?? 0),
    namespaces: {
      'expo-crypto': { randomUUID },
      'expo-image-picker': {},
      'expo-document-picker': { getDocumentAsync: async () => ({ canceled: true, assets: [] }) },
    },
  };
}

function nodeText(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  return (node.children ?? []).map(nodeText).join('');
}

function findPressableByText(app, text) {
  return app.find(node => node.type === 'Pressable' && nodeText(node).includes(text));
}

test('Profile exposes the canonical cloud draft inbox and opens its drafts tab', async () => {
  const routes = [];
  const fixture = {
    ...baseFixture(),
    useRouter: () => ({ push: route => routes.push(route) }),
    useFocusEffect: callback => React.useEffect(callback, [callback]),
    useAuth: () => ({
      user: { id: actorId, username: 'owner', email: 'owner@example.test', followers: 0, following: 0 },
      logout() {}, updateProfile: async () => {}, isFollowing: () => false,
      toggleFollow: async () => {}, followedUsers: [], refreshProfile: async () => {},
    }),
    useFeed: () => ({ deleteVideo: async () => ({ success: true }), updateVideo() {}, getAnalytics() {} }),
    useNotifications: () => ({ unreadCount: 0 }),
    useMessages: () => ({ unreadTotal: 0 }),
    useWallet: () => ({ balance: 0 }),
    useStories: () => ({
      getStoryGroupForUser: () => null, getStoryViewers: async () => [], deleteStory: async () => {},
      refreshStories: async () => {}, setStoryReaction: async () => {}, getStoryReactions: async () => [],
      replyToStory: async () => {}, getStorySharedContent: async () => null,
      prepareStoryQuestionAnswer: async () => null, getInteractiveState: async () => null,
      respondToInteractiveElement: async () => null, getInteractiveResults: async () => null,
      moderateInteractiveQuestion: async () => null, recordStoryAnalyticsEvent: async () => null,
      realtimeRevision: 0,
    }),
    useAlert: () => ({ showAlert() {} }),
    useI18n: () => ({ t: key => key }),
    MOCK_CREATORS: [],
    fetchCreatorVideoFeed: async () => [],
  };
  fixture.namespaces['expo-image-picker'] = {
    requestCameraPermissionsAsync: async () => ({ granted: false }),
    requestMediaLibraryPermissionsAsync: async () => ({ granted: false }),
    launchCameraAsync: async () => ({ canceled: true, assets: [] }),
    launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  };

  const { default: ProfileScreen } = await loadStoryQaComponent('app/(tabs)/profile.tsx', fixture);
  const app = await mount(ProfileScreen);
  try {
    const inbox = findPressableByText(app, 'Mis contenidos');
    assert.ok(inbox, 'Profile must expose the existing canonical My Content screen');
    assert.equal(inbox.props.accessibilityRole, 'button');
    assert.equal(inbox.props.accessibilityLabel, 'Mis contenidos. Publicaciones, borradores y contenido propio.');
    await app.flush(() => inbox.props.onPress());
    assert.deepEqual(routes, ['/my-content?tab=drafts']);
  } finally {
    await app.unmount();
  }
});

test('My Content validates deep-link tabs and follows navigation parameter changes', async () => {
  const state = { params: { tab: 'drafts' } };
  const fixture = {
    ...baseFixture(),
    useLocalSearchParams: () => state.params,
    useRouter: () => ({ push() {}, back() {} }),
    useFocusEffect: callback => React.useEffect(callback, [callback]),
    useAuth: () => ({ user: { id: actorId } }),
    useFeed: () => ({ deleteVideo: async () => ({ success: true }) }),
    useAlert: () => ({ showAlert() {} }),
    fetchCreatorVideoFeed: async () => [],
    fetchSavedVideoFeed: async () => [],
    DraftManager: {
      listPublicationDrafts: async () => ({ items: [], nextCursor: null }), restorePublicationDraft: async () => null,
      updatePublicationDraft: async () => null, deletePublicationDraft: async () => null,
      publishPublicationDraft: async () => null,
    },
  };

  const { default: MyContentScreen } = await loadStoryQaComponent('app/my-content.tsx', fixture);
  const app = await mount(MyContentScreen);
  try {
    assert.ok(app.nodes().some(node => node.text === 'Sin borradores'), 'tab=drafts must open the cloud draft inbox');
    assert.ok(app.nodes().some(node => node.text === 'Borradores privados'), 'the draft destination must be visibly identified');
    const selectedDraftTab = app.find(node =>
      node.type === 'Pressable'
      && node.props.accessibilityRole === 'tab'
      && node.props.accessibilityLabel === 'Borradores'
    );
    assert.deepEqual(selectedDraftTab.props.accessibilityState, { selected: true });

    state.params = { tab: 'not-a-real-tab' };
    await app.update({});
    assert.ok(app.nodes().some(node => node.text === 'Sin publicaciones'), 'unknown tabs must fail safely to posts');

    state.params = { tab: ['saved', 'drafts'] };
    await app.update({});
    assert.ok(app.nodes().some(node => node.text === 'Sin guardados'), 'array parameters must use their first valid value');
  } finally {
    await app.unmount();
  }
});

function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

async function uploadHarness({ failSave = false, saveDeferred, uploadDeferred } = {}) {
  const state = { alerts: [], routes: [], saves: [], uploads: [] };
  const fixture = {
    ...baseFixture(),
    useRouter: () => ({ push: route => state.routes.push(route) }),
    useAuth: () => ({ user: { id: actorId, username: 'owner', email: 'owner@example.test', avatar: '' } }),
    useFeed: () => ({ addVideo: async () => 'post-id', refreshFeed: async () => {} }),
    useLiveStream: () => ({ startStream: async () => {}, endStream: async () => {}, isStreaming: false, isStarting: false, error: null }),
    useAlert: () => ({ showAlert: (...args) => state.alerts.push(args) }),
    getSupabaseClient: () => ({}),
    canStartCreatorContentPublication: () => true,
    detectMimeType: () => 'image/jpeg',
    uploadMediaFromUri: async input => {
      const uploadNumber = state.uploads.push(input);
      if (uploadDeferred) await uploadDeferred.promise;
      return {
        url: `https://media.example.test/upload-${uploadNumber}.jpg`,
        assetId: `asset-${uploadNumber}`,
      };
    },
    DraftManager: {
      savePublicationDraft: async input => {
        state.saves.push(input);
        if (failSave) throw new Error('draft_save_failed');
        if (saveDeferred) return saveDeferred.promise;
        return { revision: 2 };
      },
    },
    File: class File {},
  };
  fixture.namespaces['expo-image-picker'] = {
    requestCameraPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
    requestMediaLibraryPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
    launchCameraAsync: async () => ({ canceled: true, assets: [] }),
    launchImageLibraryAsync: async () => ({
      canceled: false,
      assets: [
        { uri: 'file://draft-photo-1.jpg', type: 'image', mimeType: 'image/jpeg', fileName: 'draft-photo-1.jpg', fileSize: 1234 },
        { uri: 'file://draft-photo-2.jpg', type: 'image', mimeType: 'image/jpeg', fileName: 'draft-photo-2.jpg', fileSize: 2345 },
      ],
    }),
  };

  const { default: UploadScreen } = await loadStoryQaComponent('app/(tabs)/upload.tsx', fixture);
  const app = await mount(UploadScreen);
  return { app, state };
}

async function prepareUploadMutationRace(app, kind) {
  const modeLabel = kind === 'photo' ? 'Foto' : 'Carrusel';
  await app.flush(() => findPressableByText(app, modeLabel).props.onPress());
  await app.flush(() => findPressableByText(app, 'Galería').props.onPress());
  const caption = app.find(node => node.type === 'TextInput');
  assert.ok(caption, `${modeLabel} must expose its caption editor`);
  await app.flush(() => caption.props.onChangeText('Race-safe caption'));
}

function uploadMutationButtons(app) {
  const save = app.find(node =>
    node.type === 'CyberButton'
    && node.props.variant === 'secondary'
    && String(node.props.label).toLowerCase().includes('borrador')
  );
  const publish = app.find(node => node.type === 'CyberButton' && node.props.variant !== 'secondary');
  assert.ok(save, 'the Save Draft action must be rendered');
  assert.ok(publish, 'the Publish action must be rendered');
  return { save, publish };
}

test('confirmed cloud save offers draft navigation without saving twice or clearing the editor', async () => {
  const { app, state } = await uploadHarness();
  try {
    await app.flush(() => findPressableByText(app, 'Foto').props.onPress());
    await app.flush(() => findPressableByText(app, 'Galería').props.onPress());
    assert.ok(app.nodes().some(node => node.text === 'Foto lista'));

    const save = app.find(node => node.type === 'CyberButton' && node.props.label === 'Guardar borrador privado');
    await app.flush(() => save.props.onPress());
    assert.equal(state.saves.length, 1);
    assert.deepEqual(state.routes, [], 'successful persistence must not navigate without the user choosing it');

    const success = state.alerts.find(args => args[0] === 'Borrador guardado');
    assert.ok(success);
    assert.deepEqual(success[2].map(button => button.text), ['Ver borradores', 'Seguir creando']);
    await app.flush(() => success[2][0].onPress());
    assert.deepEqual(state.routes, ['/my-content?tab=drafts']);
    assert.equal(state.saves.length, 1, 'navigation must never replay the save command');
    assert.ok(app.nodes().some(node => node.text === 'Foto lista'), 'the editor remains available until the user chooses another flow');
  } finally {
    await app.unmount();
  }
});

test('failed cloud save exposes no success navigation and preserves the selected photo', async () => {
  const { app, state } = await uploadHarness({ failSave: true });
  try {
    await app.flush(() => findPressableByText(app, 'Foto').props.onPress());
    await app.flush(() => findPressableByText(app, 'Galería').props.onPress());
    const save = app.find(node => node.type === 'CyberButton' && node.props.label === 'Guardar borrador privado');
    await app.flush(() => save.props.onPress());
    assert.equal(state.saves.length, 1);
    assert.equal(state.alerts.some(args => args[0] === 'Borrador guardado'), false);
    assert.ok(state.alerts.some(args => args[0] === 'No se pudo guardar'));
    assert.deepEqual(state.routes, []);
    assert.ok(app.nodes().some(node => node.text === 'Foto lista'));
  } finally {
    await app.unmount();
  }
});

for (const kind of ['photo', 'carousel']) {
  for (const firstAction of ['save', 'publish']) {
    test(`${kind} ${firstAction}-first same-turn Save Draft and Publish starts only the first mutation`, async () => {
      const saveDeferred = deferred();
      const uploadDeferred = deferred();
      const { app, state } = await uploadHarness({ saveDeferred, uploadDeferred });
      let firstPromise;
      let secondPromise;
      try {
        await prepareUploadMutationRace(app, kind);
        const initial = uploadMutationButtons(app);

        await app.flush(() => {
          if (firstAction === 'save') {
            firstPromise = initial.save.props.onPress();
            secondPromise = initial.publish.props.onPress();
          } else {
            firstPromise = initial.publish.props.onPress();
            secondPromise = initial.save.props.onPress();
          }
        });

        const expectedUploadStarts = kind === 'carousel' ? 2 : 1;
        if (firstAction === 'save') {
          assert.equal(state.saves.length, 1, 'Save Draft must start synchronously');
          assert.equal(state.uploads.length, 0, 'same-turn Publish must not start behind Save Draft');
        } else {
          assert.equal(state.uploads.length, expectedUploadStarts, 'Publish must start its selected media uploads');
          assert.equal(state.saves.length, 0, 'same-turn Save Draft must not start behind Publish');
        }

        const pending = uploadMutationButtons(app);
        assert.equal(pending.save.props.disabled, true, 'Save Draft must be disabled while either mutation is active');
        assert.equal(pending.publish.props.disabled, true, 'Publish must be disabled while either mutation is active');
        assert.equal(pending.save.props.loading, firstAction === 'save');
        assert.equal(pending.publish.props.loading, firstAction === 'publish');

        if (firstAction === 'save') saveDeferred.resolve({ revision: 2 });
        else uploadDeferred.resolve();
        await Promise.all([firstPromise, secondPromise]);
        await app.flush();

        if (firstAction === 'save') {
          assert.equal(state.uploads.length, 0, 'resolving Save Draft must not queue Publish');
        } else {
          assert.equal(state.saves.length, 0, 'resolving Publish must not queue Save Draft');
        }
        const settled = uploadMutationButtons(app);
        assert.equal(settled.save.props.disabled, false);
        assert.equal(settled.publish.props.disabled, false);
      } finally {
        saveDeferred.resolve({ revision: 2 });
        uploadDeferred.resolve();
        await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
        await app.unmount();
      }
    });
  }
}

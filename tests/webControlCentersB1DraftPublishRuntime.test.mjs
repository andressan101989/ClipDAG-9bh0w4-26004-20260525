import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { loadStoryQaModule } from './helpers/loadStoryQaModule.mjs';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
let fixtureSequence = 0;

const privateAssetId = '22000000-0000-4000-8000-000000000001';
const publicAssetId = '26000000-0000-4000-8000-000000000001';
const postId = '24000000-0000-4000-8000-000000000001';
const commandId = '25000000-0000-4000-8000-000000000001';
const draft = Object.freeze({
  id: '21000000-0000-4000-8000-000000000001',
  clientRequestId: '23000000-0000-4000-8000-000000000001',
  kind: 'photo',
  caption: 'Fotografía privada preservada',
  music: 'Sin musica',
  composition: { layout: 'center' },
  state: 'draft',
  revision: 1,
  assetIds: [privateAssetId],
  publishedPostId: null,
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

async function loadPublicationDraftService(fixture) {
  const key = `__draftPublishRuntimeFixture${++fixtureSequence}`;
  globalThis[key] = fixture;
  const template = dataModule(`
    const fixture = globalThis[${JSON.stringify(key)}];
    export const getSupabaseClient = () => ({ rpc: (...args) => fixture.rpc(...args) });
  `);
  const media = dataModule(`
    const fixture = globalThis[${JSON.stringify(key)}];
    export const getMediaUrl = (...args) => fixture.getMediaUrl(...args);
    export const uploadMediaFromBlob = (...args) => fixture.uploadMediaFromBlob(...args);
    export const uploadMediaFromSource = (...args) => fixture.uploadMediaFromSource(...args);
  `);
  return loadStoryQaModule('services/publicationDraftService.ts', {
    '@/template': template,
    '@/services/mediaService': media,
  });
}

function okImageResponse() {
  return {
    ok: true,
    headers: { get: () => 'image/jpeg' },
    blob: async () => new Blob(['private-image'], { type: 'image/jpeg' }),
  };
}

test('same-runtime retry after a lost publish RPC response reuses materialized assets and exact RPC args', async () => {
  const rpcCalls = [];
  const materialized = [];
  let rpcAttempts = 0;
  const service = await loadPublicationDraftService({
    getMediaUrl: async id => `https://media.example.test/private/${id}`,
    uploadMediaFromBlob: async input => {
      materialized.push(input);
      return { assetId: publicAssetId };
    },
    uploadMediaFromSource: async () => { throw new Error('unused'); },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      rpcAttempts += 1;
      return rpcAttempts === 1
        ? { data: null, error: new Error('network response lost') }
        : { data: postId, error: null };
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => okImageResponse();
  try {
    await assert.rejects(
      service.publishPublicationDraft({ draft, clientCommandId: commandId }),
      /network response lost/,
    );
    const result = await service.publishPublicationDraft({ draft, clientCommandId: commandId });

    assert.equal(result, postId);
    assert.equal(materialized.length, 1, 'the private asset must not be materialized twice');
    assert.equal(rpcCalls.length, 2);
    assert.deepEqual(rpcCalls[1], rpcCalls[0],
      'the retry must replay byte-for-byte equivalent publish RPC arguments');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish binds a command to draft and revision before the first async materialization', async () => {
  const firstMediaUrl = deferred();
  const mediaLookups = [];
  const service = await loadPublicationDraftService({
    getMediaUrl: id => {
      mediaLookups.push(id);
      return mediaLookups.length === 1
        ? firstMediaUrl.promise
        : Promise.resolve(`https://media.example.test/private/${id}`);
    },
    uploadMediaFromBlob: async () => ({ assetId: publicAssetId }),
    uploadMediaFromSource: async () => { throw new Error('unused'); },
    rpc: async () => ({ data: postId, error: null }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => okImageResponse();
  const first = service.publishPublicationDraft({ draft, clientCommandId: commandId });
  try {
    assert.equal(mediaLookups.length, 1, 'the first call must have entered materialization');
    const second = await service.publishPublicationDraft({
      draft: { ...draft, revision: 2 },
      clientCommandId: commandId,
    }).then(
      value => ({ status: 'fulfilled', value }),
      error => ({ status: 'rejected', error }),
    );

    firstMediaUrl.resolve(`https://media.example.test/private/${privateAssetId}`);
    assert.equal(await first, postId);
    assert.equal(second.status, 'rejected');
    assert.equal(second.error?.code, 'draft_publish_command_conflict');
    assert.equal(second.error?.message, 'draft_publish_command_conflict');
    assert.equal(mediaLookups.length, 1,
      'a conflicting call must reject before starting another materialization');
  } finally {
    firstMediaUrl.resolve(`https://media.example.test/private/${privateAssetId}`);
    await first.catch(() => undefined);
    globalThis.fetch = originalFetch;
  }
});

test('DraftManager publishes the supplied snapshot without refetching it by id', async () => {
  const key = `__draftManagerPublishFixture${++fixtureSequence}`;
  globalThis[key] = { gets: [], publishes: [] };
  const asyncStorage = dataModule(`
    export default { getItem: async () => null, setItem: async () => undefined };
  `);
  const publicationDraftService = dataModule(`
    const fixture = globalThis[${JSON.stringify(key)}];
    export const createPublicationDraft = async () => { throw new Error('unused'); };
    export const deletePublicationDraft = async () => { throw new Error('unused'); };
    export const listPublicationDrafts = async () => { throw new Error('unused'); };
    export const updatePublicationDraft = async () => { throw new Error('unused'); };
    export const uploadPublicationDraftSource = async () => { throw new Error('unused'); };
    export const getPublicationDraft = async id => {
      fixture.gets.push(id);
      return { ...fixture.draft, revision: 99 };
    };
    export const publishPublicationDraft = async input => {
      fixture.publishes.push(input);
      return ${JSON.stringify(postId)};
    };
  `);
  const fixture = globalThis[key];
  fixture.draft = draft;
  const { DraftManager } = await loadStoryQaModule('modules/creator/drafts/DraftManager.ts', {
    '@react-native-async-storage/async-storage': asyncStorage,
    '@/services/publicationDraftService': publicationDraftService,
  });

  const result = await DraftManager.publishPublicationDraft({ draft, clientCommandId: commandId });

  assert.equal(result, postId);
  assert.deepEqual(fixture.gets, []);
  assert.equal(fixture.publishes.length, 1);
  assert.equal(fixture.publishes[0].draft, draft);
  assert.equal(fixture.publishes[0].clientCommandId, commandId);
});

test('two concurrent identical publish calls share one materialization and one RPC', async () => {
  const mediaUrlGate = deferred();
  const mediaLookups = [];
  const materializations = [];
  const rpcCalls = [];
  const service = await loadPublicationDraftService({
    getMediaUrl: id => {
      mediaLookups.push(id);
      return mediaUrlGate.promise;
    },
    uploadMediaFromBlob: async input => {
      materializations.push(input);
      return { assetId: publicAssetId };
    },
    uploadMediaFromSource: async () => { throw new Error('unused'); },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: postId, error: null };
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => okImageResponse();
  const first = service.publishPublicationDraft({ draft, clientCommandId: commandId });
  const second = service.publishPublicationDraft({ draft, clientCommandId: commandId });
  try {
    mediaUrlGate.resolve(`https://media.example.test/private/${privateAssetId}`);
    assert.deepEqual(await Promise.all([first, second]), [postId, postId]);
    assert.equal(mediaLookups.length, 1);
    assert.equal(materializations.length, 1);
    assert.equal(rpcCalls.length, 1);
  } finally {
    mediaUrlGate.resolve(`https://media.example.test/private/${privateAssetId}`);
    await Promise.allSettled([first, second]);
    globalThis.fetch = originalFetch;
  }
});

test('a deterministic publish rejection clears prepared state so the command can bind a fresh revision', async () => {
  const materializations = [];
  const rpcCalls = [];
  const service = await loadPublicationDraftService({
    getMediaUrl: async id => `https://media.example.test/private/${id}`,
    uploadMediaFromBlob: async input => {
      materializations.push(input);
      return { assetId: publicAssetId };
    },
    uploadMediaFromSource: async () => { throw new Error('unused'); },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return rpcCalls.length === 1
        ? { data: null, error: { code: 'P0001', message: 'draft_revision_conflict' } }
        : { data: postId, error: null };
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => okImageResponse();
  try {
    await assert.rejects(
      service.publishPublicationDraft({ draft, clientCommandId: commandId }),
      error => error?.code === 'P0001',
    );
    const result = await service.publishPublicationDraft({
      draft: { ...draft, revision: 2 },
      clientCommandId: commandId,
    });

    assert.equal(result, postId);
    assert.equal(materializations.length, 2,
      'the fresh revision must not inherit materialized assets from the rejected attempt');
    assert.equal(rpcCalls.length, 2);
    assert.equal(rpcCalls[1].args.p_expected_revision, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

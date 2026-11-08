import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { loadStoryQaModule } from './helpers/loadStoryQaModule.mjs';

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('DraftManager exposes the canonical draft page and forwards its continuation cursor', async () => {
  const cursor = { updatedAt: '2026-11-02T00:00:00.000Z', id: '21000000-0000-4000-8000-000000000001' };
  const page = { items: [{ id: 'draft-page-row' }], nextCursor: null };
  globalThis.__draftManagerPaginationFixture = { calls: [], page };
  const asyncStorage = dataModule(`
    export default { getItem: async () => null, setItem: async () => undefined };
  `);
  const publicationDraftService = dataModule(`
    const fixture = globalThis.__draftManagerPaginationFixture;
    export const createPublicationDraft = async () => { throw new Error('unused'); };
    export const deletePublicationDraft = async () => { throw new Error('unused'); };
    export const getPublicationDraft = async () => { throw new Error('unused'); };
    export const publishPublicationDraft = async () => { throw new Error('unused'); };
    export const updatePublicationDraft = async () => { throw new Error('unused'); };
    export const uploadPublicationDraftSource = async () => { throw new Error('unused'); };
    export const listPublicationDrafts = async input => {
      fixture.calls.push(input);
      return fixture.page;
    };
  `);
  const { DraftManager } = await loadStoryQaModule('modules/creator/drafts/DraftManager.ts', {
    '@react-native-async-storage/async-storage': asyncStorage,
    '@/services/publicationDraftService': publicationDraftService,
  });

  const input = { limit: 37, cursor };
  const result = await DraftManager.listPublicationDrafts(input);

  assert.equal(result, page);
  assert.deepEqual(globalThis.__draftManagerPaginationFixture.calls, [input]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStoryQaModule } from './helpers/loadStoryQaModule.mjs';
import { createStoryQuestionHandoffStore } from '../services/storyQuestionHandoffRuntime.mjs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const types = await loadStoryQaModule('components/feature/storyInteractiveTypes.ts');
const card = { id: '10000000-0000-4000-8000-000000000001', type: 'question_answer', x: .4, y: .6,
  scale: 1.2, rotation: 15, question: '¿Cómo empezaste?', answer: 'Con práctica.' };
const placement = { id: '10000000-0000-4000-8000-000000000002', type: 'interactive',
  element_id: '10000000-0000-4000-8000-000000000003', x: .5, y: .2, scale: 1, rotation: 0 };
const draft = { definition: { version: 1, element_id: placement.element_id, type: 'question', prompt: 'Pregunta' }, correctOptionId: null };
const actor = '20000000-0000-4000-8000-000000000001';
const recipient = '20000000-0000-4000-8000-000000000002';
const source = { storyId: '30000000-0000-4000-8000-000000000001', elementId: placement.element_id, respondentId: recipient };
let sequence = 10;
const randomUUID = () => `40000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const require = createRequire(import.meta.url);
const reactUrl = pathToFileURL(require.resolve('react')).href;
const asModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const geometry = await loadStoryQaModule('components/feature/storyStageGeometry.ts');
const renderer = await loadStoryQaModule('components/feature/storyComposition.tsx', {
  react: reactUrl,
  'react-native': asModule("export const Text='Text', View='View', StyleSheet={create:x=>x};"),
  './storyStageGeometry': asModule(ts.transpileModule(readFileSync(new URL('../components/feature/storyStageGeometry.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText),
});
const integration = await loadStoryQaModule('services/storyQuestionIntegrationRuntime.ts');
const client = await loadStoryQaModule('services/storyQuestionAnswerClient.ts');

function feedHarness() {
  assert.equal(typeof integration.StoryQuestionFeedSession, 'function', 'Feed must use a fenced private handoff session');
  let now = 0;
  const store = createStoryQuestionHandoffStore({ randomUUID, now: () => now });
  const session = new integration.StoryQuestionFeedSession(store, randomUUID);
  session.setActor(actor);
  const issue = () => store.issueStoryReply({ actorId: actor, source, question: card.question, answer: '' });
  return { session, store, issue, expire: () => { now = 300000; } };
}

test('canonical public composition accepts one transformed answer card only in v2', () => {
  assert.deepEqual(types.parseStoryComposition({ version: 2, elements: [card] }), { version: 2, elements: [card] });
  assert.equal(types.parseStoryComposition({ version: 1, elements: [card] }), null);
  assert.equal(types.normalizeStoryCompositionVersion({ version: 1, elements: [card] }).version, 2);
  assert.equal(types.parseStoryComposition({ version: 2, elements: [card, { ...card, id: placement.id }] }), null);
  assert.equal(types.parseStoryComposition({ version: 2, elements: [card, card] }), null);
});

test('final card parser rejects private fields, malformed geometry and invalid or blank public text', () => {
  for (const bad of [{ respondentId: placement.id }, { storyId: placement.id }, { username: 'private' },
    { answer: '' }, { question: ' ' }, { answer: 'x'.repeat(501) }, { answer: '\nhello' },
    { answer: '<private>' }, { scale: 0 }, { rotation: 181 }, { id: 'bad' }]) {
    assert.equal(types.parseStoryComposition({ version: 2, elements: [{ ...card, ...bad }] }), null);
  }
});

test('QA publication preserves ordered transforms and independent definition authority', () => {
  const publication = types.buildStoryInteractivePublication({ version: 2, elements: [placement, card] }, [draft]);
  assert.deepEqual(publication, { composition: { version: 2, elements: [placement, card] }, interactiveDefinitions: [draft.definition] });
  assert.equal(types.buildStoryInteractivePublication({ version: 2, elements: [card, placement] }, []), null);
  assert.equal(types.buildStoryInteractivePublication({ version: 2, elements: [{ ...card, answer: '' }] }, []), null);
  assert.equal(types.buildStoryInteractivePublication({ version: 2, elements: [card] }, []).composition.version, 2);
});

test('actual static renderer shows only the public question and answer through measured geometry', () => {
  const tree = renderer.StoryCompositionElementContent({ element: card, canvasWidth: 390 });
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : node?.props ? text(node.props.children) : '';
  assert.match(text(tree), /¿Cómo empezaste\?/);
  assert.match(text(tree), /Con práctica\./);
  assert.equal(JSON.stringify(tree).includes(recipient), false);
  const frame = renderer.storyElementFrame(card, 390);
  assert.ok(frame.minHeight >= 120);
  const fitted = geometry.fitStoryElementTransform(card, { width: frame.width, height: 240 }, { width: 390, height: 844 });
  assert.equal(fitted.rotation, 15);
});

test('secure adapter is one shared application store for Story and recipient-bound Chat handoffs', async () => {
  const replacements = { 'expo-crypto': asModule("export { randomUUID } from 'node:crypto';") };
  const viewer = await loadStoryQaModule('services/storyQuestionHandoff.ts', replacements);
  assert.ok(viewer.storyQuestionHandoffs, 'shared secure application handoff adapter must exist');
  const feed = await loadStoryQaModule('services/storyQuestionHandoff.ts', replacements);
  assert.equal(viewer.storyQuestionHandoffs, feed.storyQuestionHandoffs);
  const route = viewer.storyQuestionHandoffs.issueStoryReply({ actorId: actor, source, question: card.question, answer: '' });
  assert.deepEqual(Object.keys(route), ['handoffToken']);
  assert.equal(feed.storyQuestionHandoffs.consumeStoryReply(route.handoffToken, actor).source.storyId, source.storyId);
  const chatRoute = viewer.storyQuestionHandoffs.issueChatDraft({ actorId: actor, recipientId: recipient, text: 'Mi respuesta' });
  assert.deepEqual(feed.storyQuestionHandoffs.consumeChatDraft(chatRoute.handoffToken, actor, recipient), { text: 'Mi respuesta' });
});

test('editor session seeds once, protects question identity, and retains edits/client ID after failure', () => {
  assert.equal(typeof integration.StoryQuestionEditorSession, 'function', 'canonical editor seed lifecycle must exist');
  const session = new integration.StoryQuestionEditorSession(randomUUID);
  const media = { kind: 'media', uri: 'local-photo' };
  const initial = session.initialize(true, media, { ...card, answer: '' });
  assert.equal(initial.composition.version, 2);
  assert.equal(initial.composition.elements[0].answer, '');
  assert.equal(session.initialize(true, media, { ...card, answer: 'rerender' }), null);
  const edited = session.updateCard(card, { ...card, question: 'spoof', answer: 'Nueva', x: .2, rotation: -25 });
  assert.deepEqual(edited, { ...card, answer: 'Nueva', x: .2, rotation: -25 });
  assert.equal(session.validate({ version: 2, elements: [{ ...edited, answer: '' }] }), false);
  assert.equal(session.validate({ version: 1, elements: [] }), false);
  assert.equal(session.validate({ version: 2, elements: [edited] }), true);
  assert.equal(session.initialize(true, media, card), null, 'publication failure/rerender cannot reset draft');
  assert.equal(session.clientStoryId, initial.clientStoryId);
  session.initialize(false, null, null);
  const ordinary = session.initialize(true, {}, null);
  assert.deepEqual(ordinary.composition, { version: 1, elements: [] });
  assert.notEqual(ordinary.clientStoryId, initial.clientStoryId);
  assert.equal(session.validate(ordinary.composition), true);
});

test('Feed waits for auth/focus, preserves occupied editor, consumes once, and expires safely', () => {
  const { session, issue, expire } = feedHarness();
  const token = issue().handoffToken;
  assert.equal(session.receive(token, null, true, false).status, 'waiting');
  assert.equal(session.receive(token, actor, false, false).status, 'waiting');
  assert.equal(session.receive(token, actor, true, true).status, 'occupied');
  assert.equal(session.reply, null);
  assert.equal(session.receive(token, recipient, true, false).status, 'invalid');
  assert.equal(session.receive(token, actor, true, false).status, 'ready');
  assert.equal(session.reply.seed.answer, '');
  assert.equal(session.reply.seed.question, card.question);
  assert.notEqual(session.reply.seed.id, source.storyId);
  assert.equal(session.receive(token, actor, true, false).status, 'duplicate');
  session.clear();
  const expired = issue().handoffToken;
  expire();
  assert.equal(session.receive(expired, actor, true, false).status, 'invalid');
  assert.equal(session.reply, null);
});

test('Feed wrong configured actor cannot locally burn a still-bound handoff', () => {
  const store = createStoryQuestionHandoffStore({ randomUUID });
  const session = new integration.StoryQuestionFeedSession(store, randomUUID);
  const token = store.issueStoryReply({ actorId: actor, source, question: card.question, answer: '' }).handoffToken;
  session.setActor(recipient);
  assert.equal(session.receive(token, recipient, true, false).status, 'invalid');
  session.setActor(actor);
  assert.equal(session.receive(token, actor, true, false).status, 'ready');
  assert.equal(session.receive(token, actor, true, false).status, 'duplicate');
});

test('Feed picker cancellation/denial and actor teardown fence late callbacks from new ordinary sessions', () => {
  const { session, issue } = feedHarness();
  const ready = session.receive(issue().handoffToken, actor, true, false);
  assert.equal(session.isCurrent(ready.ticket), true);
  session.clear(); // picker cancel, denial, or editor cancel
  assert.equal(session.isCurrent(ready.ticket), false);
  assert.equal(session.reply, null);
  const ordinaryTicket = session.beginMedia();
  assert.equal(session.isCurrent(ordinaryTicket), true);
  session.setActor(recipient);
  assert.equal(session.isCurrent(ordinaryTicket), false);
  assert.equal(session.reply, null);
});

test('Chat recipient/actor binding, late authentication, duplicates and pending explicit insertion preserve drafts with zero sends', () => {
  assert.equal(typeof integration.StoryQuestionChatDraftSession, 'function', 'Chat handoff draft lifecycle must exist');
  const store = createStoryQuestionHandoffStore({ randomUUID });
  const session = new integration.StoryQuestionChatDraftSession(store);
  session.setIdentity(actor, recipient);
  const token = store.issueChatDraft({ actorId: actor, recipientId: recipient, text: 'Respuesta privada' }).handoffToken;
  assert.equal(session.receive(token, null, recipient, '', false).status, 'waiting');
  assert.equal(session.receive(token, actor, actor, '', false).status, 'invalid');
  assert.deepEqual(session.receive(token, actor, recipient, 'Mi texto 😊', false), { status: 'pending' });
  assert.equal(session.pendingText, 'Respuesta privada');
  assert.deepEqual(session.insert('Mi texto 😊', false), { text: 'Mi texto 😊\nRespuesta privada' });
  assert.equal(session.receive(token, actor, recipient, '', false).status, 'duplicate');
  const voiceToken = store.issueChatDraft({ actorId: actor, recipientId: recipient, text: 'Otra' }).handoffToken;
  assert.equal(session.receive(voiceToken, actor, recipient, '', true).status, 'pending');
  assert.equal(session.insert('', true), null);
  session.setIdentity(recipient, actor);
  assert.equal(session.pendingText, null);
});

test('Chat wrong configured identity cannot locally burn a recipient-bound draft', () => {
  const store = createStoryQuestionHandoffStore({ randomUUID });
  const session = new integration.StoryQuestionChatDraftSession(store);
  const wrongActorToken = store.issueChatDraft({ actorId: actor, recipientId: recipient, text: 'Correct actor draft' }).handoffToken;
  session.setIdentity(recipient, recipient);
  assert.equal(session.receive(wrongActorToken, recipient, recipient, '', false).status, 'invalid');
  session.setIdentity(actor, recipient);
  assert.deepEqual(session.receive(wrongActorToken, actor, recipient, '', false), { status: 'ready', text: 'Correct actor draft' });
  assert.equal(session.receive(wrongActorToken, actor, recipient, '', false).status, 'duplicate');

  const wrongRecipientToken = store.issueChatDraft({ actorId: actor, recipientId: recipient, text: 'Correct recipient draft' }).handoffToken;
  session.setIdentity(actor, actor);
  assert.equal(session.receive(wrongRecipientToken, actor, actor, '', false).status, 'invalid');
  session.setIdentity(actor, recipient);
  assert.deepEqual(session.receive(wrongRecipientToken, actor, recipient, '', false), { status: 'ready', text: 'Correct recipient draft' });
  assert.equal(session.receive(wrongRecipientToken, actor, recipient, '', false).status, 'duplicate');
});

test('strict preflight parses exact canonical server text and recipient and sends the exact read-only RPC', async () => {
  assert.equal(typeof client.prepareStoryQuestionAnswerWithClient, 'function', 'strict QA preflight client must exist');
  const calls = [];
  const rpc = async (...args) => { calls.push(args); return { data: { question: card.question, respondent_id: recipient }, error: null }; };
  assert.deepEqual(await client.prepareStoryQuestionAnswerWithClient({ rpc }, source), { question: card.question, respondentId: recipient });
  assert.deepEqual(calls, [['prepare_story_question_answer', { p_source_story_id: source.storyId, p_source_element_id: source.elementId, p_respondent_id: recipient }]]);
  for (const data of [{ question: card.question }, { question: card.question, respondent_id: recipient, avatar: 'private' },
    { question: ' ', respondent_id: recipient }, { question: '\nquestion', respondent_id: recipient },
    { question: 'x'.repeat(501), respondent_id: recipient }, { question: card.question, respondent_id: actor },
    [{ question: card.question, respondent_id: recipient }], { question: 3, respondent_id: recipient }]) {
    await assert.rejects(client.prepareStoryQuestionAnswerWithClient({ rpc: async () => ({ data, error: null }) }, source), /STORY_QA_INVALID_RESPONSE/);
  }
  await assert.rejects(client.prepareStoryQuestionAnswerWithClient({ rpc: async () => { throw new Error('private tuple database error'); } }, source), /^Error: STORY_QA_REQUEST_FAILED$/);
});

test('QA publication calls one atomic seven-argument RPC and rejects malformed response UUIDs and raw DB errors', async () => {
  assert.equal(typeof client.createStoryQuestionAnswerWithClient, 'function', 'atomic QA publisher client must exist');
  const input = { source, mediaAssetId: actor, composition: { version: 2, elements: [card] }, clientStoryId: recipient, interactiveDefinitions: [] };
  const calls = [];
  assert.equal(await client.createStoryQuestionAnswerWithClient({ rpc: async (...args) => { calls.push(args); return { data: card.id, error: null }; } }, input), card.id);
  assert.deepEqual(calls, [['create_story_question_answer_with_media', { p_source_story_id: source.storyId,
    p_source_element_id: source.elementId, p_respondent_id: recipient, p_asset_id: actor,
    p_composition: input.composition, p_client_story_id: recipient, p_interactive_definitions: [] }]]);
  for (const data of ['bad', { id: card.id }, [card.id], null]) {
    await assert.rejects(client.createStoryQuestionAnswerWithClient({ rpc: async () => ({ data, error: null }) }, input), /STORY_QA_INVALID_RESPONSE/);
  }
  await assert.rejects(client.createStoryQuestionAnswerWithClient({ rpc: async () => ({ data: null, error: { message: 'private question' } }) }, input), /^Error: STORY_QA_REQUEST_FAILED$/);
});

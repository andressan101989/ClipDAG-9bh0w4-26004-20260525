import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const composerUrl = new URL('../components/feature/storyQuestionComposerRuntime.mjs', import.meta.url);
const handoffUrl = new URL('../services/storyQuestionHandoffRuntime.mjs', import.meta.url);
// Missing contracts produce named assertions during RED, rather than import errors.
const composer = existsSync(composerUrl) ? await import(composerUrl) : {};
const handoff = existsSync(handoffUrl) ? await import(handoffUrl) : {};
const actorId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
const source = {
  storyId: '33333333-3333-4333-8333-333333333333',
  elementId: '44444444-4444-4444-8444-444444444444',
  respondentId: recipientId,
};
const cardId = '55555555-5555-4555-8555-555555555555';
const nextId = '66666666-6666-4666-8666-666666666666';
const token = '77777777-7777-4777-8777-777777777777';
const storyInput = () => ({ actorId, source: { ...source }, question: '  Your question?  ', answer: '  My answer.  ' });
const chatInput = () => ({ actorId, recipientId, text: '  An editable private reply.  ' });
const publicCard = () => ({
  id: cardId, type: 'question_answer', x: 0.5, y: 0.5, scale: 1, rotation: 0,
  question: 'Your question?', answer: 'My answer.',
});

function makeStore(options = {}) {
  assert.equal(typeof handoff.createStoryQuestionHandoffStore, 'function', 'opaque handoff store must exist');
  return handoff.createStoryQuestionHandoffStore({ randomUUID: () => token, now: () => 1_000, ...options });
}

function buildSeed(input, randomUUID = () => cardId) {
  assert.equal(typeof handoff.buildStoryQuestionAnswerSeed, 'function', 'sanitized public card seed must exist');
  return handoff.buildStoryQuestionAnswerSeed(input, { randomUUID });
}

function parseCard(input) {
  assert.equal(typeof handoff.parseStoryQuestionAnswerCard, 'function', 'exact public card parser must exist');
  return handoff.parseStoryQuestionAnswerCard(input);
}

test('opening the question composer hides the general rail, pauses playback, and blocks viewer gestures', () => {
  assert.equal(typeof composer.getStoryQuestionComposerState, 'function', 'exclusive composer state must exist');
  assert.deepEqual(composer.getStoryQuestionComposerState(true), {
    hideReplyRail: true, pausePlayback: true, blockViewerGestures: true,
  });
});

test('closing the question composer restores the rail, playback, and viewer gestures', () => {
  assert.equal(typeof composer.getStoryQuestionComposerState, 'function', 'exclusive composer state must exist');
  assert.deepEqual(composer.getStoryQuestionComposerState(false), {
    hideReplyRail: false, pausePlayback: false, blockViewerGestures: false,
  });
});

test('Story navigation carries only an opaque random token and consumes the private source exactly once', () => {
  const store = makeStore();
  const route = store.issueStoryReply(storyInput());
  assert.deepEqual(route, { handoffToken: token });
  assert.deepEqual(store.consumeStoryReply(route.handoffToken, actorId), {
    source: { storyId: source.storyId, elementId: source.elementId, respondentId: recipientId },
    question: 'Your question?', answer: 'My answer.',
  });
  assert.equal(store.consumeStoryReply(route.handoffToken, actorId), null);
});

test('a wrong actor or wrong purpose cannot read or burn a valid Story handoff', () => {
  const store = makeStore();
  const route = store.issueStoryReply(storyInput());
  assert.equal(store.consumeStoryReply(route.handoffToken, recipientId), null);
  assert.equal(store.consumeChatDraft(route.handoffToken, actorId, recipientId), null);
  assert.equal(store.consumeStoryReply(route.handoffToken, actorId).question, 'Your question?');
});

test('Chat navigation carries only an opaque token and never includes private text or recipient metadata', () => {
  const store = makeStore();
  const route = store.issueChatDraft(chatInput());
  assert.deepEqual(route, { handoffToken: token });
  assert.deepEqual(store.consumeChatDraft(route.handoffToken, actorId, recipientId), { text: 'An editable private reply.' });
  assert.equal(store.consumeChatDraft(route.handoffToken, actorId, recipientId), null);
});

test('wrong Chat recipient, actor, or purpose cannot read or burn a valid draft', () => {
  const store = makeStore();
  const route = store.issueChatDraft(chatInput());
  assert.equal(store.consumeChatDraft(route.handoffToken, actorId, source.storyId), null);
  assert.equal(store.consumeChatDraft(route.handoffToken, recipientId, recipientId), null);
  assert.equal(store.consumeStoryReply(route.handoffToken, actorId), null);
  assert.deepEqual(store.consumeChatDraft(route.handoffToken, actorId, recipientId), { text: 'An editable private reply.' });
});

test('a handoff remains live just before five minutes and expires exactly at the default deadline', () => {
  let now = 1_000;
  let nextToken = token;
  const store = makeStore({ now: () => now, randomUUID: () => nextToken });
  const early = store.issueStoryReply(storyInput());
  nextToken = nextId;
  const expired = store.issueChatDraft(chatInput());
  now = 300_999;
  assert.ok(store.consumeStoryReply(early.handoffToken, actorId));
  now = 301_000;
  assert.equal(store.consumeChatDraft(expired.handoffToken, actorId, recipientId), null);
  now = 1_000;
  assert.equal(store.consumeChatDraft(expired.handoffToken, actorId, recipientId), null, 'expired payload must be removed');
});

test('malformed tokens and bindings cannot reveal or consume an existing private payload', () => {
  const store = makeStore();
  store.issueStoryReply(storyInput());
  for (const malformed of [null, undefined, '', 'guess', [], [token], {}, { handoffToken: token }, `${token} `]) {
    assert.equal(store.consumeStoryReply(malformed, actorId), null);
  }
  for (const malformed of [null, undefined, '', [], [actorId], {}]) {
    assert.equal(store.consumeStoryReply(token, malformed), null);
  }
  assert.ok(store.consumeStoryReply(token, actorId));
});

test('unknown tokens do not disclose payloads and a second store cannot consume the first store token', () => {
  const store = makeStore();
  store.issueChatDraft(chatInput());
  assert.equal(store.consumeChatDraft(nextId, actorId, recipientId), null);
  assert.equal(makeStore().consumeChatDraft(token, actorId, recipientId), null);
  assert.ok(store.consumeChatDraft(token, actorId, recipientId));
});

test('mutating the issued input or returned route cannot rewrite private payloads or token bindings', () => {
  const input = storyInput();
  const store = makeStore();
  const route = store.issueStoryReply(input);
  input.source.respondentId = actorId;
  input.question = 'Changed';
  route.handoffToken = nextId;
  assert.deepEqual(store.consumeStoryReply(token, actorId), {
    source: { storyId: source.storyId, elementId: source.elementId, respondentId: recipientId },
    question: 'Your question?', answer: 'My answer.',
  });
});

test('invalid actor, source, recipient, text, or extra payload keys cannot create handoffs', () => {
  const store = makeStore();
  for (const input of [null, [], {}, { ...storyInput(), actorId: '' }, { ...storyInput(), source: { ...source, elementId: 'bad' } },
    { ...storyInput(), source: { ...source, username: 'private' } }, { ...storyInput(), username: 'private' },
    { ...storyInput(), question: '<private>' }, { ...storyInput(), answer: '\nanswer' }]) {
    assert.equal(store.issueStoryReply(input), null);
  }
  for (const input of [null, [], {}, { ...chatInput(), actorId: 'bad' }, { ...chatInput(), recipientId: '' },
    { ...chatInput(), username: 'private' }, { ...chatInput(), text: '' }, { ...chatInput(), text: 'x'.repeat(501) }]) {
    assert.equal(store.issueChatDraft(input), null);
  }
});

test('nonfinite, nonpositive, or longer-than-five-minute expiry settings fail closed', () => {
  for (const ttlMs of [NaN, Infinity, 0, -1, 300_001, '100']) {
    assert.throws(() => makeStore({ ttlMs }), /HANDOFF_INVALID_OPTIONS/);
  }
  let now = 1_000;
  const store = makeStore({ now: () => now, ttlMs: 10 });
  const route = store.issueChatDraft(chatInput());
  now = 1_010;
  assert.equal(store.consumeChatDraft(route.handoffToken, actorId, recipientId), null);
});

test('invalid clock or random token output cannot mint a route or reveal an existing payload', () => {
  for (const badToken of [null, '', 'predictable', actorId.toUpperCase().replace('4111', '0111')]) {
    assert.equal(makeStore({ randomUUID: () => badToken }).issueStoryReply(storyInput()), null);
  }
  let now = 1_000;
  const store = makeStore({ now: () => now });
  store.issueStoryReply(storyInput());
  now = NaN;
  assert.equal(store.issueChatDraft(chatInput()), null);
  assert.equal(store.consumeStoryReply(token, actorId), null);
  now = 1_001;
  assert.ok(store.consumeStoryReply(token, actorId));
});

test('a random token collision never replaces or resurrects a previous handoff', () => {
  const store = makeStore();
  store.issueStoryReply(storyInput());
  assert.equal(store.issueChatDraft(chatInput()), null);
  assert.ok(store.consumeStoryReply(token, actorId));
  assert.equal(store.issueChatDraft(chatInput()), null);
});

test('spent token identity retention is bounded and fails closed instead of recycling old routes', () => {
  let sequence = 0;
  const store = makeStore({
    randomUUID: () => `40000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`,
  });
  for (let index = 0; index < 4_096; index += 1) {
    const route = store.issueStoryReply(storyInput());
    assert.ok(route, `handoff ${index + 1} must fit within the bounded registry`);
    assert.ok(store.consumeStoryReply(route.handoffToken, actorId));
  }
  assert.equal(store.issueStoryReply(storyInput()), null,
    'capacity exhaustion must fail closed without forgetting any previously issued token identity');
});

test('public answer seeds contain only fresh card identity, normalized geometry, question, and answer', () => {
  let id = cardId;
  const input = { question: '  Your question?  ', answer: '  My answer.  ' };
  assert.deepEqual(buildSeed(input, () => id), {
    id: cardId, type: 'question_answer', x: 0.5, y: 0.5, scale: 1, rotation: 0,
    question: 'Your question?', answer: 'My answer.',
  });
  id = nextId;
  assert.equal(buildSeed(input, () => id).id, nextId);
  assert.deepEqual(input, { question: '  Your question?  ', answer: '  My answer.  ' });
});

test('public card parsing preserves valid transformed geometry and trims both text fields', () => {
  assert.deepEqual(parseCard({ ...publicCard(), x: 0, y: 1, scale: 4, rotation: -180, question: ' Your question? ', answer: ' My answer. ' }), {
    id: cardId, type: 'question_answer', x: 0, y: 1, scale: 4, rotation: -180,
    question: 'Your question?', answer: 'My answer.',
  });
});

test('Story handoff and editor seed allow an empty initial answer while finalized public cards reject it', () => {
  const store = makeStore();
  const route = store.issueStoryReply({ ...storyInput(), answer: '' });
  assert.equal(store.consumeStoryReply(route.handoffToken, actorId).answer, '');
  assert.deepEqual(buildSeed({ question: 'Your question?', answer: '' }), {
    id: cardId, type: 'question_answer', x: 0.5, y: 0.5, scale: 1, rotation: 0,
    question: 'Your question?', answer: '',
  });
  assert.equal(parseCard({ ...publicCard(), answer: '' }), null);
  assert.equal(parseCard({ ...publicCard(), answer: '   ' }), null);
});

test('public card text rejects controls and angle brackets even when trimming would hide them', () => {
  for (const key of ['question', 'answer']) {
    for (const text of ['<b>text', 'text>', '\ntext', 'text\t', 'text\u0000', '\u007ftext', 'text\u0085']) {
      assert.equal(parseCard({ ...publicCard(), [key]: text }), null, `${key}: ${JSON.stringify(text)}`);
      assert.equal(buildSeed({ question: 'Your question?', answer: 'My answer.', [key]: text }), null);
    }
  }
  for (const question of ['', '   ']) {
    assert.equal(parseCard({ ...publicCard(), question }), null);
    assert.equal(buildSeed({ question, answer: '' }), null);
  }
});

test('public text enforces 500 Unicode code points rather than UTF-16 code units', () => {
  for (const key of ['question', 'answer']) {
    assert.equal(parseCard({ ...publicCard(), [key]: '😀'.repeat(500) })[key], '😀'.repeat(500));
    assert.equal(parseCard({ ...publicCard(), [key]: '😀'.repeat(501) }), null);
    assert.equal(buildSeed({ question: 'Question?', answer: 'Answer', [key]: 'x'.repeat(501) }), null);
  }
});

test('public card parsing and seeding reject private metadata and arbitrary own keys', () => {
  for (const key of ['respondentId', 'respondent_id', 'source', 'storyId', 'elementId', 'username', 'avatar', 'unknown', '__proto__']) {
    const card = publicCard();
    Object.defineProperty(card, key, { value: 'private', enumerable: true });
    assert.equal(parseCard(card), null, key);
    const seed = { question: 'Question?', answer: 'Answer' };
    Object.defineProperty(seed, key, { value: 'private', enumerable: true });
    assert.equal(buildSeed(seed), null, key);
  }
  const symbolCard = publicCard();
  symbolCard[Symbol('private')] = 'private';
  assert.equal(parseCard(symbolCard), null);
  const hidden = publicCard();
  Object.defineProperty(hidden, 'private', { value: 'private' });
  assert.equal(parseCard(hidden), null);
});

test('malformed card shapes, identities, types, and geometry fail closed', () => {
  for (const value of [null, [], 'question_answer', {}, { ...publicCard(), id: 'bad' }, { ...publicCard(), type: 'question' },
    Object.assign(Object.create({ private: 'inherited' }), publicCard()), { ...publicCard(), question: ['text'] },
    { ...publicCard(), answer: { text: 'text' } }]) {
    assert.equal(parseCard(value), null);
  }
  for (const [key, values] of Object.entries({ x: [-0.01, 1.01, NaN, Infinity, '0.5'], y: [-1, 2, null], scale: [0, 0.49, 4.01], rotation: [-181, 181] })) {
    for (const value of values) assert.equal(parseCard({ ...publicCard(), [key]: value }), null, `${key}: ${value}`);
  }
  for (const value of [null, [], {}, { question: 'Question?' }, { question: 'Question?', answer: 42 }]) {
    assert.equal(buildSeed(value), null);
  }
  assert.equal(buildSeed({ question: 'Question?', answer: 'Answer' }, () => 'bad'), null);
});

test('TypeScript UI consumers resolve typed runtime imports and reject invalid composer or handoff arguments', () => {
  const fileName = new URL('./storyQuestionRuntimeContract.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
  const source = `
    import { getStoryQuestionComposerState } from '../components/feature/storyQuestionComposerRuntime.mjs';
    import { createStoryQuestionHandoffStore, parseStoryQuestionAnswerCard, buildStoryQuestionAnswerSeed }
      from '../services/storyQuestionHandoffRuntime.mjs';
    const state: boolean = getStoryQuestionComposerState(true).hideReplyRail;
    const store = createStoryQuestionHandoffStore({ randomUUID: () => '${token}' });
    const route = store.issueChatDraft({ actorId: '${actorId}', recipientId: '${recipientId}', text: 'Draft' });
    const draft: string | undefined = store.consumeChatDraft(route?.handoffToken, '${actorId}', '${recipientId}')?.text;
    const answer: string | undefined = parseStoryQuestionAnswerCard({})?.answer;
    const seed = buildStoryQuestionAnswerSeed({ question: 'Question?', answer: '' }, { randomUUID: () => '${cardId}' });
    // @ts-expect-error composer ownership requires a boolean
    getStoryQuestionComposerState('active');
    // @ts-expect-error secure UUID generator is required
    createStoryQuestionHandoffStore({});
    // @ts-expect-error recipient is mandatory for a Chat draft
    store.issueChatDraft({ actorId: '${actorId}', text: 'Draft' });
    // @ts-expect-error source metadata is absent from a public card
    seed?.respondentId;
  `;
  const options = { noEmit: true, strict: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === fileName
    ? ts.createSourceFile(path, source, languageVersion, true)
    : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fileName], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
});

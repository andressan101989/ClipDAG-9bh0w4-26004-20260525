import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const interactions = read('components/feature/StoryInteractions.tsx');
const nativeViewer = read('components/feature/StoryViewer.native.tsx');
const webViewer = read('components/feature/StoryViewer.tsx');
const context = read('contexts/StoriesContext.tsx');
const chatService = read('services/chatService.ts');
const hMigration = read('supabase/migrations/20260910012140_stories_v2_h_replies_reactions_integrity.sql');

function createAttemptHarness(ids, transport) {
  let draft = '';
  let attempt = null;
  let sending = false;

  return {
    edit(value) {
      attempt = null;
      draft = value;
    },
    async submit() {
      const text = draft.trim();
      if (!text || sending) return;
      attempt = attempt?.text === text ? attempt : { text, clientMessageId: ids.shift() };
      sending = true;
      try {
        await transport(text, attempt.clientMessageId);
        attempt = null;
        draft = '';
      } finally {
        sending = false;
      }
    },
    state() {
      return { draft, attempt, sending };
    },
  };
}

test('first logical reply creates one canonical client message id', async () => {
  const calls = [];
  const harness = createAttemptHarness(['A'], async (text, id) => calls.push({ text, id }));
  harness.edit(' hola ');
  await harness.submit();
  assert.deepEqual(calls, [{ text: 'hola', id: 'A' }]);
});

test('failure preserves the attempt id through repeated retries', async () => {
  const calls = [];
  let failures = 2;
  const harness = createAttemptHarness(['A', 'B'], async (text, id) => {
    calls.push({ text, id });
    if (failures-- > 0) throw new Error('response_lost');
  });
  harness.edit('hola');
  await assert.rejects(harness.submit());
  assert.equal(harness.state().attempt.clientMessageId, 'A');
  await assert.rejects(harness.submit());
  assert.equal(harness.state().attempt.clientMessageId, 'A');
  await harness.submit();
  assert.deepEqual(calls.map(call => call.id), ['A', 'A', 'A']);
});

test('server commit plus lost response converges on the same logical message', async () => {
  const serverRows = new Map();
  const calls = [];
  let loseFirstResponse = true;
  const harness = createAttemptHarness(['A'], async (text, id) => {
    calls.push(id);
    if (!serverRows.has(id)) serverRows.set(id, text);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new Error('response_lost_after_commit');
    }
  });
  harness.edit('mensaje confirmado');
  await assert.rejects(harness.submit());
  await harness.submit();
  assert.deepEqual(calls, ['A', 'A']);
  assert.equal(serverRows.size, 1);
});

test('success clears the attempt and an identical new message gets another id', async () => {
  const calls = [];
  const harness = createAttemptHarness(['A', 'B'], async (_text, id) => calls.push(id));
  harness.edit('igual');
  await harness.submit();
  assert.equal(harness.state().attempt, null);
  harness.edit('igual');
  await harness.submit();
  assert.deepEqual(calls, ['A', 'B']);
});

test('editing after failure invalidates the previous attempt permanently', async () => {
  const calls = [];
  let fail = true;
  const harness = createAttemptHarness(['A', 'B'], async (text, id) => {
    calls.push({ text, id });
    if (fail) {
      fail = false;
      throw new Error('uncertain');
    }
  });
  harness.edit('original');
  await assert.rejects(harness.submit());
  harness.edit('otro');
  harness.edit('original');
  await harness.submit();
  assert.deepEqual(calls, [{ text: 'original', id: 'A' }, { text: 'original', id: 'B' }]);
});

test('double submit while sending creates one request and one id', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const calls = [];
  const harness = createAttemptHarness(['A', 'B'], async (_text, id) => {
    calls.push(id);
    await blocked;
  });
  harness.edit('hola');
  const first = harness.submit();
  const second = harness.submit();
  assert.equal(harness.state().sending, true);
  assert.deepEqual(calls, ['A']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['A']);
});

test('StoryInteractions owns the retry attempt and reuses the Chat UUID helper', () => {
  assert.match(interactions, /import \{ createChatClientMessageId \} from '@\/services\/chatService'/);
  assert.match(interactions, /replyAttemptRef = useRef<\{ text: string; clientMessageId: string \} \| null>/);
  assert.match(interactions, /replyAttemptRef\.current\?\.text === text[\s\S]*createChatClientMessageId\(\)/);
  assert.match(interactions, /catch \{[\s\S]*setSendError\(true\)[\s\S]*\} finally/);
  assert.doesNotMatch(interactions.slice(interactions.indexOf('catch {'), interactions.indexOf('} finally')), /replyAttemptRef\.current = null/);
  assert.match(interactions, /await onReply\(text, attempt\.clientMessageId\)/);
});

test('draft edits, success, and synchronous double-submit guard close the lifecycle', () => {
  assert.match(interactions, /onChangeText=\{value => \{[\s\S]*replyAttemptRef\.current = null/);
  assert.match(interactions, /await onReply[\s\S]*replyAttemptRef\.current = null[\s\S]*setDraft\(''\)/);
  assert.match(interactions, /if \(!text \|\| sendingRef\.current\) return/);
  assert.match(interactions, /sendingRef\.current = true[\s\S]*finally \{[\s\S]*sendingRef\.current = false/);
});

test('the same id is transported through Viewer, Context, and chatService', () => {
  for (const viewer of [nativeViewer, webViewer]) {
    assert.match(viewer, /sendReply = useCallback\(async \(text: string, clientMessageId: string\)/);
    assert.match(viewer, /onReplyToStory\(currentStory\.id, text, clientMessageId\)/);
  }
  assert.match(context, /replyToStory = useCallback\(async \([\s\S]*clientMessageId: string/);
  assert.match(context, /sendStoryReply\(storyId, trimmed, clientMessageId\)/);
  assert.match(chatService, /sendStoryReply\([\s\S]*clientMessageId: string/);
  assert.match(chatService, /p_client_message_id: clientMessageId/);
  const storyReplyBlock = chatService.slice(chatService.indexOf('export async function sendStoryReply'), chatService.indexOf('export async function getOrCreateDirectConversation'));
  assert.doesNotMatch(storyReplyBlock, /createChatClientMessageId\(\)/);
});

test('server and H reaction authorities remain unchanged', () => {
  assert.match(hMigration, /public\.reply_to_story\([\s\S]*p_client_message_id uuid/);
  assert.match(hMigration, /from public\.chat_send_message\(/);
  assert.match(hMigration, /create table if not exists public\.story_reactions/);
  assert.match(interactions, /STORY_REACTIONS\.map/);
  assert.doesNotMatch(interactions + context + chatService, /\.from\('messages'\)[\s\S]{0,160}\.insert/);
  assert.equal(readdirSync('supabase/migrations').filter(name => /stories_v2_h1/i.test(name)).length, 0);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const serviceSource = fs.readFileSync(
  'services/messageNotificationPresentation.ts',
  'utf8',
);
const handler = fs.readFileSync(
  'components/feature/PushNotificationHandler.tsx',
  'utf8',
);
const chat = fs.readFileSync('app/chat/[userId].tsx', 'utf8');
const messages = fs.readFileSync('contexts/MessagesContext.tsx', 'utf8');

async function loadPresentationService() {
  const js = ts.transpileModule(serviceSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

test('same active chat suppresses message presentation but background never does', async () => {
  const presentation = await loadPresentationService();
  presentation.setMessageNotificationAppState('active');
  presentation.setActiveMessageConversation('conversation-a', 'sender-a');
  assert.equal(presentation.isMessageChatCurrentlyVisible({ conversationId: 'conversation-a', senderId: 'sender-a' }), true);
  assert.equal(presentation.isMessageChatCurrentlyVisible({ conversationId: 'conversation-b', senderId: 'sender-a' }), false);
  assert.equal(presentation.isMessageChatCurrentlyVisible('sender-a'), true);

  presentation.setMessageNotificationAppState('background');
  assert.equal(presentation.isMessageChatCurrentlyVisible({ conversationId: 'conversation-a' }), false);
});

test('late cleanup for chat A cannot clear the active chat B', async () => {
  const presentation = await loadPresentationService();
  presentation.setMessageNotificationAppState('active');
  presentation.setActiveMessageConversation('chat-a');
  presentation.setActiveMessageConversation('chat-b');
  presentation.clearActiveMessageConversation('chat-a');
  assert.equal(presentation.getActiveMessageConversation(), 'chat-b');
  presentation.clearActiveMessageConversation('chat-b');
  assert.equal(presentation.getActiveMessageConversation(), null);
});

test('focused chat owns ephemeral state and cleans it conditionally', () => {
  assert.match(chat, /useFocusEffect/);
  assert.match(chat, /setActiveMessageConversation\(conversationKey \|\| null, partnerId\)/);
  assert.match(chat, /clearActiveMessageConversation\(conversationKey \|\| null, partnerId\)/);
});

test('foreground handler suppresses same-chat sound and custom banner', () => {
  assert.match(handler, /isMessageChatCurrentlyVisible/);
  assert.match(handler, /shouldPlaySound: false/);
  assert.match(handler, /shouldSetBadge: false/);
  assert.match(handler, /receivedData\.from_user_id/);
  assert.match(handler, /receivedData\.conversation_id/);
});

test('incoming calls retain their dedicated no-Expo-presentation policy', () => {
  assert.match(handler, /type === 'incoming_call'/);
  assert.match(handler, /Historical iOS Expo notifications must never bypass D4D ownership/);
});

test('unread total is the single source for the application badge', () => {
  assert.match(messages, /applicationBadgeCount = user\?\.id \? unreadTotal : 0/);
  assert.match(messages, /setBadgeCountAsync\(applicationBadgeCount\)/);
});

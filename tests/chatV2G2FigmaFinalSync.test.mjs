import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const inbox = fs.readFileSync('app/(tabs)/messages.tsx', 'utf8');
const direct = fs.readFileSync('app/chat/[userId].tsx', 'utf8');
const delivery = fs.readFileSync('components/chat/MessageDeliveryIndicator.tsx', 'utf8');
const image = fs.readFileSync('components/chat/PrivateChatImage.tsx', 'utf8');
const voice = fs.readFileSync('components/chat/VoiceMessageBubble.tsx', 'utf8');
const recorder = fs.readFileSync('components/chat/VoiceRecorderBar.tsx', 'utf8');

test('G2 keeps the current Figma nodes as the explicit visual authority', () => {
  assert.match(inbox, /FmwCrxtAV5k8jpLFr3RTgy, node 1:3/);
  assert.match(direct, /FmwCrxtAV5k8jpLFr3RTgy, node 1:112/);
});

test('Inbox header follows the current create, compose, menu order and existing routes', () => {
  const create = inbox.indexOf('accessibilityLabel="Crear grupo"');
  const compose = inbox.indexOf('accessibilityLabel="Nuevo mensaje"');
  const menu = inbox.indexOf('accessibilityLabel="Notificaciones y opciones"');
  assert.ok(create >= 0 && create < compose && compose < menu);
  assert.match(inbox, /router\.push\('\/chat\/group\/create'/);
  assert.match(inbox, /router\.push\('\/new-message'\)/);
  assert.match(inbox, /router\.push\('\/notifications'\)/);
  assert.match(inbox, /width: 32, height: 32, borderRadius: 16/);
});

test('Premium is a real direct-conversation filter, not a parallel financial list', () => {
  assert.match(inbox, /activeTab === 'premium'.*conversationType !== 'direct'/);
  assert.match(inbox, /data=\{sortedConversations\}/);
  assert.doesNotMatch(inbox, /data=\{premiumDMs\}|PremiumDMModal|premiumBanner/);
  assert.match(inbox, /name="crown-outline" size=\{13\}/);
  assert.match(inbox, /\{item\.lastMessage \|\| 'Inicia la conversación'\}/);
});

test('Inbox retains exact filters, search, cards, group avatars, unread and FAB', () => {
  for (const label of ['Todos', 'Directos', 'Grupos', 'Premium']) {
    assert.match(inbox, new RegExp(`label: '${label}'`));
  }
  assert.doesNotMatch(inbox, /label: 'No leídos'/);
  assert.match(inbox, /placeholder="Buscar conversaciones\.\.\."/);
  assert.match(inbox, /groupAvatarStack/);
  assert.match(inbox, /unreadBadge/);
  assert.match(inbox, /colors=\{\['#9B5CFF', '#7C3AED'\]\}/);
});

test('Direct header retains presence, typing, phone, video and menu actions', () => {
  assert.match(direct, /size=\{46\}/);
  assert.match(direct, /typingByUser/);
  assert.match(direct, /avatarOnlineDot/);
  for (const icon of ['phone-outline', 'video-outline', 'dots-vertical']) {
    assert.match(direct, new RegExp(`name="${icon}"`));
  }
});

test('Media cards use their Figma dimensions without a second layer of bubble padding', () => {
  assert.match(image, /width:228,height:124,borderRadius:16/);
  assert.match(direct, /isCardMedia = isImage \|\| isOneTime/);
  assert.match(direct, /mediaBubble: \{ paddingHorizontal: 0, paddingVertical: 0/);
  assert.match(direct, /oneTimeCard: \{ width: 184, height: 92/);
  assert.match(direct, /cachePolicy="none"/);
});

test('Delivery remains component-owned and integrates checks while failed retry stays external', () => {
  assert.match(direct, /item\.deliveryStatus !== 'failed' \? <MessageDeliveryIndicator/);
  assert.match(direct, /status="failed" onRetry=\{handleRetry\}/);
  assert.match(delivery, /clock-outline/);
  assert.match(delivery, /name="reload"/);
  assert.match(delivery, /status === 'read' \? '#5EDCFF'/);
});

test('Voice and composer preserve the complete approved controls and clearance', () => {
  assert.match(voice, /\(\[1, 1\.5, 2\] as ChatVoiceSpeed\[\]\)\.map/);
  assert.equal((voice.match(/useAudioPlayer\(/g) ?? []).length, 1);
  assert.match(voice, /setPlaybackRate\(next, 'high'\)/);
  assert.match(direct, /placeholder="Escribe un mensaje…"/);
  for (const label of ['Adjuntar', 'Enviar foto', 'Enviar foto de una sola vista', 'Agregar emoji']) {
    assert.match(direct, new RegExp(`accessibilityLabel=.*${label}`));
  }
  assert.match(direct, /composerBottom/);
  assert.match(direct, /composerClearance/);
  assert.match(direct, /VoiceRecorderBar/);
  assert.match(recorder, /accessibilityLabel="Cancelar nota de voz"/);
  assert.match(recorder, /accessibilityLabel="Enviar nota de voz"/);
});

test('G2 adds no parallel chat authority or protected-system implementation', () => {
  const combined = inbox + direct + delivery + image + voice + recorder;
  assert.doesNotMatch(combined, /MessagesContextV2|ChatUIService|ChatStoreV2|InboxV2|DirectChatV2|NewVoicePlayer|NewComposer|MessageStatusService/);
  const changed = [
    'app/(tabs)/messages.tsx',
    'app/chat/[userId].tsx',
    'tests/chatV2G2FigmaFinalSync.test.mjs',
  ].join('\n');
  assert.doesNotMatch(changed, /supabase|functions|migration|wallet|ledger|escrow|marketplace|live|battle|agora/i);
});

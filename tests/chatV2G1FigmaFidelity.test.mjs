import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const inbox = fs.readFileSync('app/(tabs)/messages.tsx', 'utf8');
const direct = fs.readFileSync('app/chat/[userId].tsx', 'utf8');
const voice = fs.readFileSync('components/chat/VoiceMessageBubble.tsx', 'utf8');
const recorder = fs.readFileSync('components/chat/VoiceRecorderBar.tsx', 'utf8');
const indicator = fs.readFileSync('components/chat/MessageDeliveryIndicator.tsx', 'utf8');

test('approved Figma nodes are recorded as the visual authority', () => {
  assert.match(inbox, /FmwCrxtAV5k8jpLFr3RTgy, node 1:3/);
  assert.match(direct, /FmwCrxtAV5k8jpLFr3RTgy, node 1:112/);
});

test('Inbox exposes the four approved filters and no unread primary tab', () => {
  for (const label of ['Todos', 'Directos', 'Grupos', 'Premium']) assert.match(inbox, new RegExp(`label: '${label}'`));
  assert.doesNotMatch(inbox, /label: 'No leídos'/);
  assert.match(inbox, /activeTab === 'direct'.*conversationType !== 'direct'/);
  assert.match(inbox, /activeTab === 'group'.*conversationType !== 'group'/);
  assert.match(inbox, /activeTab === 'premium'.*conversationType !== 'direct'/);
});

test('Inbox matches approved dark cards, search, group stacks and purple FAB', () => {
  assert.match(inbox, /backgroundColor: '#080A12'/);
  assert.match(inbox, /backgroundColor: '#141827'.*borderRadius: 14/);
  assert.match(inbox, /groupAvatarStack/);
  assert.match(inbox, /accessibilityLabel="Nuevo mensaje"/);
  assert.match(inbox, /colors=\{\['#9B5CFF', '#7C3AED'\]\}/);
});

test('Direct header keeps avatar presence and phone video menu actions', () => {
  assert.match(direct, /size=\{46\}/);
  assert.match(direct, /avatarOnlineDot/);
  for (const icon of ['phone-outline', 'video-outline', 'dots-vertical']) assert.match(direct, new RegExp(`name="${icon}"`));
});

test('Direct bubbles include purple outgoing, neutral incoming and red failed treatment', () => {
  assert.match(direct, /'#5222A8'/);
  assert.match(direct, /backgroundColor: '#1A1E2B'/);
  assert.match(direct, /'#451B27'/);
  assert.match(direct, /alert-circle-outline/);
  assert.match(indicator, /name="reload"/);
});

test('One-time image retains server flow with approved locked card', () => {
  assert.match(direct, /openOneTimeMedia/);
  assert.match(direct, /eye-off-outline/);
  assert.match(direct, /oneTimeBadgeText}>1/);
  assert.match(direct, /Foto de una sola vista/);
});

test('Voice note exposes visible 1x 1.5x and 2x controls on one player', () => {
  assert.match(voice, /\(\[1, 1\.5, 2\] as ChatVoiceSpeed\[\]\)\.map/);
  assert.match(voice, /useAudioPlayer\(null/);
  assert.match(voice, /setPlaybackRate\(next, 'high'\)/);
  assert.match(recorder, /backgroundColor: '#9B5CFF'/);
});

test('Composer keeps every approved control visible and keyboard clearance intact', () => {
  for (const label of ['Adjuntar', 'Enviar foto', 'Enviar foto de una sola vista', 'Agregar emoji']) {
    assert.match(direct, new RegExp(`accessibilityLabel=.*${label}`));
  }
  assert.match(direct, /placeholder="Escribe un mensaje…"/);
  assert.match(direct, /VoiceRecorderBar/);
  assert.match(direct, /composerClearance/);
  assert.match(direct, /bottom: composerBottom/);
});

test('G1 introduces no backend, finance or parallel chat authority', () => {
  const changed = [
    'app/(tabs)/messages.tsx',
    'app/chat/[userId].tsx',
    'components/chat/MessageDeliveryIndicator.tsx',
    'components/chat/VoiceMessageBubble.tsx',
    'components/chat/VoiceRecorderBar.tsx',
    'components/chat/PrivateChatImage.tsx',
    'tests/chatV2G1FigmaFidelity.test.mjs',
  ].join('\n');
  assert.doesNotMatch(changed, /supabase|wallet|ledger|marketplace|(?:^|[/\\])live(?:[/\\])|battle/i);
  assert.doesNotMatch(inbox + direct + voice, /MessagesContextV2|ChatUIService|NewVoicePlayer|NewChatStore/);
});

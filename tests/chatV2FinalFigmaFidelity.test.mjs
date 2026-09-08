import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const inbox = read('app/(tabs)/messages.tsx');
const direct = read('app/chat/[userId].tsx');
const tabs = read('app/(tabs)/_layout.tsx');
const root = read('app/_layout.tsx');
const image = read('components/chat/PrivateChatImage.tsx');
const video = read('components/chat/PrivateChatVideo.tsx');
const voice = read('components/chat/VoiceMessageBubble.tsx');
const recorder = read('components/chat/VoiceRecorderBar.tsx');
const receipt = read('components/chat/MessageDeliveryIndicator.tsx');
const packageJson = JSON.parse(read('package.json'));

const inboxHeader = inbox.slice(inbox.indexOf('{/* ── Header'), inbox.indexOf('{/* ── Search'));

test('Inbox header contains only the approved create-group and search actions', () => {
  assert.match(inboxHeader, /accessibilityLabel="Crear grupo"/);
  assert.match(inboxHeader, /accessibilityLabel="Buscar conversaciones"/);
  assert.equal((inboxHeader.match(/<Pressable/g) ?? []).length, 2);
});
test('Inbox top pencil is absent and the single pencil remains the New Message FAB', () => {
  assert.equal((inbox.match(/name="pencil-outline"/g) ?? []).length, 1);
  assert.match(inbox, /accessibilityLabel="Nuevo mensaje"[\s\S]*name="pencil-outline"/);
});
test('Inbox top dots action is absent', () => assert.doesNotMatch(inboxHeader, /dots-vertical|ellipsis/));
test('Inbox FAB keeps the real new-message route', () => assert.match(inbox, /accessibilityLabel="Nuevo mensaje"[\s\S]*router\.push\('\/new-message'\)/));
test('Inbox search action focuses the existing TextInput ref', () => assert.match(inbox, /searchInputRef\.current\?\.focus\(\)/));
test('Inbox filters remain Todos Directos Grupos Premium', () => {
  for (const label of ['Todos', 'Directos', 'Grupos', 'Premium']) assert.match(inbox, new RegExp(`label: '${label}'`));
});
test('Inbox truthful receipts remain independent of unread badges', () => {
  assert.match(inbox, /lastMessageSenderId === user\?\.id[\s\S]*MessageDeliveryIndicator/);
  assert.match(inbox, /hasUnread \? \([\s\S]*styles\.unreadBadge/);
  assert.ok(inbox.indexOf('MessageDeliveryIndicator') < inbox.lastIndexOf('styles.unreadBadge'));
});
test('Inbox canonical tab routes are unchanged', () => {
  for (const route of ['index', 'search', 'upload', 'shop', 'profile']) assert.match(tabs, new RegExp(`name: '${route}'`));
});
test('Messages remains hidden instead of becoming a fake visible tab', () => assert.match(tabs, /name="messages"\s+options=\{\{ href: null \}\}/));
test('Inbox does not render a duplicate bottom navigation', () => assert.doesNotMatch(inbox, /CustomTabBar|tabBarOuter/));

test('Direct route remains the root-stack chat route', () => assert.match(root, /name="chat\/\[userId\]"[\s\S]{0,100}headerShown: false/));
test('Direct is not moved under the tabs navigator', () => assert.doesNotMatch(tabs, /name="chat\/\[userId\]"/));
test('Direct custom back remains functional', () => assert.match(direct, /accessibilityLabel="Volver"[\s\S]{0,100}router\.back\(\)/));
test('Direct audio call handler remains functional', () => assert.match(direct, /accessibilityLabel="Llamada de audio"[\s\S]{0,160}router\.push\(`\/call\/\$\{partnerId\}`\)/));
test('Direct video call handler remains functional', () => assert.match(direct, /accessibilityLabel="Videollamada"[\s\S]{0,180}router\.push\(`\/video-call\/\$\{partnerId\}`\)/));
test('Direct profile and info action remains functional', () => assert.match(direct, /accessibilityLabel="Perfil e información"[\s\S]{0,180}router\.push\(`\/creator\/\$\{partnerId\}`/));
test('Direct contains no fake chat search or empty onPress', () => {
  assert.doesNotMatch(direct, /accessibilityLabel="Buscar en (el )?chat"/);
  assert.doesNotMatch(direct, /onPress=\{\(\) => \{\}\}/);
});
test('Direct private image remains canonical', () => assert.match(direct, /<PrivateChatImage assetId=\{item\.mediaAssetId\}/));
test('Direct one-time image remains canonical', () => assert.match(direct, /openOneTimeMedia[\s\S]*oneTimeCard/));
test('Direct voice playback remains canonical', () => assert.match(direct, /<VoiceMessageBubble messageId=\{item\.id\}/));
test('Direct private video remains canonical', () => assert.match(direct, /<PrivateChatVideo assetId=\{item\.mediaAssetId\}/));
test('Direct retry remains canonical', () => assert.match(direct, /MessageDeliveryIndicator status="failed" onRetry=\{handleRetry\}/));
test('Direct composer preserves real media emoji send and voice controls', () => {
  assert.match(direct, /handlePickImage\('normal'\)/);
  assert.match(direct, /handlePickImage\('one-time'\)/);
  assert.match(direct, /accessibilityLabel="Agregar emoji"/);
  assert.match(direct, /<VoiceRecorderBar/);
});
test('Direct composer follows keyboard and safe-area bottom', () => {
  assert.match(direct, /composerBottom = keyboardHeight > 0 \? keyboardHeight : insets\.bottom/);
  assert.match(direct, /bottom: composerBottom/);
});
test('Direct renders no bottom tab navigation', () => assert.doesNotMatch(direct, /CustomTabBar|TAB_BAR_HEIGHT|tabBarOuter/));

test('All five visible canonical tabs retain navigation handlers', () => {
  assert.match(tabs, /navigation\.navigate\(route\.name\)/);
  assert.match(tabs, /\['index','search','upload','shop','profile'\]/);
});
test('Inbox Figma header and search geometry are encoded', () => {
  assert.match(inbox, /header: \{ height: 79, position: 'relative' \}/);
  assert.match(inbox, /headerActions: \{ position: 'absolute', right: 1, top: 17/);
  assert.match(inbox, /searchWrap: \{ height: 46[\s\S]*marginHorizontal: 20/);
});
test('Inbox Figma filter widths and x rhythm are encoded', () => {
  assert.match(inbox, /width: 76, gapBefore: 0/);
  assert.match(inbox, /width: 86, gapBefore: 8/);
  assert.match(inbox, /width: 83, gapBefore: 9/);
  assert.match(inbox, /width: 80, gapBefore: 8/);
});
test('Inbox Figma row and FAB geometry are encoded responsively', () => {
  assert.match(inbox, /convItem: \{ minHeight: 64[\s\S]*marginHorizontal: 16[\s\S]*borderRadius: 14/);
  assert.match(inbox, /fab: \{ position: 'absolute', right: 24, width: 48, height: 48/);
  assert.match(inbox, /bottom: TAB_BAR_HEIGHT \+ 14/);
});
test('Canonical bottom bar is 68px and uses five equal responsive slots', () => {
  assert.match(tabs, /height: 68/);
  assert.match(tabs, /backgroundColor: '#0B0E16'/);
  assert.match(tabs, /borderTopColor: '#23283A'/);
  assert.match(tabs, /tabBtn: \{[\s\S]*flex: 1/);
});
test('Direct Figma header and separator geometry are encoded', () => {
  assert.match(direct, /header: \{[\s\S]*height: 68, position: 'relative'/);
  assert.match(direct, /headerCenter:\s+\{ position: 'absolute', left: 57, right: 111, top: 14, height: 46/);
  assert.match(direct, /borderBottomWidth: 1, borderBottomColor: '#23283A'/);
});
test('Direct Figma date chip is truthful and 52 by 22', () => {
  assert.match(direct, /conversationDayLabel = useMemo/);
  assert.match(direct, /dateChip: \{[\s\S]*width: 52, height: 22, marginTop: 12, borderRadius: 11/);
});
test('Direct composer encodes the 366 by 58 reference geometry through safe-area layout', () => {
  assert.match(direct, /inputBar: \{[\s\S]*position: 'absolute', left: 12, right: 12[\s\S]*minHeight: 58/);
  assert.match(direct, /composerHeight, setComposerHeight\] = useState\(58\)/);
  assert.match(direct, /inputDivider: \{ width: 1, height: 34, marginLeft: 4/);
});
test('Runtime layout has no hardcoded 844 viewport dependency', () => assert.doesNotMatch(direct, /\b844\b/));
test('Responsive safeguards preserve flexible rows and composer edges', () => {
  assert.match(inbox, /convInfo: \{ flex: 1/);
  assert.match(direct, /input: \{[\s\S]*flex: 1/);
  assert.match(direct, /left: 12, right: 12/);
});
test('Existing canonical media voice receipt components remain single authorities', () => {
  assert.match(image, /export function PrivateChatImage/);
  assert.match(video, /export function PrivateChatVideo/);
  assert.match(voice, /export function VoiceMessageBubble/);
  assert.match(recorder, /export function VoiceRecorderBar/);
  assert.match(receipt, /export function MessageDeliveryIndicator/);
});
test('Exact Inter family is available without a package change', () => {
  assert.ok(packageJson.dependencies['@expo-google-fonts/inter']);
  assert.match(inbox, /Inter_700Bold/);
  assert.match(direct, /Inter_400Regular/);
  assert.match(tabs, /Inter_600SemiBold/);
});

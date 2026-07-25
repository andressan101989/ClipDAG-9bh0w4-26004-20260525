import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const handler = fs.readFileSync('components/feature/PushNotificationHandler.tsx', 'utf8');
const layout = fs.readFileSync('app/_layout.tsx', 'utf8');

test('build 17 receives foreground, response and cold-start notifications', () => {
  assert.match(handler, /Notifications\.addNotificationReceivedListener/);
  assert.match(handler, /Notifications\.addNotificationResponseReceivedListener/);
  assert.match(handler, /Notifications\.getLastNotificationResponseAsync/);
  assert.match(layout, /PushNotificationHandler/);
});

test('message taps open the exact sender chat', () => {
  assert.match(handler, /case 'message':/);
  assert.match(handler, /router\.push\(`\/chat\/\$\{data\.from_user_id\}`/);
  assert.match(handler, /typeof value === 'string'/);
});

test('message handling does not invoke the legacy arbitrary notification endpoint', () => {
  assert.doesNotMatch(handler, /send-notification/);
  assert.doesNotMatch(handler, /functions\.invoke/);
});

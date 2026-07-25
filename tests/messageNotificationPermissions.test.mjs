import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const permissions = fs.readFileSync(
  'services/messageNotificationPermissionService.ts',
  'utf8',
);
const device = fs.readFileSync('services/callDeviceService.ts', 'utf8');
const handler = fs.readFileSync(
  'components/feature/PushNotificationHandler.tsx',
  'utf8',
);

test('SDK 54 granular iOS surfaces are audited without invented fields', () => {
  for (const field of [
    'allowsAlert',
    'allowsSound',
    'allowsBadge',
    'allowsDisplayInNotificationCenter',
    'allowsDisplayOnLockScreen',
  ]) {
    assert.match(permissions, new RegExp(field));
  }
  assert.doesNotMatch(permissions, /allowDisplayOnLockScreen/);
});

test('denied, provisional and incomplete authorized settings are distinguished', () => {
  assert.match(permissions, /IosAuthorizationStatus\.DENIED/);
  assert.match(permissions, /IosAuthorizationStatus\.PROVISIONAL/);
  assert.match(permissions, /isProvisional: provisional/);
  assert.match(permissions, /requiresSettings:/);
});

test('permission request explicitly asks for alert, sound and badge', () => {
  assert.match(device, /requestPermissionsAsync\(\{\s*ios:/s);
  assert.match(device, /allowAlert: true/);
  assert.match(device, /allowSound: true/);
  assert.match(device, /allowBadge: true/);
  assert.doesNotMatch(device, /allowProvisional: true/);
  assert.doesNotMatch(device, /allowCriticalAlerts: true/);
  assert.match(permissions, /requestPermissionsAsync\(\{/);
  assert.match(permissions, /allowAlert: true/);
  assert.match(permissions, /allowSound: true/);
  assert.match(permissions, /allowBadge: true/);
});

test('settings warning is throttled per native build and remains non-blocking', () => {
  assert.match(handler, /Application\.nativeBuildVersion/);
  assert.match(handler, /AsyncStorage\.getItem\(promptKey\)/);
  assert.match(handler, /Linking\.openSettings\(\)/);
  assert.match(handler, /Ahora no/);
  assert.match(handler, /syncCurrentCallDevice\(\{ force: true \}\)/);
});

test('normal notification permissions do not alter VoIP identity', () => {
  const getPermission = device.slice(
    device.indexOf('async function getNotificationPermission'),
    device.indexOf('async function getExpoPushToken'),
  );
  assert.doesNotMatch(getPermission, /voip_push_token/);
  assert.doesNotMatch(getPermission, /installationId/);
  assert.doesNotMatch(getPermission, /deviceId/);
});

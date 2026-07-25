import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = fs.readFileSync('services/walletConnectConfig.native.ts', 'utf8');
const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const info = fs.readFileSync('ios/onspaceapp/Info.plist', 'utf8');

assert.equal(appJson.expo.scheme, 'onspaceapp');
assert.equal(appJson.expo.ios.bundleIdentifier, 'com.clipdag.onspaceapp');
assert.deepEqual(appJson.expo.ios.infoPlist.LSApplicationQueriesSchemes, ['metamask', 'trust', 'cbwallet']);
assert.match(config, /native: 'onspaceapp:\/\/'/);
assert.match(info, /<string>onspaceapp<\/string>/);
assert.match(info, /<string>com\.clipdag\.onspaceapp<\/string>/);
for (const scheme of ['metamask', 'trust', 'cbwallet']) {
  assert.match(info, new RegExp(`<string>${scheme}<\\/string>`));
}

console.log('walletConnectDeepLink: PASS');


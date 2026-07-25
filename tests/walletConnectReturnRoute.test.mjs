import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = fs.readFileSync('services/walletConnectConfig.native.ts', 'utf8');
const handler = fs.readFileSync('components/feature/WalletConnectReturnHandler.native.tsx', 'utf8');
assert.match(config, /native:\s*'onspaceapp:\/\/wallet'/);
assert.match(handler, /Linking\.getInitialURL/);
assert.match(handler, /Linking\.addEventListener\('url'/);
assert.match(handler, /AppState\.addEventListener/);
assert.match(handler, /router\.replace\('\/\(tabs\)\/wallet'\)/);
assert.match(handler, /call\|video-call\|group-call/);
console.log('walletConnectReturnRoute: PASS');

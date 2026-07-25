import assert from 'node:assert/strict';
import fs from 'node:fs';

const config = fs.readFileSync('services/walletConnectConfig.native.ts', 'utf8');
const provider = fs.readFileSync('components/feature/WalletConnectProvider.native.tsx', 'utf8');
const hook = fs.readFileSync('hooks/useExternalWallet.native.ts', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.equal(config.split(/\r?\n/, 1)[0], "import '@walletconnect/react-native-compat';");
assert.match(config, /WALLETCONNECT_PROJECT_ID_PRESENT/);
assert.match(config, /createAppKit\(/);
assert.match(config, /walletConnectAppKit = createAppKit/);
assert.match(config, /native: 'onspaceapp:\/\/wallet'/);
assert.match(config, /universal: 'https:\/\/clipdag\.io'/);
assert.match(provider, /<AppKitProvider instance=\{walletConnectAppKit\}>/);
assert.match(provider, /<AppKit \/>/);
assert.doesNotMatch(hook, /\brequire\s*\(/);
assert.equal(pkg.dependencies['@walletconnect/modal-react-native'], undefined);
assert.equal(pkg.dependencies['@reown/appkit-react-native'], '^2.0.6');
assert.equal(pkg.dependencies['@reown/appkit-ethers-react-native'], '^2.0.6');

console.log('walletConnectProvider: PASS');

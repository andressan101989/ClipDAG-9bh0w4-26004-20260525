import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('hooks/useExternalWallet.native.ts', 'utf8');

assert.match(source, /useWalletConnectAccount\(\)/);
assert.match(source, /useWalletConnectProvider\(\)/);
assert.match(source, /account\.isConnected && validAddress !== null/);
assert.match(source, /isValidEvmAddress\(account\.address\)/);
assert.doesNotMatch(source, /setInterval|setTimeout/);
assert.doesNotMatch(source, /session\.namespaces|session\.topic/);
assert.match(source, /status: isConnected \? 'connection_confirmed' : 'modal_opened'/);
assert.match(source, /await appKit\.disconnect\('eip155'\)/);
assert.match(source, /parseChainId\(account\.chainId\)/);
assert.match(source, /isUserRejectedWalletRequest\(error\)/);

console.log('walletConnectHook: PASS');


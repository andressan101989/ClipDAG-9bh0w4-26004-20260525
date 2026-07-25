import assert from 'node:assert/strict';
import fs from 'node:fs';

const hook = fs.readFileSync('hooks/useExternalWallet.native.ts', 'utf8');
const screen = fs.readFileSync('app/(tabs)/wallet.tsx', 'utf8');
const api = fs.readFileSync('services/walletApi.ts', 'utf8');

assert.match(hook, /const networkResult = await ensureNetwork\(targetNetwork\)/);
assert.match(hook, /reported !== Number\(target\.id\)/);
assert.match(hook, /to: tokenContract, value: '0x0', data/);
assert.match(screen, /sendToTreasury\(depositAmt\.trim\(\), treasury, depositNetwork, depositAsset\)/);
assert.match(screen, /submitDepositToBackend\(depositPayload\)/);
assert.match(api, /tx_hash|txHash/);
assert.doesNotMatch(screen, /ledger_accounts/);
assert.doesNotMatch(hook, /ledger_accounts|voip_push_token|CallKit|PushKit/);

console.log('walletDepositFlow: PASS');

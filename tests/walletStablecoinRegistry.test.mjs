import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync('services/stablecoinRegistry.ts', 'utf8');
const backend = fs.readFileSync('supabase/functions/_shared/stablecoins.ts', 'utf8');
const expected = [
  ['USDT', '1', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
  ['USDC', '1', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
  ['USDC', '8453', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
];
for (const [symbol, chain, contract] of expected) {
  assert.ok(client.includes(symbol) && client.includes(contract));
  assert.ok(backend.includes(symbol) && backend.includes(chain) && backend.includes(contract));
}
assert.doesNotMatch(client, /symbol:\s*'ETH'/);
assert.doesNotMatch(backend, /symbol:\s*'ETH'/);
console.log('walletStablecoinRegistry: PASS');


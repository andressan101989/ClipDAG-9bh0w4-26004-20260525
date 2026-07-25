import assert from 'node:assert/strict';
import fs from 'node:fs';

const hook = fs.readFileSync('hooks/useExternalWallet.native.ts', 'utf8');
const registry = fs.readFileSync('services/stablecoinRegistry.ts', 'utf8');
const deposit = fs.readFileSync('supabase/functions/bdag-deposit/index.ts', 'utf8');
const withdraw = fs.readFileSync('supabase/functions/bdag-withdraw/index.ts', 'utf8');
for (const address of [
  '0xdac17f958d2ee523a2206206994597c13d831ec7',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
]) assert.ok(registry.toLowerCase().includes(address));
assert.match(hook, /getStablecoinConfig/);
assert.match(deposit, /getStablecoinByContract/);
assert.match(withdraw, /getStablecoin/);
assert.doesNotMatch(registry, /symbol:\s*'ETH'/);
console.log('walletAssetContracts: PASS');

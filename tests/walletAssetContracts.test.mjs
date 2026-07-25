import assert from 'node:assert/strict';
import fs from 'node:fs';

const hook = fs.readFileSync('hooks/useExternalWallet.native.ts', 'utf8');
const chains = fs.readFileSync('services/multiChainService.ts', 'utf8');
const deposit = fs.readFileSync('supabase/functions/bdag-deposit/index.ts', 'utf8');
const withdraw = fs.readFileSync('supabase/functions/bdag-withdraw/index.ts', 'utf8');

const ethereumUsdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const baseUsdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

assert.ok(hook.toLowerCase().includes(ethereumUsdt));
assert.ok(deposit.toLowerCase().includes(ethereumUsdt));
assert.ok(withdraw.toLowerCase().includes(ethereumUsdt));
assert.ok(!hook.toLowerCase().includes(baseUsdc));
assert.ok(!chains.toLowerCase().includes(baseUsdc));
assert.ok(!deposit.toLowerCase().includes(baseUsdc));
assert.ok(!withdraw.toLowerCase().includes(baseUsdc));
assert.match(hook, /USDT no está habilitado actualmente en Base\. Selecciona Ethereum\./);
assert.match(hook, /targetChainId !== 1/);

console.log('walletAssetContracts: PASS');


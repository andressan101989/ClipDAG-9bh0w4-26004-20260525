import assert from 'node:assert/strict';
import fs from 'node:fs';

const monitor = fs.readFileSync('supabase/functions/bdag-monitor/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260725220000_stablecoin_withdrawal_settlement.sql', 'utf8');
assert.match(monitor, /complete_withdrawal_settlement/);
assert.doesNotMatch(monitor, /\.gt\('expires_at'/);
assert.match(migration, /for update/i);
assert.match(migration, /already_completed/i);
assert.match(migration, /p_confirmations < 2/);
assert.match(migration, /financial_transactions[\s\S]*status = 'completed'/);
assert.match(migration, /blockchain_settlements[\s\S]*'confirmed'/);
console.log('walletWithdrawalConfirmation: PASS');


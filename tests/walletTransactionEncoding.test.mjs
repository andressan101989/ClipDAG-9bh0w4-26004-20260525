import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync('services/walletTransactionEncoding.ts', 'utf8');
const hook = fs.readFileSync('hooks/useExternalWallet.native.ts', 'utf8');

assert.match(source, /BigInt\(whole\) \* \(10n \*\* BigInt\(decimals\)\)/);
assert.match(source, /fraction\.length > decimals/);
assert.match(source, /units <= 0n/);
assert.match(source, /0xa9059cbb/);
assert.match(source, /new TextEncoder\(\)\.encode\(message\)/);
assert.match(source, /candidate\?\.code === 4001/);
assert.doesNotMatch(hook, /Math\.round\(.*10 \*\*/);
assert.doesNotMatch(hook, /Buffer\.from/);
assert.match(hook, /decimalToUnits\(amountNative, 18\)/);
assert.match(hook, /encodeErc20Transfer\(toAddress, decimalToUnits\(amount, decimals\)\)/);
assert.match(hook, /params: \[utf8ToHex\(message\), validAddress\]/);

const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const encoding = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

assert.equal(encoding.decimalToUnits('1', 6), 1_000_000n);
assert.equal(encoding.decimalToUnits('1.5', 6), 1_500_000n);
assert.equal(encoding.decimalToUnits('0.000001', 6), 1n);
assert.equal(encoding.decimalToUnits('0.000000000000000001', 18), 1n);
assert.equal(encoding.unitsToHex(1_000_000_000_000_000_000n), '0xde0b6b3a7640000');
assert.throws(() => encoding.decimalToUnits('1e-6', 6), /Monto inválido/);
assert.throws(() => encoding.decimalToUnits('-1', 6), /Monto inválido/);
assert.throws(() => encoding.decimalToUnits('0.0000001', 6), /máximo 6/);
assert.equal(
  encoding.utf8ToHex('OnSpace 🚀'),
  '0x4f6e537061636520f09f9a80',
);
assert.equal(
  encoding.encodeErc20Transfer('0x0000000000000000000000000000000000000001', 1n),
  `0xa9059cbb${'1'.padStart(64, '0')}${'1'.padStart(64, '0')}`,
);

console.log('walletTransactionEncoding: PASS');

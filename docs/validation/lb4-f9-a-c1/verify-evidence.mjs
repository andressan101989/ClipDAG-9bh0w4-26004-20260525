import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'docs/validation/lb4-f9-a-c1/';
// PowerShell redirects UTF-16 on this host; serialize only this phase's evidence
// as UTF-8/LF, without changing values or diagnostic content.
for (const file of readdirSync(dir).filter(n => /\.(json|tap|log|txt)$/.test(n))) {
  const data = readFileSync(dir + file);
  let text = data.subarray(0,2).equals(Buffer.from([255,254])) ? data.toString('utf16le').slice(1) : data.toString('utf8').replace(/^\ufeff/, '');
  text = text.replace(/\r\n/g, '\n');
  if (file.endsWith('.json')) JSON.parse(text);
  writeFileSync(dir + file, text.replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n'));
}
const read = file => JSON.parse(readFileSync(dir + file, 'utf8'));
const difference = (after, before) => after.filter(x => !before.some(y => JSON.stringify(x) === JSON.stringify(y)));
const before = read('advisors-before.json'), after = read('advisors-after.json');
const lintBefore = read('lint-before.json').flatMap(f => f.issues.map(issue => ({ function: f.function, ...issue })));
const lintAfter = read('lint-after.json').flatMap(f => f.issues.map(issue => ({ function: f.function, ...issue })));
const result = { advisors: { historical: before.length, current: after.length, added: difference(after,before), removed: difference(before,after) },
  lint: { historical: lintBefore.length, current: lintAfter.length, added: difference(lintAfter,lintBefore), removed: difference(lintBefore,lintAfter),
    historicalLevels: Object.fromEntries([...new Set(lintBefore.map(x => x.level))].map(level => [level, lintBefore.filter(x => x.level === level).length])) } };
writeFileSync(dir + 'diagnostic-comparison.json', JSON.stringify(result,null,2));
assert.deepEqual(result.advisors.added, []); assert.deepEqual(result.lint.added, []);
// Relation OIDs are recreated by the clean schema bootstrap; they are not ACL.
const acl = rows => rows.map(({ relid, ...security }) => security);
assert.deepEqual(acl(read('red-security-lint.json').functions), acl(read('green-security-lint.json').functions));
assert.equal(read('green-security-lint.json').lint.length, 0);
console.log(JSON.stringify(result));
const prefix = s => s.replace(/\r\n/g, '\n').replace(/C:[/\\]Users[/\\]andre[/\\]ClipDAG-[^"\r\n]*?(?=[/\\](?:node_modules|modules)[/\\])/g, '<worktree>');
const c1 = JSON.parse(readFileSync('docs/validation/lb4-f8-a-c1/typescript-c1.json','utf8')).output;
const current = readFileSync(dir + 'typescript.txt','utf8');
// C1 has different watch line numbers because F9 added the batching effect.
// The exact immediate F9 baseline comparison is in typescript-comparison.json;
// do not normalize away these historical line-number shifts here.
const historical = prefix(c1).match(/: error TS\d+/g).length;
assert.equal(historical, 237); assert.equal(prefix(current).match(/: error TS\d+/g).length, 237);
const migrated = read('production-migration-preflight.json'); assert.equal(migrated.f9Applied, false);
const suites = read('suites.json'); assert.equal(suites.length, 8);
for (const suite of suites) { assert.equal(suite.tests, suite.pass); for (const field of ['exitCode','fail','skipped','cancelled','todo']) assert.equal(suite[field], 0); }
console.log('All C1 evidence JSON valid; ACL unchanged; focused DB lint 0; all eight suites complete');

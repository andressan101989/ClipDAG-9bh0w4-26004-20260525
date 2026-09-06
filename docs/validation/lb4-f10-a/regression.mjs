import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const evidence = 'docs/validation/lb4-f10-a/';
const files = readdirSync('tests').filter(f => f.endsWith('.test.mjs')).sort();
const groups = [ ['f10-a', /^liveBattlesLb4F10A/], ['media-relay', /Relay|PostRound/i], ['host-ui', /F2Invitation|F8BPhysical|F5BClient|Ui1Figma/i], ['realtime', /Realtime|Subscription|Snapshot|Projection/i], ['agora-auth', /Agora|agoraToken/i], ['f9-b', /^liveBattlesLb4F9BSpectatorControls/], ['viewer-ui', /Lb4F7BViewerUi|Lb4Ui1FigmaStage/], ['gifts', /gift/i], ['c1', /^liveBattlesLb4F9AC1/], ['f9-a', /^liveBattlesLb4F9AScoring/], ['f8', /Lb4F8/],
  ['reactions', /reaction|liveLb1/i], ['runtime', /Runtime|Series|Rematch/i], ['battles', /liveBattle/i], ['finance', /financ|wallet|ledger|gift/i], ['global', /./] ];
const results = [];
for (const [name, pattern] of (process.argv[2] === 'verify' ? [] : groups)) {
  const selected = files.filter(f => pattern.test(f)).map(f => 'tests/' + f);
  const args = ['--test', '--test-reporter=tap', ...selected];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 30e6 });
  const output = result.stdout + result.stderr;
  writeFileSync(evidence + name + '.tap', output);
  const counters = Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k => [k, Number(output.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1])]));
  results.push({ name, command: 'node --test --test-reporter=tap', files: selected, exitCode: result.status, ...counters });
  writeFileSync(evidence + 'suites.json', JSON.stringify(results, null, 2));
  console.log(name, counters);
  assert.equal(result.status, 0); assert.ok(counters.tests > 0); assert.equal(counters.tests, counters.pass);
  for (const k of ['fail','cancelled','skipped','todo']) assert.equal(counters[k], 0);
}
const tsc = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd tsc --noEmit --pretty false'], { encoding: 'utf8', windowsHide: true, maxBuffer: 20e6 });
writeFileSync(evidence + 'typescript.txt', tsc.stdout + tsc.stderr);
// Only known absolute worktree prefixes differ. Do not strip line numbers,
// diagnostic codes/messages, relative source paths or any diagnostic content.
const normalize = s => s.replace(/\r\n/g, '\n').replace(/C:[/\\]Users[/\\]andre[/\\]ClipDAG-[^"\r\n]*?(?=[/\\](?:node_modules|modules)[/\\])/g, '<worktree>');
const baseline = normalize(readFileSync('docs/validation/lb4-f9-b/typescript.txt','utf8'));
const current = normalize(tsc.stdout + tsc.stderr);
const diagnostics = s => s.split(/(?=^[^\n]+\(\d+,\d+\): error TS)/m).filter(s => /: error TS/.test(s));
const old = diagnostics(baseline), now = diagnostics(current);
const added = now.filter(s => !old.includes(s)), removed = old.filter(s => !now.includes(s));
writeFileSync(evidence + 'typescript-comparison.json', JSON.stringify({ exitCode: tsc.status, historical: old.length, current: now.length, added, removed, exactNormalizedOutputMatch: baseline === current }, null, 2));
assert.equal(tsc.status, 2); assert.equal(old.length, 237); assert.equal(now.length, 237); assert.deepEqual(added, []); assert.deepEqual(removed, []); assert.equal(current, baseline);
console.log('TypeScript: 237 historical, 0 added, 0 removed');
const base = 'cc5ac4766d0a6ba4f9a60f738ea3b7fa2ebe537a';
const migration = 'supabase/migrations/20260906053652_live_battle_gift_like_scoring.sql';
const hash = data => createHash('sha256').update(data.replace(/\r\n/g, '\n')).digest('hex');
const protectedFiles = ['package.json', 'package-lock.json', ...readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => 'supabase/migrations/' + f)];
assert.equal(protectedFiles.length, 213);
const hashes = protectedFiles.map(file => {
  const original = spawnSync('git', ['show', base + ':' + file], { encoding: 'utf8', windowsHide: true, maxBuffer: 20e6 }); assert.equal(original.status, 0);
  const expected = hash(original.stdout), actual = hash(readFileSync(file,'utf8')); assert.equal(actual, expected, file);
  return { file, expected, actual, unchanged: true };
});
writeFileSync(evidence + 'protected-lf-hashes.json', JSON.stringify(hashes, null, 2));
const finalHash = hash(readFileSync(migration,'utf8'));
writeFileSync(evidence + 'migration-lf-hash.json', JSON.stringify({ file: migration, sha256LF: finalHash }, null, 2));
console.log('213 protected LF hashes unchanged; F9-A:', finalHash);
const diff = spawnSync('git', ['diff','--check'], { encoding: 'utf8', windowsHide: true }); assert.equal(diff.status, 0); console.log('git diff --check: PASS');

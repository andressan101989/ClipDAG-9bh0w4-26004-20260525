import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as candidate from '../scripts/nelyon-b2-readonly-migration-plan.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const file = (version, name = 'change') => ({ path: `supabase/migrations/${version}_${name}.sql`, content: 'select 1;\n' });
const a = file('20260101000000');
const b = file('20260102000000', 'b2');
const entry = f => ({path: f.path, version: f.path.split('/').at(-1).slice(0,14), sha256: hash(f.content)});
const args = () => ({projectRef:'aewwdlvbwpczqyvkwvvj', sourceSha:'a'.repeat(40), migrationsEnabled:true, localFiles:[{...b},{...a}], remoteRows:[{version:'20260101000000'}], manifest:{identity:{approved_sha:'a'.repeat(40)},resources:{migrations:[entry(b)]}}});
test('only B2 is pending and evidence is explicitly NOT deployment authority', () => {
 const result = candidate.planReadOnlyMigrations(args());
 assert.deepEqual(result.pending_versions,['20260102000000']);
 assert.equal(result.source,'supabase-management-read-only-ledger-plan/v1');
 assert.equal(result.cli_version_semantics,'2.120.0');
 assert.equal(result.deployment_authorized,false);
 assert.equal(result.source_sha,'a'.repeat(40));
 assert.match(result.local_inventory_sha256,/^[a-f0-9]{64}$/);
});
test('up to date accepts empty manifest', () => {
 const input=args(); input.remoteRows.push({version:'20260102000000'}); input.manifest.resources.migrations=[];
 assert.deepEqual(candidate.planReadOnlyMigrations(input).pending_versions,[]);
});
for (const [label, modify, message] of [
 ['missing local', x=>x.remoteRows=[{version:'20250101000000'}], /MISSING_LOCAL/],
 ['out of order local', x=>x.remoteRows=[{version:'20260102000000'}], /MISSING_REMOTE/],
 ['duplicate local version', x=>x.localFiles.push(file('20260101000000','duplicate')), /LOCAL_INVENTORY/],
 ['duplicate remote version', x=>x.remoteRows.push(...x.remoteRows), /REMOTE_LEDGER/],
 ['unsorted remote', x=>x.remoteRows=[{version:'20260102000000'},{version:'20260101000000'}], /REMOTE_LEDGER/],
 ['invalid remote', x=>x.remoteRows=[{version:'x'}], /REMOTE_LEDGER/],
 ['invalid local path', x=>x.localFiles[0].path='../escape.sql', /LOCAL_INVENTORY/],
 ['disabled migrations', x=>x.migrationsEnabled=false, /MIGRATIONS_DISABLED/],
 ['wrong project', x=>x.projectRef='b'.repeat(20), /PROJECT/],
 ['invalid sha', x=>x.sourceSha='main', /SOURCE_SHA/],
 ['manifest extra migration', x=>x.manifest.resources.migrations.push(entry(a)), /MANIFEST/],
 ['manifest missing migration', x=>x.manifest.resources.migrations=[], /MANIFEST/],
 ['manifest bad hash', x=>x.manifest.resources.migrations[0].sha256='0'.repeat(64), /MANIFEST/],
 ['manifest wrong version', x=>x.manifest.resources.migrations[0].version='20260103000000', /MANIFEST/],
 ['manifest duplicate', x=>x.manifest.resources.migrations.push(entry(b)), /MANIFEST/],
]) test(`rejects ${label}`,()=>{const input=args(); modify(input); assert.throws(()=>candidate.planReadOnlyMigrations(input),message);});
test('inventory digest changes on applied-file edit',()=>{
 const input=args(); const before=candidate.planReadOnlyMigrations(input); input.localFiles[1].content='select 2;';
 assert.notEqual(candidate.planReadOnlyMigrations(input).local_inventory_sha256,before.local_inventory_sha256);
});
test('manifest digest changes when other release resources change',()=>{
 const input=args(); const before=candidate.planReadOnlyMigrations(input); input.manifest.other='different';
 assert.notEqual(candidate.planReadOnlyMigrations(input).manifest_sha256,before.manifest_sha256);
});


test('rejects manifest approved SHA mismatch',()=>{
 const input=args(); input.manifest.identity.approved_sha='b'.repeat(40);
 assert.throws(()=>candidate.planReadOnlyMigrations(input),/MANIFEST/);
});
test('candidate evidence cannot satisfy existing CLI dry-run gate',async()=>{
 const {verifyMigrationDryRun}=await import('../scripts/nelyon-production-release.mjs');
 const input=args(); const plan=candidate.planReadOnlyMigrations(input);
 assert.throws(()=>verifyMigrationDryRun({text:JSON.stringify(plan),manifest:input.manifest}),/migration dry-run evidence is malformed/);
});
test('generated ordered ledgers agree with CLI default prefix semantics',()=>{
 const versions=['20260101000000','20260102000000','20260103000000','20260104000000'];
 for(let l=0;l<16;l++) for(let r=0;r<16;r++) {
  const local=versions.filter((_,i)=>l & (1<<i));
  const remote=versions.filter((_,i)=>r & (1<<i));
  const input=args(); input.localFiles=local.map(v=>file(v)); input.remoteRows=remote.map(version=>({version}));
  const missingLocal=remote.some(v=>!local.includes(v));
  const missingRemote=local.some(v=>!remote.includes(v) && v < (remote.at(-1) ?? ''));
  const pending=local.filter(v=>!remote.includes(v));
  input.manifest.resources.migrations=pending.map(v=>entry(file(v)));
  if(missingLocal) assert.throws(()=>candidate.planReadOnlyMigrations(input),/MISSING_LOCAL/);
  else if(missingRemote) assert.throws(()=>candidate.planReadOnlyMigrations(input),/MISSING_REMOTE/);
  else assert.deepEqual(candidate.planReadOnlyMigrations(input).pending_versions,pending);
 }
});

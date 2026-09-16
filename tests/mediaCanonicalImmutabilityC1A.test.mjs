import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const create=fs.readFileSync('supabase/functions/create-media-upload/index.ts','utf8');
const r2=fs.readFileSync('supabase/functions/_shared/r2.ts','utf8');
const service=fs.readFileSync('services/mediaService.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260916045152_canonical_media_ready_identity_immutability_v1.sql','utf8');

test('canonical upload is write-once and returns every signed header',()=>{
  assert.match(create,/signPutIfAbsent\(bucket,key,mime,\{\}\)/);
  assert.match(create,/headers:\{'Content-Type':mime,'If-None-Match':'\*'\}/);
  assert.match(r2,/IfNoneMatch:'\*'/);
  assert.match(r2,/signableHeaders:new Set\(\['content-type','if-none-match'\]\)/);
  assert.doesNotMatch(r2,/export const signPut=/);
});

test('the central uploader forwards the server-returned header contract',()=>{
  assert.match(service,/type R2UploadHeaders = \{[\s\S]*"Content-Type": string;[\s\S]*"If-None-Match": "\*";/);
  assert.match(service,/headers: contract\.headers/);
  assert.match(service,/response\.status === 412 && priorAttemptWasAmbiguous/);
});

test('ready R2 identity is permanently locked while lifecycle fields remain mutable',()=>{
  for(const field of ['owner_id','provider','media_kind','purpose','visibility','bucket_name','object_key','mime_type','size_bytes','etag']) {
    assert.match(migration,new RegExp(`new\\.${field} is distinct from old\\.${field}`));
  }
  assert.match(migration,/if old\.ready_at is not null/);
  for(const lifecycle of ['status','deleted_at','cleanup_attempts','last_cleanup_attempt_at','next_cleanup_attempt_at','error_code','updated_at']) {
    assert.doesNotMatch(migration,new RegExp(`new\\.${lifecycle} is distinct from old\\.${lifecycle}`));
  }
});

test('ready Stream UID is locked without blocking reconciliation metadata',()=>{
  for(const field of ['owner_id','provider','purpose','visibility','cloudflare_uid','mime_type','size_bytes','max_duration_seconds']) {
    assert.match(migration,new RegExp(`new\\.${field} is distinct from old\\.${field}`));
  }
  for(const reconciled of ['provider_status','provider_progress','duration_seconds','width','height','hls_url','dash_url','thumbnail_url','last_provider_check_at']) {
    assert.doesNotMatch(migration,new RegExp(`new\\.${reconciled} is distinct from old\\.${reconciled}`));
  }
});

test('the corrective creates no parallel media or job authority',()=>{
  assert.doesNotMatch(migration,/create\s+table/i);
  assert.doesNotMatch(migration,/security\s+definer/i);
  assert.match(migration,/security invoker[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(create,/immutability_probe|asset_probe|probe_cleanup|probe_delete/);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter(x => /_stories_v2_safety_c2_publish_first_async_review\.sql$/.test(x));
const sql = files.length === 1 ? readFileSync(new URL(files[0], dir), 'utf8') : '';
const body = name => {
  const found = sql.match(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\([^]*?as \\$\\$([^]*?)\\$\\$;`, 'i'));
  assert.ok(found, `${name} is installed`); return found[1];
};

test('C2 has exactly one forward-only migration with independent facts and no historical publication', () => {
  assert.equal(files.length, 1);
  assert.match(sql, /publication_status text not null default 'unpublished'/);
  assert.match(sql, /moderation_status text not null default 'unreviewed'/);
  assert.doesNotMatch(sql, /update private\.story_safety_state set publication_status='published';/);
});
test('publication is fenced to the exact durable scan and follower access requires publication, never passed', () => {
  assert.match(body('private.story_publish_c2_v1'), /story_safety_publication_fence_failed/);
  assert.match(body('private.story_publish_c2_v1'), /content_fingerprint/);
  assert.match(body('private.story_can_access'), /publication_status='published'/);
  assert.doesNotMatch(body('private.story_can_access'), /state='passed'|control_c1/);
});
test('C2 operating model never authorizes automatic normative decisions', () => {
  const control = body('private.story_content_safety_control_c2_v1');
  assert.match(control, /nelyon\.stories\.general\.safety\.publish_first\.v1/);
  assert.match(control, /PUBLISH_FIRST_ASYNC_REVIEW/);
  assert.match(control, /"automatic_allow_authorized": false/);
  assert.match(control, /"automatic_block_authorized": false/);
  assert.doesNotMatch(sql, /state\s*=\s*'(passed|blocked)'/);
});
test('the operating-model policy and control pin the exact separate artifact bytes',()=>{
  const bytes=readFileSync(new URL('../docs/stories-v2-content-safety-policy-publish-first-v1.json',import.meta.url));
  const digest=createHash('sha256').update(bytes).digest('hex');
  const policy=JSON.parse(body('private.story_content_safety_policy_c2_v1').match(/\$policy\$([^]*?)\$policy\$/)[1]);
  const control=JSON.parse(body('private.story_content_safety_control_c2_v1').match(/\$control\$([^]*?)\$control\$/)[1]);
  const {artifact_sha256,...artifact}=policy;
  assert.equal(artifact_sha256,digest);assert.equal(control.policy_artifact_sha256,digest);
  assert.deepEqual(artifact,JSON.parse(bytes));
  assert.equal(artifact.approval.status,'owner_approved_operating_model_only');
  assert.equal(control.owner_approved_policy,false);
});
test('interactive shared creation queues only after definitions and preserves the create velocity check',()=>{
  assert.doesNotMatch(body('private.create_story_from_content_core_c2_v1'),/story_enqueue_media_safety_v1|story_publish_c2_v1/);
  assert.match(body('private.story_initialize_safety'),/story_consume_velocity\(auth\.uid\(\),'create'\)/);
});
test('scan projection is fenced and human moderation uses the existing audited authority', () => {
  assert.match(body('private.story_runtime_status_c2_v1'), /evidence_fingerprint/);
  assert.match(body('public.admin_moderate_story'), /stories\.items\.moderate/);
  assert.match(body('public.admin_moderate_story'), /admin_action_audit/);
  assert.match(body('public.admin_moderate_story'), /keep.*restrict.*remove/);
  assert.doesNotMatch(body('public.admin_moderate_story'), /delete from/i);
});
test('admin projections retain every secure inspection field and provider host allowlist',()=>{
  const detail=body('public.get_admin_story_detail'),list=body('public.search_admin_stories');
  for(const key of ['resolved_media_kind','source_status','media_origin','preview_url']) {
    assert.ok(detail.includes(`'${key}'`),key);assert.ok(list.includes(`'${key}'`),key);
  }
  for(const key of ['linked_media_asset_id','media_asset_id','expired','media_url','poster_url','source','reports']) {
    assert.ok(detail.includes(`'${key}'`),key);
  }
  for(const source of [detail,list]) {
    assert.match(source,/pub-d146e3d06d274db4871f5b6020fd850f/);
    assert.match(source,/cloudflarestream/);assert.match(source,/videodelivery/);
  }
});
test('direct Stream inspection exposes canonical signed-private asset identity without private URLs',()=>{
  for(const name of ['public.search_admin_stories','public.get_admin_story_detail']) {
    const source=body(name),join=source.match(/left join lateral \(\s*select l\.asset_id\s*from public\.video_asset_links l join public\.video_assets va[^]*?\) direct_stream on true/)[0];
    assert.match(join,/l\.entity_type='story'/);assert.match(join,/l\.slot='media' and l\.position=0/);
    assert.match(join,/va\.purpose='story_video'/);assert.match(join,/va\.visibility='private'/);
    assert.match(join,/va\.status='ready' and va\.deleted_at is null/);
    assert.match(join,/require_signed_urls.*true/);assert.match(join,/va\.hls_url is null and va\.dash_url is null and va\.thumbnail_url is null/);
    assert.match(source,/'story_stream_asset'/);assert.match(source,/'linked_video_asset_id'/);
  }
});

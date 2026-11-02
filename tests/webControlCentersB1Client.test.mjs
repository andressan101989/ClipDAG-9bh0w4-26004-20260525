import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const read=relative=>readFileSync(path.join(root,relative),'utf8');
const draftServicePath=path.join(root,'services','publicationDraftService.ts');

test('media service distinguishes native URI and browser binary upload sources',()=>{
  const source=read('services/mediaService.ts');
  assert.match(source,/type\s+(?:Canonical)?UploadSource[\s\S]{0,1200}'native-uri'/i);
  assert.match(source,/type\s+(?:Canonical)?UploadSource[\s\S]{0,1200}'browser-(?:blob|file)'/i);
  assert.match(source,/blob\s*:\s*Blob|file\s*:\s*Blob/i);
  assert.match(source,/sizeBytes\s*:\s*number/i);
  assert.match(source,/mimeType\s*:\s*string/i);
  assert.match(source,/fileName\s*:\s*string/i);
  assert.match(source,/body\s*:\s*(?:transport\.)?(?:body|blob|file)/i);
  assert.match(source,/signal\s*:\s*(?:controller\.)?signal|signal\s*:\s*input\.signal/i);
});

test('persisted media URLs accept only canonical HTTPS values',()=>{
  const service=read('services/mediaService.ts');
  assert.match(service,/is(?:Canonical|Valid|Persisted)[A-Za-z]*MediaUrl|assert(?:Canonical|Persisted)[A-Za-z]*Url/i);
  assert.match(service,/new\s+URL\s*\(/i);
  assert.match(service,/protocol\s*!==?\s*['"]https:['"]|protocol\s*===?\s*['"]https:['"]/i);
  assert.match(service,/file|content|ph|blob|data/i);
  assert.match(service,/invalid_persisted_media_url/i);
});

test('Feed publication uses the B1 idempotent wrapper and requires a stable command',()=>{
  const feed=read('contexts/FeedContext.tsx');
  assert.match(feed,/publicationCommandId\??\s*:\s*string/i);
  assert.match(feed,/publish_my_media_post_v1/i);
  assert.match(feed,/p_client_command_id\s*:\s*video\.publicationCommandId/i);
  assert.match(feed,/p_kind\s*:\s*['"](?:photo|carousel)['"]|mediaAssetIds\.length\s*>\s*1\s*\?\s*['"]carousel['"]/i);
  assert.doesNotMatch(feed,/supabase\.rpc\(['"]create_(?:photo_post_with_media|carousel_post)['"]/i);
  assert.match(feed,/Promise<string>/i);
  assert.doesNotMatch(feed,/return\s+undefined\s*;/i);
  assert.doesNotMatch(feed,/\.from\(['"]videos['"]\)\.insert/i,
    'Feed creation must fail closed instead of bypassing the canonical publisher');
});

test('all avatar feed callers materialize canonical media and bind a stable publication command',()=>{
  for(const file of [
    'components/feature/studio/AvatarsTab.tsx',
    'app/ai-avatar.tsx','app/ai-avatar.native.tsx','app/ai-avatar.web.tsx',
  ]) {
    const source=read(file);
    assert.match(source,/publishCanonicalAvatarMedia/i,`${file} must use the shared canonical avatar publication orchestrator`);
    assert.doesNotMatch(source,/addVideo\s*\(\s*\{[\s\S]{0,260}videoUrl\s*:\s*(?:mediaUrl|avatarUrl)/i,
      `${file} must not persist provider URLs directly`);
  }
  const service=read('services/avatarPublicationService.ts');
  assert.match(service,/uploadMediaFromBlob/i);
  assert.match(service,/mediaAssetIds\s*:\s*\[\s*prepared\.asset\.assetId\s*\]/i);
  assert.match(service,/publicationCommandId\s*:\s*input\.publicationCommandId/i);
  assert.match(service,/uploadAndPublishRemoteStreamVideo/i);
});

test('a stale avatar Stream pending is confirmed before a different avatar can upload',()=>{
  const service=read('services/avatarPublicationService.ts');
  const pendingStart=service.indexOf('if(pending)');
  assert.ok(pendingStart<service.indexOf('if(videoSource)'),
    'recovery must run before choosing image versus video so a new image cannot bypass a stale Stream pending');
  const pendingEnd=service.indexOf('\n    try {',pendingStart);
  const pendingBlock=service.slice(pendingStart,pendingEnd);
  assert.match(pendingBlock,/resumeStreamVideoPublication\(pending\)/i);
  assert.match(pendingBlock,/clearPendingStreamPublication\(\s*['"]ai-avatar['"]\s*,\s*input\.ownerId\s*\)/i);
  assert.match(pendingBlock,/sourceFingerprint\s*!==\s*sourceFingerprint|same(?:Source|Payload)/i);
  assert.match(pendingBlock,/avatar_previous_publication_confirmed_retry_current/i);
  assert.ok(
    pendingBlock.indexOf('resumeStreamVideoPublication(pending)')<pendingBlock.indexOf('avatar_previous_publication_confirmed_retry_current'),
    'the old asset must be canonically confirmed before the new avatar is asked to retry',
  );
  assert.doesNotMatch(pendingBlock,/uploadAndPublishRemoteStreamVideo|createStreamUpload/i,
    'a stale pending must never allocate or upload a second Stream asset in the same attempt');
});

test('upload UI retains one stable command through photo and carousel retry',()=>{
  const upload=read('app/(tabs)/upload.tsx');
  assert.match(upload,/publicationCommand[A-Za-z]*Ref|publicationCommandId/i);
  assert.match(upload,/randomUUID\s*\(/i);
  assert.match(upload,/publicationCommandId\s*:/i);
  assert.match(upload,/if\s*\(\s*!postId\s*\)\s*throw/i);
  assert.match(upload,/preparedSingleUploadRef/i);
  assert.match(upload,/preparedCarouselUploadsRef/i);
  assert.match(upload,/findLinkedPostForAsset/i);
  assert.match(upload,/Publicación pendiente de confirmación/i);
  assert.doesNotMatch(upload,/publicationAttempted[\s\S]{0,1800}deleteMediaAsset\s*\(/i);
});

test('ambiguous photo and carousel retries freeze the exact payload bound to the command',()=>{
  const upload=read('app/(tabs)/upload.tsx');
  assert.match(upload,/preparedSingleUploadRef[\s\S]{0,260}caption\s*:\s*string[\s\S]{0,120}music\s*:\s*string[\s\S]{0,120}commandId\s*:\s*string/i);
  assert.match(upload,/preparedCarouselUploadsRef[\s\S]{0,300}caption\s*:\s*string[\s\S]{0,120}music\s*:\s*string[\s\S]{0,120}commandId\s*:\s*string/i);
  assert.equal((upload.match(/caption\s*:\s*prepared\.caption/g)??[]).length,2,
    'both photo and carousel retries must use the frozen caption, not current UI state');
  assert.equal((upload.match(/music\s*:\s*prepared\.music/g)??[]).length,2,
    'both photo and carousel retries must use the frozen music payload');
  assert.equal((upload.match(/publicationCommandId\s*:\s*prepared\.commandId/g)??[]).length,2,
    'both publication paths must bind the frozen payload to the original command');
  assert.match(upload,/if\s*\(\s*reconciledPostId\s*\)[\s\S]{0,260}preparedSingleUploadRef\.current\s*=\s*null[\s\S]{0,160}singlePublicationCommandRef\.current\s*=\s*randomUUID\(\)/i);
  assert.match(upload,/if\s*\(\s*reconciledPostId\s*\)[\s\S]{0,260}preparedCarouselUploadsRef\.current\s*=\s*null[\s\S]{0,160}carouselPublicationCommandRef\.current\s*=\s*randomUUID\(\)/i);
});

test('Creator Studio video publishes through canonical Stream and resets only after confirmation',()=>{
  const tab=read('components/feature/studio/VideosTab.tsx');
  assert.match(tab,/uploadAndPublishStreamVideo/i);
  assert.match(tab,/published\.postId|postId/i);
  assert.match(tab,/STREAM_(?:CREATE_UPLOAD|DIRECT_POST|PROCESSING|PUBLISH)|onStage/i);
  assert.doesNotMatch(tab,/addVideo\s*\(\s*\{[\s\S]{0,220}videoUrl\s*:\s*uri/i);
  const publishStart=tab.search(/handleExportAndPublish/i);
  const publishBody=tab.slice(publishStart,tab.indexOf('}, [',publishStart)>0?tab.indexOf('}, [',publishStart):publishStart+5000);
  assert.ok(publishBody.indexOf('postId')<publishBody.indexOf('editor.reset()'),
    'canonical post confirmation must precede editor reset');
});

test('Creator Studio effects routes photo to R2 and video to Stream without local persistence',()=>{
  const tab=read('components/feature/studio/EffectsTab.tsx');
  assert.match(tab,/uploadMediaFromUri/i);
  assert.match(tab,/uploadAndPublishStreamVideo/i);
  assert.match(tab,/setCapturedType\(['"]video['"]\)/i);
  assert.match(tab,/publicationCommandId/i);
  assert.doesNotMatch(tab,/addVideo\s*\(\s*\{[\s\S]{0,240}videoUrl\s*:\s*capturedUri/i);
});

test('Stream confirmation-pending retry resumes the exact asset and never uploads or posts a second asset',()=>{
  const stream=read('services/streamService.ts');
  assert.match(stream,/export\s+async\s+function\s+resumeStreamVideoPublication/i);
  assert.match(stream,/assetId\??\s*:\s*string/i);
  const resumeStart=stream.indexOf('export async function resumeStreamVideoPublication');
  const resumeBody=stream.slice(resumeStart,stream.indexOf('\n}',resumeStart)+2);
  assert.doesNotMatch(resumeBody,/createStreamUpload|postVideoToStreamUploadUrl|uploadAndPublishStreamVideo/i);
  for(const file of ['components/feature/studio/VideosTab.tsx','components/feature/studio/EffectsTab.tsx']) {
    const source=read(file);
    assert.match(source,/pendingStreamPublicationRef/i);
    assert.match(source,/resumeStreamVideoPublication/i);
    assert.match(source,/stream_publish_confirmation_pending/i);
    assert.match(source,/assetId\s*:\s*safe\.assetId|safe\.assetId/i);
    assert.match(source,/loadPendingStreamPublication/i);
    assert.match(source,/savePendingStreamPublication/i);
    assert.match(source,/clearPendingStreamPublication/i);
  }
  const videos=read('components/feature/studio/VideosTab.tsx');
  assert.match(videos,/fingerprintStreamSourceIdentity\(buildEditorSourceIdentity\(editor\)\)[\s\S]{0,900}===\s*pending\.sourceFingerprint[\s\S]{0,180}editor\.reset\(\)/i,
    'confirming an older pending upload must not reset a newly opened or edited clip');
  const recovery=read('services/streamPublicationRecovery.ts');
  assert.match(recovery,/AsyncStorage/i);
  assert.match(recovery,/sourceFingerprint/i);
  assert.match(recovery,/ownerId\s*:\s*string/i,
    'durable Stream recovery must bind its envelope to the authenticated owner');
  assert.match(recovery,/pending\.ownerId\s*!==\s*normalizedOwnerId|value\.ownerId\s*!==\s*normalizedOwnerId/i,
    'a recovery envelope owned by another session must fail closed');
  assert.match(recovery,/KEY_PREFIX[\s\S]{0,400}normalizedOwnerId[\s\S]{0,120}surface/i,
    'AsyncStorage keys must be namespaced by owner and surface');
  assert.doesNotMatch(recovery,/sourceUri\s*:|sourceUrl\s*:/i,
    'persistent recovery must not expose local or provider URLs');
  const recoveryCallers=[
    'components/feature/studio/VideosTab.tsx','components/feature/studio/EffectsTab.tsx',
    'services/avatarPublicationService.ts','app/(tabs)/upload.tsx',
  ].map(read).join('\n');
  assert.doesNotMatch(recoveryCallers,/loadPendingStreamPublication\(\s*['"][^'"]+['"]\s*\)/i);
  assert.doesNotMatch(recoveryCallers,/clearPendingStreamPublication\(\s*['"][^'"]+['"]\s*\)/i);
  assert.doesNotMatch(recoveryCallers,/savePendingStreamPublication\(\s*['"][^'"]+['"]\s*,\s*pendingRecovery\s*\)/i);
});

test('feed video upload durably resumes a pending Stream asset for the authenticated owner',()=>{
  const upload=read('app/(tabs)/upload.tsx');
  assert.match(upload,/pendingStreamPublicationRef/i);
  assert.match(upload,/loadPendingStreamPublication\(\s*['"]feed-upload['"]\s*,\s*user\.id\s*\)/i);
  assert.match(upload,/resumeStreamVideoPublication\(\s*pending\s*\)/i);
  assert.match(upload,/savePendingStreamPublication\(\s*['"]feed-upload['"]\s*,\s*user\.id\s*,\s*pendingRecovery/i);
  assert.match(upload,/clearPendingStreamPublication\(\s*['"]feed-upload['"]\s*,\s*user\.id\s*\)/i);
  const resumeIndex=upload.indexOf('resumeStreamVideoPublication(pending)');
  const uploadIndex=upload.indexOf('uploadAndPublishStreamVideo({',resumeIndex);
  assert.ok(resumeIndex>=0&&uploadIndex>resumeIndex,
    'pending confirmation must be attempted before allocating/uploading another Stream asset');
});

test('successful no-FFmpeg export resets export retry accounting before returning the reusable URI',()=>{
  const hook=read('hooks/video/useVideoEditor.ts');
  assert.match(hook,/FFmpeg unavailable[\s\S]{0,260}exportAttempts\.current\s*=\s*0[\s\S]{0,140}status\s*:\s*['"]exported['"]/i);
});

test('cloud draft service is owner RPC based, private, CAS aware, and cross-device restorable',()=>{
  assert.equal(existsSync(draftServicePath),true,'canonical cloud draft service must exist');
  const service=read('services/publicationDraftService.ts');
  for(const rpc of [
    'create_my_publication_draft_v1','get_my_publication_draft_v1',
    'list_my_publication_drafts_v1','update_my_publication_draft_v1',
    'delete_my_publication_draft_v1','publish_my_publication_draft_v1',
  ]) assert.match(service,new RegExp(rpc));
  assert.match(service,/visibility\s*:\s*['"]private['"]/i);
  assert.match(service,/purpose\s*:\s*(?:kind\s*===?[\s\S]{0,100})?['"](?:post_image|carousel_image)['"]/i);
  assert.match(service,/expectedRevision|expected_revision/i);
  assert.match(service,/clientCommandId|client_request_id/i);
  assert.match(service,/getMediaUrl/i);
  assert.match(service,/uploadMediaFrom(?:Blob|Source)/i);
  assert.match(service,/state\s*===\s*['"]published['"][\s\S]{0,160}publishedPostId/i);
  assert.match(service,/preparedDraftPublications/i);
});

test('DraftManager is a cache/facade and cannot swallow durable save failures',()=>{
  const manager=read('modules/creator/drafts/DraftManager.ts');
  assert.match(manager,/publicationDraftService|createPublicationDraft|savePublicationDraft/i);
  assert.doesNotMatch(manager,/catch\s*\([^)]*\)\s*\{[\s\S]{0,180}console\.warn[\s\S]{0,80}\}\s*$/m);
  assert.match(manager,/revision/i);
  assert.match(manager,/clientRequestId|client_request_id/i);
  assert.match(manager,/PREPARED_CLOUD_DRAFTS_KEY/i);
  assert.match(manager,/AsyncStorage\.setItem\(\s*PREPARED_CLOUD_DRAFTS_KEY/i);
  assert.match(manager,/assetIds/i);
});

test('cloud draft retries preserve partial materialization and are connected to existing mobile draft UI',()=>{
  const service=read('services/publicationDraftService.ts');
  const manager=read('modules/creator/drafts/DraftManager.ts');
  const materializeLoop=service.slice(service.indexOf('for (let index = publicAssetIds.length'));
  assert.match(materializeLoop,/preparedDraftPublications\.set\([\s\S]{0,260}publicAssetIds/i,
    'each successfully materialized asset must be cached before the next upload');
  const upload=read('app/(tabs)/upload.tsx');
  const content=read('app/my-content.tsx');
  assert.match(upload,/DraftManager\.savePublicationDraft/i);
  assert.match(content,/DraftManager\.listPublicationDrafts/i);
  assert.match(content,/DraftManager\.restorePublicationDraft/i);
  assert.match(content,/DraftManager\.updatePublicationDraft/i);
  assert.match(content,/DraftManager\.deletePublicationDraft/i);
  assert.match(content,/DraftManager\.publishPublicationDraft/i);
  assert.match(content,/editingDraftCaption/i);
  assert.match(content,/nextCaption\s*===\s*draft\.caption/i,
    'CAS save must not create a revision when the user made no change');
  assert.match(manager,/for\s*\(\s*let\s+index\s*=\s*prepared\.assetIds\.length[\s\S]{0,420}uploadPublicationDraftSource\([\s\S]{0,160}input\.sources\[index\]/i,
    'a 3-item carousel with 2 persisted assets must upload only its one remaining source');
  assert.doesNotMatch(manager,/uploadPublicationDraftSources\([\s\S]{0,100}sources\.slice/i);
});

test('mobile draft mutations are fenced in flight and keep stable idempotency identities on ambiguous retry',()=>{
  const content=read('app/my-content.tsx');
  assert.match(content,/draftMutationInFlightRef/i);
  assert.match(content,/draftUpdateMutationsRef/i);
  assert.match(content,/draftDeleteMutationsRef/i);
  assert.match(content,/if\s*\(\s*draftMutationInFlightRef\.current\.has\(/i,
    'double taps must be fenced before issuing a second mutation');
  assert.match(content,/draftUpdateMutationsRef\.current\.get\([\s\S]{0,500}clientMutationId/i,
    'update retry must reuse its prepared mutation and stable idempotency key');
  assert.match(content,/draftDeleteMutationsRef\.current\.get\([\s\S]{0,500}clientMutationId/i,
    'delete retry must reuse its prepared mutation and stable idempotency key');
  assert.match(content,/draftPublishCommandsRef\.current\.get\([\s\S]{0,500}draftMutationInFlightRef\.current\.add/i,
    'publish retry must reuse its command while a double click is fenced');
});

test('B1 client introduces no scheduler, calendar, finance, or alternate uploader',()=>{
  const files=[
    'services/publicationDraftService.ts',
    'components/feature/studio/VideosTab.tsx','components/feature/studio/EffectsTab.tsx',
  ].filter(relative=>existsSync(path.join(root,relative))).map(read).join('\n');
  assert.doesNotMatch(files,/cron\.schedule|scheduled_at|publish_at|publication_queue/i);
  assert.doesNotMatch(files,/ledger_accounts|ledger_entries|financial_transactions|platform_fee_bps/i);
  assert.doesNotMatch(files,/supabase\.storage\.from/i);
});

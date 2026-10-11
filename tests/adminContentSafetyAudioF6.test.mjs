import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {AudioPipelineError,MAX_AUDIO_BYTES,WHISPER_MODEL,downloadStreamAudioBytes,makeProbeWav,normalizeWhisperResult,retryPolicy,selectStreamAudioDownloadRoute,timecodeForMatch,validateSignedStreamAudioUrl,validateStreamAudioUrl} from "../supabase/functions/content-safety-scan/audioPipeline.mjs";

const root=process.cwd();
const migration=readFileSync(join(root,"supabase","migrations","20260915130911_admin_content_safety_audio_stt_ai_v1.sql"),"utf8");
const b7Migration=readFileSync(join(root,"supabase","migrations","20261010053524_creator_premium_b7_full_functional_commercial_completion.sql"),"utf8");
const worker=readFileSync(join(root,"supabase","functions","content-safety-scan","index.ts"),"utf8");
const releaseWorkflow=readFileSync(join(root,".github","workflows","nelyon-production-release.yml"),"utf8");

test("canonical Stream audio URLs are accepted and SSRF shapes are rejected",()=>{
  const uid="0123456789abcdef0123456789abcdef",code="example-code";
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`,uid,code),`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`);
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`,uid,`customer-${code}.cloudflarestream.com`),`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`);
  const derivativeIdentity="abcdefabcdefabcdefabcdefabcdefab";
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/downloads/audio.m4a`,uid,code),`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/downloads/audio.m4a`);
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/dl/audio.m4a`,uid,code),`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/dl/audio.m4a`);
  for(const url of [`http://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`,`https://localhost/${uid}/downloads/audio.m4a`,`https://127.0.0.1/${uid}/downloads/audio.m4a`,`https://evil.example/${uid}/downloads/audio.m4a`,`https://customer-${code}.cloudflarestream.com/other/downloads/audio.m4a`,`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a?unexpected=1`,`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a#fragment`]){
    assert.throws(()=>validateStreamAudioUrl(url,uid,code),AudioPipelineError,url);
  }
});

test("private Stream audio accepts only the exact signed token authority",()=>{
  const host="customer-example-code.cloudflarestream.com";
  const token="eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ2aWRlbyJ9.signature";
  const signed=`https://${host}/${token}/downloads/audio.m4a`;
  assert.equal(validateSignedStreamAudioUrl(signed,signed),signed);
  assert.equal(validateSignedStreamAudioUrl(signed.replace("/downloads/","/dl/"),signed),signed.replace("/downloads/","/dl/"));
  for(const candidate of [
    signed.replace("https://","http://"),
    signed.replace(host,"localhost"),
    signed.replace(token,"other.header.signature"),
    `${signed}?download=1`,
    `${signed}#fragment`,
    signed.replace("/audio.m4a","/default.mp4"),
  ]) assert.throws(()=>validateSignedStreamAudioUrl(candidate,signed),AudioPipelineError,candidate);
});

test("public audio claims preserve the canonical download without invoking the Premium signer",async()=>{
  const uid="0123456789abcdef0123456789abcdef",customerCode="example-code";
  const providerUrl=`https://customer-${customerCode}.cloudflarestream.com/${uid}/downloads/audio.m4a`;
  const routeWithoutSigner=await selectStreamAudioDownloadRoute({targetType:"video",uid,customerCode,providerUrl});
  assert.equal(routeWithoutSigner.url,providerUrl);
  let signerCalls=0;
  const route=await selectStreamAudioDownloadRoute({
    targetType:"video",uid,customerCode,providerUrl,
    createPrivateGrant:async()=>{signerCalls+=1;throw new Error("Premium signer must not run for public video");},
  });
  assert.equal(route.url,providerUrl);
  assert.equal(route.access,"public");
  assert.equal(signerCalls,0);
  assert.equal(route.validateRedirect(providerUrl.replace("/downloads/","/dl/")),providerUrl.replace("/downloads/","/dl/"));
  assert.throws(()=>route.validateRedirect(`https://evil.example/${uid}/downloads/audio.m4a`),AudioPipelineError);
  const bytes=await downloadStreamAudioBytes({route,fetchImpl:async(url,init)=>{
    assert.equal(url,providerUrl);
    assert.deepEqual(init,{redirect:"manual"});
    return new Response(new Uint8Array([1,2,3]),{status:200,headers:{"content-length":"3"}});
  }});
  assert.deepEqual([...bytes],[1,2,3]);
});

test("Premium audio claims require the exact private signed route and never fall back publicly",async()=>{
  const uid="0123456789abcdef0123456789abcdef",customerCode="example-code";
  const providerUrl=`https://customer-${customerCode}.cloudflarestream.com/${uid}/downloads/audio.m4a`;
  const token="eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ2aWRlbyIsImRvd25sb2FkYWJsZSI6dHJ1ZX0.signature";
  const signedUrl=`https://customer-${customerCode}.cloudflarestream.com/${token}/downloads/audio.m4a`;
  let signerCalls=0;
  const route=await selectStreamAudioDownloadRoute({
    targetType:"creator_premium",uid,customerCode,providerUrl,
    createPrivateGrant:async input=>{signerCalls+=1;assert.deepEqual(input,{cloudflareUid:uid,customerCode});return {audioUrl:signedUrl};},
  });
  assert.equal(route.url,signedUrl);
  assert.equal(route.access,"premium_private");
  assert.equal(signerCalls,1);
  assert.equal(route.validateRedirect(signedUrl.replace("/downloads/","/dl/")),signedUrl.replace("/downloads/","/dl/"));
  assert.throws(()=>route.validateRedirect(providerUrl),AudioPipelineError);
  const bytes=await downloadStreamAudioBytes({route,fetchImpl:async url=>{
    assert.equal(url,signedUrl);
    return new Response(new Uint8Array([4,5]),{status:200,headers:{"content-length":"2"}});
  }});
  assert.deepEqual([...bytes],[4,5]);

  await assert.rejects(
    selectStreamAudioDownloadRoute({
      targetType:"creator_premium",uid,customerCode,providerUrl,
      createPrivateGrant:async()=>{throw new AudioPipelineError("stream_signing_configuration_missing");},
    }),
    error=>error instanceof AudioPipelineError&&error.code==="stream_signing_configuration_missing",
  );
});

test("bounded audio download rejects redirects and maps transient failures without external traffic",async()=>{
  const uid="0123456789abcdef0123456789abcdef",customerCode="example-code";
  const providerUrl=`https://customer-${customerCode}.cloudflarestream.com/${uid}/downloads/audio.m4a`;
  const route=await selectStreamAudioDownloadRoute({targetType:"video",uid,customerCode,providerUrl});
  await assert.rejects(
    downloadStreamAudioBytes({route,fetchImpl:async()=>new Response(null,{status:302,headers:{location:"https://evil.example/audio.m4a"}})}),
    error=>error instanceof AudioPipelineError&&error.code==="stream_audio_url_untrusted_host",
  );
  const otherUid="fedcba9876543210fedcba9876543210";
  await assert.rejects(
    downloadStreamAudioBytes({route,fetchImpl:async()=>new Response(null,{status:302,headers:{location:`https://customer-${customerCode}.cloudflarestream.com/${otherUid}/downloads/audio.m4a`}})}),
    error=>error instanceof AudioPipelineError&&error.code==="stream_audio_url_untrusted_identity",
  );
  await assert.rejects(
    downloadStreamAudioBytes({route,fetchImpl:async()=>new Response(null,{status:503})}),
    error=>error instanceof AudioPipelineError&&error.code==="stream_audio_temporarily_unavailable"&&error.retryable===true,
  );
});

test("unknown or absent server claim target types fail closed before signing",async()=>{
  const uid="0123456789abcdef0123456789abcdef",customerCode="example-code";
  const providerUrl=`https://customer-${customerCode}.cloudflarestream.com/${uid}/downloads/audio.m4a`;
  for(const targetType of [undefined,null,"story","VIDEO"]){
    let signerCalls=0;
    await assert.rejects(
      selectStreamAudioDownloadRoute({targetType,uid,customerCode,providerUrl,createPrivateGrant:async()=>{signerCalls+=1;return {audioUrl:providerUrl};}}),
      error=>error instanceof AudioPipelineError&&error.code==="stream_audio_target_type_invalid",
    );
    assert.equal(signerCalls,0);
  }
});

test("B7 claim identity must precede the target-aware worker deployment",()=>{
  const legacyClaim=migration.slice(migration.indexOf("create function public.claim_content_safety_audio_scans"),migration.indexOf("create function public.complete_content_safety_audio_transcription"));
  const b7Claim=b7Migration.slice(b7Migration.indexOf("create or replace function public.claim_content_safety_audio_scans"),b7Migration.indexOf("create or replace function public.complete_content_safety_audio_transcription"));
  assert.doesNotMatch(legacyClaim,/jsonb_build_object\([^;]*'target_type'/s);
  assert.match(b7Claim,/'target_type',v_row\.target_type/);
  assert.match(worker,/streamAudioDownload\(scan\.cloudflare_uid,\s*scan\.target_type\)/);
  const migrationDeploy=releaseWorkflow.indexOf('name: Apply exact manifest migrations');
  const functionDeploy=releaseWorkflow.indexOf('name: Deploy each exact manifest function');
  assert.ok(migrationDeploy>=0);
  assert.ok(functionDeploy>=0);
  assert.ok(migrationDeploy<functionDeploy);
});

test("the worker validates server claim identity before touching Stream derivatives",()=>{
  const downloader=worker.slice(worker.indexOf("async function streamAudioDownload"),worker.indexOf("async function deleteStreamAudio"));
  const identityCheck=downloader.indexOf("validateStreamAudioTargetType(targetType)");
  const firstProviderCall=downloader.indexOf("streamFetch(");
  assert.ok(identityCheck>=0);
  assert.ok(firstProviderCall>=0);
  assert.ok(identityCheck<firstProviderCall);
});

test("Workers AI responses normalize only text, word count, language and bounded timing",()=>{
  const result=normalizeWhisperResult({result:{transcription_info:{text:"hola mundo",word_count:2,language:"es"},segments:[{start:0.2,end:1.4,text:"hola mundo",secret:"discard"}]}});
  assert.deepEqual(result,{text:"hola mundo",wordCount:2,detectedLanguage:"es",noSpeech:false,segments:[{start:0.2,end:1.4,text:"hola mundo"}]});
  assert.deepEqual(normalizeWhisperResult({result:{text:"",word_count:0,segments:[]}}),{text:"",wordCount:0,detectedLanguage:null,noSpeech:true,segments:[]});
});

test("retry policy is bounded to transient provider statuses",()=>{
  for(const status of [408,425,429,500,503])assert.equal(retryPolicy(status).retryable,true);
  for(const status of [400,401,403,404,422])assert.equal(retryPolicy(status).retryable,false);
  assert.equal(makeProbeWav().length,3244);
  assert.equal(WHISPER_MODEL,"@cf/openai/whisper-large-v3-turbo");
  assert.equal(MAX_AUDIO_BYTES,20_000_000);
});

test("transcript matches receive provider timecodes only when a real segment supplies them",()=>{
  const match={rule_id:"rule",matched_terms:["riesgo"],excerpt:"riesgo"};
  assert.deepEqual(timecodeForMatch(match,[{start:2,end:4,text:"Riesgo detectado"}]),{...match,timecode_start:2,timecode_end:4});
  assert.deepEqual(timecodeForMatch(match,[]),{...match,timecode_start:null,timecode_end:null});
});

test("one canonical source owns transcription while shared Stories only reference its scan",()=>{
  const claims=new Map();
  const claim=source=>{if(!claims.has(source))claims.set(source,{providerCalls:1,transcripts:1});return claims.get(source)};
  const video=claim("video-source"),storyA=claim("video-source"),storyB=claim("video-source");
  assert.equal(video,storyA);assert.equal(storyA,storyB);assert.equal(claims.size,1);assert.equal(video.providerCalls,1);assert.equal(video.transcripts,1);
  assert.match(migration,/media_source_scan_id=v_source_scan\.id/);
  assert.match(migration,/target_type='video' and s\.audio_status='pending'/);
});

test("schema adds one private transcript authority and no parallel queue or enforcement",()=>{
  assert.deepEqual([...migration.matchAll(/create table private\.(content_safety_[a-z_]+)/g)].map(match=>match[1]),["content_safety_audio_transcripts"]);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all privileges on table private\.content_safety_audio_transcripts from public,anon,authenticated,service_role/);
  assert.match(migration,/for update of s skip locked limit p_limit/);
  assert.match(migration,/audio_transcript_rule/);
  assert.match(migration,/confidence,priority_score[\s\S]*'audio_transcript_rule'[\s\S]*null,v_priority/);
  assert.doesNotMatch(worker+ migration,/admin_issue_user_warning|admin_prepare_user_moderation_action|admin_finalize_user_moderation_action|admin_moderate_content|admin_moderate_story|ledger_entries|financial_transactions|wallet|escrow/i);
});

test("provider failure cannot block the existing text completion loop",()=>{
  assert.ok(worker.indexOf("complete_content_safety_scan")<worker.indexOf("claim_content_safety_audio_scans"));
  assert.match(worker,/p_provider_called: issue\.providerCalled/);
  assert.match(worker,/p_retryable: issue\.retryable/);
  assert.match(worker,/claim_content_safety_transcript_evaluations/);
  assert.match(worker,/scope: 'transcript'/);
  assert.match(worker,/createPremiumStreamAudioDownloadGrant/);
  assert.match(worker,/selectStreamAudioDownloadRoute/);
});

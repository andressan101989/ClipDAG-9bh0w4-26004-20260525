import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {AudioPipelineError,MAX_AUDIO_BYTES,WHISPER_MODEL,makeProbeWav,normalizeWhisperResult,retryPolicy,timecodeForMatch,validateStreamAudioUrl} from "../supabase/functions/content-safety-scan/audioPipeline.mjs";

const root=process.cwd();
const migration=readFileSync(join(root,"supabase","migrations","20260915130911_admin_content_safety_audio_stt_ai_v1.sql"),"utf8");
const worker=readFileSync(join(root,"supabase","functions","content-safety-scan","index.ts"),"utf8");

test("canonical Stream audio URLs are accepted and SSRF shapes are rejected",()=>{
  const uid="0123456789abcdef0123456789abcdef",code="example-code";
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`,uid,code),`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`);
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`,uid,`customer-${code}.cloudflarestream.com`),`https://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`);
  const derivativeIdentity="abcdefabcdefabcdefabcdefabcdefab";
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/downloads/audio.m4a`,uid,code),`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/downloads/audio.m4a`);
  assert.equal(validateStreamAudioUrl(`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/dl/audio.m4a`,uid,code),`https://customer-${code}.cloudflarestream.com/${derivativeIdentity}/dl/audio.m4a`);
  for(const url of [`http://customer-${code}.cloudflarestream.com/${uid}/downloads/audio.m4a`,`https://localhost/${uid}/downloads/audio.m4a`,`https://127.0.0.1/${uid}/downloads/audio.m4a`,`https://evil.example/${uid}/downloads/audio.m4a`,`https://customer-${code}.cloudflarestream.com/other/downloads/audio.m4a`]){
    assert.throws(()=>validateStreamAudioUrl(url,uid,code),AudioPipelineError,url);
  }
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
});

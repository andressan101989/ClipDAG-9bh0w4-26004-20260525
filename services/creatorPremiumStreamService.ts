/**
 * Creator Premium B3 video-media coordination.
 *
 * Cloudflare identifiers exist only inside the creator upload operation. The
 * consumer API accepts a Premium content ID and returns a short-lived grant in
 * memory; this module never persists or shares that grant.
 */
import {
  deleteMediaAsset,
  getSafeMediaError,
  uploadMediaFromUri,
  type UploadMediaInput,
} from '@/services/mediaService';
import {
  createCreatorPremiumStreamUpload,
  deleteStreamVideo,
  getSafeStreamError,
  postVideoToStreamUploadUrl,
  waitForCreatorPremiumStreamReady,
  type CreatorPremiumStreamProcessingDescriptor,
} from '@/services/streamService';
import { getSupabaseClient } from '@/template';

type PremiumTeaserInput=Pick<
  UploadMediaInput,
  'uri'|'mimeType'|'fileName'|'sizeBytes'|'signal'|'timeoutMs'
>;

export interface UploadCreatorPremiumVideoMediaInput {
  contentId:string;
  teaser:PremiumTeaserInput;
  video:{
    uri:string;
    mimeType:string;
    fileName:string;
    sizeBytes:number;
    signal?:AbortSignal;
    timeoutMs?:number;
    processingTimeoutMs?:number;
    pollIntervalMs?:number;
    onProgress?:(state:CreatorPremiumStreamProcessingDescriptor)=>void;
  };
}

export interface CreatorPremiumVideoMediaResult {
  contentId:string;
  teaserUrl:string;
  teaserAttached:boolean;
  videoAttached:boolean;
  mediaReady:boolean;
  replayed:boolean;
}

export interface CreatorPremiumVideoMediaState {
  content_id:string;
  content_kind:'video';
  lifecycle_status:string;
  teaser_url:string|null;
  teaser_attached:boolean;
  video_attached:boolean;
  video_ready:boolean;
  media_ready:boolean;
}

export interface CreatorPremiumVideoPlaybackGrant {
  hlsUrl:string;
  dashUrl:string;
  thumbnailUrl:string;
  expiresAt:string;
}

export interface CreatorPremiumStreamCleanupFailure {
  role:'teaser'|'video';
  code:string;
}

export class CreatorPremiumStreamError extends Error {
  cleanupFailures:CreatorPremiumStreamCleanupFailure[];
  constructor(message:string,cleanupFailures:CreatorPremiumStreamCleanupFailure[]=[]){
    super(message);
    this.name='CreatorPremiumStreamError';
    this.cleanupFailures=cleanupFailures;
  }
}

const db=()=>getSupabaseClient();

function firstRow<T>(data:T[]|T|null|undefined):T|undefined {
  return Array.isArray(data)?data[0]:data??undefined;
}

function safeMessage(error:unknown):string {
  const stream=getSafeStreamError(error);
  if(stream.message&&stream.message!=='stream_operation_failed') return stream.message;
  const media=getSafeMediaError(error);
  return media.message||media.code||'creator_premium_video_failed';
}

async function cleanupNewMedia(input:{teaserAssetId:string;videoAssetId?:string}) {
  const failures:CreatorPremiumStreamCleanupFailure[]=[];
  try {
    await deleteMediaAsset(input.teaserAssetId);
  } catch(error) {
    failures.push({role:'teaser',code:getSafeMediaError(error).code});
  }
  if(input.videoAssetId) {
    try {
      await deleteStreamVideo(input.videoAssetId);
    } catch(error) {
      failures.push({role:'video',code:getSafeStreamError(error).code});
    }
  }
  return failures;
}

export async function uploadCreatorPremiumVideoMedia(
  input:UploadCreatorPremiumVideoMediaInput,
):Promise<CreatorPremiumVideoMediaResult> {
  if(!input.contentId) throw new CreatorPremiumStreamError('creator_premium_invalid_content');
  const teaser=await uploadMediaFromUri({
    ...input.teaser,
    purpose:'creator_premium_teaser_image',
    visibility:'public',
    premiumContentId:input.contentId,
  });

  let videoAssetId:string|undefined;
  try {
    const contract=await createCreatorPremiumStreamUpload({
      contentId:input.contentId,
      mimeType:input.video.mimeType,
      sizeBytes:input.video.sizeBytes,
      fileName:input.video.fileName,
    });
    videoAssetId=contract.assetId;
    await postVideoToStreamUploadUrl({
      uri:input.video.uri,
      uploadUrl:contract.uploadUrl,
      signal:input.video.signal,
      timeoutMs:input.video.timeoutMs,
    });
    await waitForCreatorPremiumStreamReady(videoAssetId,{
      signal:input.video.signal,
      timeoutMs:input.video.processingTimeoutMs,
      pollIntervalMs:input.video.pollIntervalMs,
      onProgress:input.video.onProgress,
    });
    const {data,error}=await db().rpc('set_my_creator_premium_video_media_v1',{
      p_content_id:input.contentId,
      p_teaser_asset_id:teaser.assetId,
      p_video_asset_id:videoAssetId,
    });
    if(error) throw error;
    const result=firstRow(data) as Record<string,unknown>|undefined;
    if(!result
      ||result.content_id!==input.contentId
      ||result.media_ready!==true
      ||result.teaser_attached!==true
      ||result.video_attached!==true
      ||typeof result.teaser_url!=='string') {
      throw new Error('creator_premium_invalid_video_binding');
    }
    return {
      contentId:input.contentId,
      teaserUrl:result.teaser_url,
      teaserAttached:true,
      videoAttached:true,
      mediaReady:true,
      replayed:result.replayed===true,
    };
  } catch(error) {
    const cleanupFailures=await cleanupNewMedia({
      teaserAssetId:teaser.assetId,
      videoAssetId,
    });
    throw new CreatorPremiumStreamError(safeMessage(error),cleanupFailures);
  }
}

export async function fetchMyCreatorPremiumVideoMedia(
  contentId:string,
):Promise<CreatorPremiumVideoMediaState> {
  if(!contentId) throw new CreatorPremiumStreamError('creator_premium_invalid_content');
  const {data,error}=await db().rpc('get_my_creator_premium_video_media_v1',{
    p_content_id:contentId,
  });
  if(error) throw new CreatorPremiumStreamError(safeMessage(error));
  const state=firstRow(data) as CreatorPremiumVideoMediaState|undefined;
  if(!state||state.content_id!==contentId||state.content_kind!=='video') {
    throw new CreatorPremiumStreamError('creator_premium_video_media_not_found');
  }
  return state;
}

function protectedStreamUrl(
  value:unknown,
  suffix:'/manifest/video.m3u8'|'/manifest/video.mpd'|'/thumbnails/thumbnail.jpg',
):URL|null {
  if(typeof value!=='string') return null;
  try {
    const parsed=new URL(value);
    if(parsed.protocol!=='https:'
      ||!parsed.hostname.startsWith('customer-')
      ||!parsed.hostname.endsWith('.cloudflarestream.com')
      ||!parsed.pathname.endsWith(suffix)) return null;
    const token=parsed.pathname.slice(1,-suffix.length);
    return token.length>0&&!token.includes('/')?parsed:null;
  } catch {
    return null;
  }
}

export async function getCreatorPremiumVideoPlaybackGrant(
  contentId:string,
):Promise<CreatorPremiumVideoPlaybackGrant> {
  if(!contentId) throw new CreatorPremiumStreamError('creator_premium_invalid_content');
  const {data,error}=await db().functions.invoke('get-stream-playback',{
    body:{premium_content_id:contentId},
  });
  const grant=data?.data as Record<string,unknown>|undefined;
  const fields=grant?Object.keys(grant).sort():[];
  const hls=protectedStreamUrl(grant?.hlsUrl,'/manifest/video.m3u8');
  const dash=protectedStreamUrl(grant?.dashUrl,'/manifest/video.mpd');
  const thumbnail=protectedStreamUrl(grant?.thumbnailUrl,'/thumbnails/thumbnail.jpg');
  const expiresAt=typeof grant?.expiresAt==='string'?Date.parse(grant.expiresAt):NaN;
  const now=Date.now();
  const sameAuthority=hls&&dash&&thumbnail
    &&hls.origin===dash.origin
    &&hls.origin===thumbnail.origin
    &&hls.pathname.split('/')[1]===dash.pathname.split('/')[1]
    &&hls.pathname.split('/')[1]===thumbnail.pathname.split('/')[1];
  if(error
    ||data?.success!==true
    ||grant?.contentId!==contentId
    ||fields.join(',')!=='contentId,dashUrl,expiresAt,hlsUrl,thumbnailUrl'
    ||!sameAuthority
    ||!Number.isFinite(expiresAt)
    ||expiresAt<=now
    ||expiresAt>now+315_000) {
    throw new CreatorPremiumStreamError('invalid_premium_video_grant');
  }
  return {
    hlsUrl:hls.toString(),
    dashUrl:dash.toString(),
    thumbnailUrl:thumbnail.toString(),
    expiresAt:String(grant.expiresAt),
  };
}

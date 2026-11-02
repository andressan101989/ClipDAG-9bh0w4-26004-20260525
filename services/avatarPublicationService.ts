import type { AddVideoInput } from '@/contexts/FeedContext';
import { uploadMediaFromBlob, type MediaAssetDescriptor } from '@/services/mediaService';
import {
  getSafeStreamError,
  resumeStreamVideoPublication,
  uploadAndPublishRemoteStreamVideo,
} from '@/services/streamService';
import {
  clearPendingStreamPublication,
  fingerprintStreamSourceIdentity,
  loadPendingStreamPublication,
  savePendingStreamPublication,
  type PendingStreamPublicationRecovery,
} from '@/services/streamPublicationRecovery';

type PhotoPublisher=(input:AddVideoInput)=>Promise<string>;

export interface CanonicalAvatarPublicationInput {
  ownerId:string;
  imageUrl:string;
  videoUrl?:string|null;
  caption:string;
  music:string;
  publicationCommandId:string;
  publishPhoto:PhotoPublisher;
  signal?:AbortSignal;
}

const preparedAvatarImages=new Map<string,{
  sourceUrl:string;caption:string;music:string;asset:MediaAssetDescriptor;
}>();
const pendingAvatarStreams=new Map<string,PendingStreamPublicationRecovery>();

function requireHttps(value:string):string {
  const url=new URL(value);
  if(url.protocol!=='https:') throw new Error('invalid_avatar_provider_url');
  return url.toString();
}

/**
 * Materializes AI-provider output into Nelyon's canonical R2/Stream authority
 * before publishing. Provider URLs are never persisted as Feed media URLs.
 */
export async function publishCanonicalAvatarMedia(
  input:CanonicalAvatarPublicationInput,
):Promise<string> {
  if(!input.publicationCommandId) throw new Error('publication_command_required');
  const videoSource=input.videoUrl?requireHttps(input.videoUrl):null;
  const currentSource=videoSource??requireHttps(input.imageUrl);
  const sourceFingerprint=await fingerprintStreamSourceIdentity(currentSource);
  const inMemoryPending=pendingAvatarStreams.get(input.publicationCommandId);
  const pending=(inMemoryPending?.ownerId===input.ownerId?inMemoryPending:null)
    ??await loadPendingStreamPublication('ai-avatar',input.ownerId);
  if(pending) {
    const samePayload=pending.sourceFingerprint===sourceFingerprint
      &&pending.caption===input.caption
      &&pending.music===input.music;
    const result=await resumeStreamVideoPublication(pending);
    pendingAvatarStreams.delete(input.publicationCommandId);
    await clearPendingStreamPublication('ai-avatar',input.ownerId);
    if(!samePayload) {
      const confirmed=new Error(
        'La publicación anterior fue confirmada. Pulsa Publicar nuevamente para publicar el avatar actual.',
      ) as Error&{code:string};
      confirmed.code='avatar_previous_publication_confirmed_retry_current';
      throw confirmed;
    }
    return result.postId;
  }
  if(videoSource) {
    try {
      const result=await uploadAndPublishRemoteStreamVideo({
        sourceUrl:videoSource,fileName:'ai-avatar.mp4',caption:input.caption,
        music:input.music,signal:input.signal,
      });
      return result.postId;
    } catch(error) {
      const safe=getSafeStreamError(error);
      if(safe.code==='stream_publish_confirmation_pending'&&safe.assetId) {
        const pendingRecovery:PendingStreamPublicationRecovery={
          ownerId:input.ownerId,
          sourceFingerprint,caption:input.caption,music:input.music,
          assetId:safe.assetId,operationId:safe.operationId,
        };
        await savePendingStreamPublication('ai-avatar',input.ownerId,pendingRecovery);
        pendingAvatarStreams.set(input.publicationCommandId,pendingRecovery);
      }
      throw error;
    }
  }

  const imageSource=currentSource;
  let prepared=preparedAvatarImages.get(input.publicationCommandId);
  if(prepared&&(prepared.sourceUrl!==imageSource||prepared.caption!==input.caption||prepared.music!==input.music)) {
    throw new Error('avatar_publication_command_conflict');
  }
  if(!prepared) {
    const response=await fetch(imageSource,{method:'GET',signal:input.signal});
    if(!response.ok) throw new Error(`avatar_source_fetch_${response.status}`);
    const blob=await response.blob();
    const mimeType=(response.headers.get('content-type')||blob.type||'image/jpeg').split(';')[0].trim();
    if(!mimeType.startsWith('image/')) throw new Error('avatar_source_mime_invalid');
    const asset=await uploadMediaFromBlob({
      blob,mimeType,fileName:`ai-avatar.${mimeType==='image/png'?'png':'jpg'}`,
      purpose:'post_image',visibility:'public',signal:input.signal,
    });
    prepared={sourceUrl:imageSource,caption:input.caption,music:input.music,asset};
    preparedAvatarImages.set(input.publicationCommandId,prepared);
  }
  if(!prepared.asset.url) throw new Error('avatar_delivery_url_missing');
  const postId=await input.publishPhoto({
    videoUrl:prepared.asset.url,thumbnailUrl:prepared.asset.url,
    caption:prepared.caption,music:prepared.music,username:'',userAvatar:'',
    mediaAssetIds:[prepared.asset.assetId],
    publicationCommandId:input.publicationCommandId,
  });
  preparedAvatarImages.delete(input.publicationCommandId);
  return postId;
}
